// index.js
// CLI entry point — parses flags, runs the organizer, and cleans up temp files.

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { organize } from "./organizer.js";
import { saveLog } from "./logger.js";

dotenv.config();

// ── CLI flag parsing ────────────────────────────────────────────────────────
const args = process.argv.slice(2);

const dryRun = args.includes("--dry-run");

// Optional --folder <path> override for the remote source directory
const folderFlagIndex = args.indexOf("--folder");
const folder =
  folderFlagIndex !== -1 && args[folderFlagIndex + 1]
    ? args[folderFlagIndex + 1]
    : undefined; // undefined → adb.js uses its default

// ── Banner ──────────────────────────────────────────────────────────────────
console.log("╔══════════════════════════════════════╗");
console.log("║   🤖  AI File Organizer via ADB      ║");
console.log("╚══════════════════════════════════════╝");
console.log(`Mode   : ${dryRun ? "DRY-RUN (no files moved)" : "LIVE"}`);
if (folder) console.log(`Folder : ${folder}`);
console.log();

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  try {
    await organize({ dryRun, folder });
  } catch (err) {
    // Top-level error (e.g. no device connected, bad API key)
    console.error("\n💥  Fatal error:", err.message);
    process.exitCode = 1;
  } finally {
    // ── Always save the log ────────────────────────────────────────────────
    saveLog();

    // ── Clean up temp folder ───────────────────────────────────────────────
    const tempDir = path.resolve("temp");
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log("\n🧹  Temp folder cleaned.");
    }
  }
}

main();
