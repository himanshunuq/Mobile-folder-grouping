// organizer.js
// Core orchestration: pulls files, classifies them, and moves (or skips) them.

import path from "path";
import fs from "fs";
import crypto from "crypto";
import {
  getDevice,
  listDownloadFiles,
  pullFile,
  pushFile,
  mkdirOnDevice,
  removeRemoteFile,
  ORGANIZED_BASE_DIR,
} from "./adb.js";
import { extractContent } from "./extractor.js";
import { classifyBatch } from "./classifier.js";
import { addLog } from "./logger.js";

// Minimum Gemini confidence required to move a file
const CONFIDENCE_THRESHOLD = 0.7;

// Maximum number of files processed in parallel
const BATCH_SIZE = 10;

const HASH_REGISTRY_FILE = path.resolve("file_hashes.json");
let knownHashes = new Set();

/**
 * Main organizer routine.
 *
 * @param {Object}  options
 * @param {boolean} options.dryRun  - If true, classify but never move files
 * @param {string}  options.folder  - Override for the remote source folder
 */
export async function organize({ dryRun = false, folder } = {}) {
  // ── 0. Load hashes ────────────────────────────────────────────────────────
  try {
    if (fs.existsSync(HASH_REGISTRY_FILE)) {
      const data = fs.readFileSync(HASH_REGISTRY_FILE, "utf-8");
      knownHashes = new Set(JSON.parse(data));
    }
  } catch (err) {
    console.error("⚠️ Failed to load hash registry:", err.message);
  }

  // ── 1. Device discovery ───────────────────────────────────────────────────
  const serial = await getDevice();

  // ── 2. List source files ──────────────────────────────────────────────────
  const remoteFiles = await listDownloadFiles(serial, folder);

  if (remoteFiles.length === 0) {
    console.log("ℹ️   No files found in the Download folder.");
    return;
  }

  console.log(`\n📂  Found ${remoteFiles.length} file(s) to process.`);
  if (dryRun) console.log("🔍  DRY-RUN mode — no files will be moved.\n");

  // ── 3. Process in batches ──────────────────────────────────────────────────
  for (let i = 0; i < remoteFiles.length; i += BATCH_SIZE) {
    const batch = remoteFiles.slice(i, i + BATCH_SIZE);
    console.log(`\n📦  Processing Batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} files)`);

    // Step A: Local Pull, Hash & Extract (Parallel)
    const localFilesData = await Promise.all(
      batch.map(async (remotePath) => {
        const filename = path.basename(remotePath);
        try {
          const localPath = await pullFile(serial, remotePath);
          const fileBuffer = fs.readFileSync(localPath);
          const fileHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

          if (knownHashes.has(fileHash)) {
            console.log(`   ♻️  Duplicate detected: ${filename}`);
            if (!dryRun) await removeRemoteFile(serial, remotePath);
            addLog({ file: filename, category: null, confidence: null, status: "duplicate" });
            return null; // Skip further processing
          }

          const { text, isImage, supported } = await extractContent(localPath);

          if (!supported) {
            console.log(`   ⚠️  Unsupported file type: ${filename}`);
            addLog({ file: filename, category: "unsupported", confidence: 0, status: "unsupported" });
            return null;
          }

          return { remotePath, localPath, filename, fileHash, text, isImage };
        } catch (err) {
          console.error(`   ❌  Error parsing ${filename}:`, err.message);
          addLog({ file: filename, category: "unknown", confidence: 0, status: "error", error: err.message });
          return null;
        }
      })
    );

    const validFilesToClassify = localFilesData.filter(Boolean);

    let apiCalled = false;
    let classifications = {};

    // Step B: Gemini API Batch Classification
    if (validFilesToClassify.length > 0) {
      console.log(`   🧠  Sending ${validFilesToClassify.length} file(s) to Gemini...`);
      apiCalled = true;
      try {
        const batchPayload = validFilesToClassify.map(f => ({
          id: f.filename,
          text: f.text,
          isImage: f.isImage,
        }));
        classifications = await classifyBatch(batchPayload);
      } catch (err) {
        console.error(`   ❌  Batch API Error:`, err.message);
        validFilesToClassify.forEach(f => {
          addLog({ file: f.filename, category: "unknown", confidence: 0, status: "error", error: err.message });
        });
        // Error logged, but loop continues so we hit the delay if needed
      }
    }

    // Step C: Decision and Move (Parallel)
    await Promise.allSettled(
      validFilesToClassify.map(async (f) => {
        const result = classifications[f.filename];
        if (!result || !result.category) {
          // Only log if we successfully received classifications but this file was missing
          if (Object.keys(classifications).length > 0) {
              console.log(`   ⚠️  No classification returned for ${f.filename}`);
              addLog({ file: f.filename, category: "unknown", confidence: 0, status: "unclassified" });
          }
          return;
        }

        const { category, confidence } = result;
        console.log(`   🏷️  ${f.filename} → ${category} (${confidence.toFixed(2)})`);

        if (confidence < CONFIDENCE_THRESHOLD) {
          console.log(`   ℹ️  Confidence too low — leaving in place.`);
          addLog({ file: f.filename, category, confidence, status: "unclassified" });
          return;
        }

        if (dryRun) {
          console.log(`   🔍  [DRY-RUN] Will move → Organized/${category}/`);
          addLog({ file: f.filename, category, confidence, status: "skipped (dry-run)" });
          return;
        }

        try {
          const remoteDestDir = `${ORGANIZED_BASE_DIR}/${category}`;
          await mkdirOnDevice(serial, remoteDestDir);
          const remoteDest = await pushFile(serial, f.localPath, remoteDestDir);

          await removeRemoteFile(serial, f.remotePath);
          knownHashes.add(f.fileHash);

          console.log(`   ✅  Moved → ${remoteDest}`);
          addLog({ file: f.filename, category, confidence, status: "moved" });
        } catch (err) {
          console.error(`   ❌  Error moving "${f.filename}":`, err.message);
          addLog({ file: f.filename, category: "unknown", confidence: 0, status: "error", error: err.message });
        }
      })
    );

    // Step D: Rate Limit Wait (only if we hit the API)
    if (apiCalled && i + BATCH_SIZE < remoteFiles.length) {
      console.log(`   ⏳  Waiting 4.5s to respect Gemini API limits...`);
      await new Promise((r) => setTimeout(r, 4500));
    }
  }

  // ── 4. Save Hash Registry ────────────────────────────────────────────────
  if (!dryRun) {
    try {
      fs.writeFileSync(HASH_REGISTRY_FILE, JSON.stringify([...knownHashes], null, 2), "utf-8");
    } catch (err) {
      console.error("❌ Failed to save hash registry:", err.message);
    }
  }
}
