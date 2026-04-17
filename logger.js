// logger.js
// Handles saving the classification log JSON and printing a console.table summary.

import fs from "fs";
import path from "path";

const LOG_FILE = path.resolve("classification_log.json");

/**
 * @typedef {Object} LogEntry
 * @property {string} file       - Original filename
 * @property {string} category   - Classified category (or 'unclassified'/'unsupported')
 * @property {number} confidence - Confidence score from Gemini (0.0 – 1.0)
 * @property {string} status     - 'moved' | 'skipped (dry-run)' | 'unclassified' | 'unsupported' | 'error' | 'duplicate'
 * @property {string} [error]    - Error message if status is 'error'
 */

const entries = [];

/**
 * Add a single log entry to the in-memory store.
 * @param {LogEntry} entry
 */
export function addLog(entry) {
  entries.push(entry);
}

/**
 * Persist all log entries to `classification_log.json` and print a
 * console.table summary to stdout.
 */
export function saveLog() {
  // ── Write JSON log ────────────────────────────────────────────────────────
  try {
    fs.writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2), "utf-8");
    console.log(`\n📄  Log saved → ${LOG_FILE}`);
  } catch (err) {
    console.error("❌  Failed to write classification_log.json:", err.message);
  }

  // ── Console summary table ─────────────────────────────────────────────────
  if (entries.length === 0) {
    console.log("ℹ️   No files were processed.");
    return;
  }

  const tableData = entries.map(({ file, category, confidence, status, error }) => ({
    File: file,
    Category: category ?? "—",
    Confidence: confidence != null ? confidence.toFixed(2) : "—",
    Status: status,
    Error: error ?? "",
  }));

  console.log("\n📊  Classification Summary:");
  console.table(tableData);

  // ── Quick stats ───────────────────────────────────────────────────────────
  const moved = entries.filter((e) => e.status === "moved").length;
  const duplicates = entries.filter((e) => e.status === "duplicate").length;
  const skipped = entries.filter((e) => e.status === "skipped (dry-run)").length;
  const unclassified = entries.filter((e) => e.status === "unclassified").length;
  const unsupported = entries.filter((e) => e.status === "unsupported").length;
  const errors = entries.filter((e) => e.status === "error").length;

  console.log("\n✅  Stats:");
  console.log(`   Moved        : ${moved}`);
  console.log(`   Duplicates   : ${duplicates}`);
  console.log(`   Skipped (dry): ${skipped}`);
  console.log(`   Unclassified : ${unclassified}`);
  console.log(`   Unsupported  : ${unsupported}`);
  console.log(`   Errors       : ${errors}`);
}
