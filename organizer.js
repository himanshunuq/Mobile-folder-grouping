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
import { classifyContent } from "./classifier.js";
import { addLog } from "./logger.js";

// Minimum Gemini confidence required to move a file
const CONFIDENCE_THRESHOLD = 0.7;

// Maximum number of files processed in parallel
const CONCURRENCY = 1;

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

  // ── 3. Process in batches of CONCURRENCY ─────────────────────────────────
  for (let i = 0; i < remoteFiles.length; i += CONCURRENCY) {
    const batch = remoteFiles.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map((remotePath) =>
        processFile({ serial, remotePath, dryRun })
      )
    );

    // Log any batch-level failures that weren't caught inside processFile
    results.forEach((result, idx) => {
      if (result.status === "rejected") {
        const file = path.basename(batch[idx]);
        console.error(`❌  Unhandled error for "${file}":`, result.reason?.message);
        addLog({
          file,
          category: "unknown",
          confidence: 0,
          status: "error",
          error: result.reason?.message ?? "Unknown error",
        });
      }
    });

    // Enforce 4.5 second delay to strictly respect Gemini 15 RPM Free Tier quota
    if (i + CONCURRENCY < remoteFiles.length) {
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

// ── Internal: process a single file ───────────────────────────────────────

/**
 * Pull, extract, classify, and conditionally move one file.
 *
 * @param {Object}  opts
 * @param {string}  opts.serial      - ADB device serial
 * @param {string}  opts.remotePath  - Full remote path on device
 * @param {boolean} opts.dryRun      - Skip actual file movement if true
 */
async function processFile({ serial, remotePath, dryRun }) {
  const filename = path.basename(remotePath);
  console.log(`\n⏳  Processing: ${filename}`);

  let localPath;

  try {
    // ── Pull from device ────────────────────────────────────────────────────
    localPath = await pullFile(serial, remotePath);

    // ── Hash Check for Duplicates ───────────────────────────────────────────
    const fileBuffer = fs.readFileSync(localPath);
    const fileHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

    if (knownHashes.has(fileHash)) {
      console.log(`   ♻️  Duplicate detected! Removing from device.`);
      if (!dryRun) await removeRemoteFile(serial, remotePath);
      addLog({ file: filename, category: null, confidence: null, status: "duplicate" });
      return;
    }

    // ── Extract content ─────────────────────────────────────────────────────
    const { text, isImage, supported } = await extractContent(localPath);

    if (!supported) {
      console.log(`   ⚠️  Unsupported file type — skipping.`);
      addLog({ file: filename, category: "unsupported", confidence: 0, status: "unsupported" });
      return;
    }

    // ── Classify ────────────────────────────────────────────────────────────
    const { category, confidence } = await classifyContent(text, isImage);
    console.log(`   🏷️  Category: ${category} (confidence: ${confidence.toFixed(2)})`);

    // ── Decision ────────────────────────────────────────────────────────────
    if (confidence < CONFIDENCE_THRESHOLD) {
      console.log(`   ℹ️  Confidence too low — leaving in place.`);
      addLog({ file: filename, category, confidence, status: "unclassified" });
      return;
    }

    if (dryRun) {
      console.log(`   🔍  [DRY-RUN] Would move → Organized/${category}/`);
      addLog({ file: filename, category, confidence, status: "skipped (dry-run)" });
      return;
    }

    // ── Move: push to Organized/<category>/ ────────────────────────────────
    const remoteDestDir = `${ORGANIZED_BASE_DIR}/${category}`;
    await mkdirOnDevice(serial, remoteDestDir);
    const remoteDest = await pushFile(serial, localPath, remoteDestDir);

    // Only remove original AFTER successful push — originals are never deleted otherwise
    await removeRemoteFile(serial, remotePath);

    knownHashes.add(fileHash);

    console.log(`   ✅  Moved → ${remoteDest}`);
    addLog({ file: filename, category, confidence, status: "moved" });
  } catch (err) {
    console.error(`   ❌  Error processing "${filename}":`, err.message);
    addLog({
      file: filename,
      category: "unknown",
      confidence: 0,
      status: "error",
      error: err.message,
    });
  }
  // Note: local temp file cleanup happens in index.js after all processing
}
