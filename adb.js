// adb.js
// Handles all ADB interactions: device detection, file listing, pull, and push.

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const Adb = require("@devicefarmer/adbkit").default;
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { pipeline } from "stream";
import { execFile } from "child_process";

const pipelineAsync = promisify(pipeline);
const execFileAsync = promisify(execFile);

// ── Constants ──────────────────────────────────────────────────────────────
export const DEVICE_DOWNLOAD_DIR = "/sdcard/Download";
export const ORGANIZED_BASE_DIR = "/sdcard/Download/Organized";
export const LOCAL_TEMP_DIR = path.resolve("temp");

// ── ADB Client ────────────────────────────────────────────────────────────
const client = Adb.createClient();

/**
 * Detect the first connected ADB device and return its serial number.
 * Throws if no device is found.
 *
 * @returns {Promise<string>} Device serial number
 */
export async function getDevice() {
  const devices = await client.listDevices();
  const online = devices.filter((d) => d.type !== "offline");

  if (online.length === 0) {
    throw new Error(
      "No ADB device found. Connect your phone, enable USB Debugging, and run `adb devices`."
    );
  }

  const serial = online[0].id;
  console.log(`📱  Connected device: ${serial}`);
  return serial;
}

/**
 * List all files directly under the device's Download folder.
 * Skips the `Organized/` sub-folder to prevent re-processing.
 *
 * @param {string} serial - Device serial number
 * @param {string} [folder] - Optional override for the remote folder path
 * @returns {Promise<string[]>} Array of full remote file paths
 */
export async function listDownloadFiles(serial, folder = DEVICE_DOWNLOAD_DIR) {
  // `ls -p` appends `/` to directories, making them easy to filter out
  const output = await runShell(serial, `ls -p "${folder}"`);

  return output
    .split("\n")
    .map((line) => line.trim())
    // Android ls escapes spaces and special chars with backslashes — unescape them
    .map((line) => line.replace(/\\(.)/g, "$1"))
    .filter((line) => line && !line.endsWith("/")) // exclude dirs
    .filter((line) => !line.startsWith("."))        // exclude hidden
    .map((name) => `${folder}/${name}`);
}

/**
 * Pull a single file from the device to the local ./temp/ directory.
 * First tries adbkit's sync pull; if the result is empty (common with emoji
 * filenames), falls back to spawning `adb pull` directly via the CLI.
 *
 * @param {string} serial     - Device serial number
 * @param {string} remotePath - Full path on the device
 * @returns {Promise<string>} Local file path
 */
export async function pullFile(serial, remotePath) {
  const filename = path.basename(remotePath);
  const localPath = path.join(LOCAL_TEMP_DIR, filename);

  // Ensure temp dir exists
  if (!fs.existsSync(LOCAL_TEMP_DIR)) {
    fs.mkdirSync(LOCAL_TEMP_DIR, { recursive: true });
  }

  // ── Attempt 1: adbkit sync pull ────────────────────────────────────────
  try {
    const transfer = await client.getDevice(serial).pull(remotePath);

    await new Promise((resolve, reject) => {
      transfer.on("error", reject);
      const writeStream = fs.createWriteStream(localPath);
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
      transfer.pipe(writeStream);
    });
  } catch (e) {
    // ignore — we'll check file size and fallback below
  }

  // ── Check if file has content ───────────────────────────────────────────
  const stat = fs.existsSync(localPath) ? fs.statSync(localPath) : null;
  if (!stat || stat.size === 0) {
    // ── Attempt 2: adb CLI pull (handles emoji / special chars reliably) ──
    console.log(`   ↩️  adbkit pull gave empty file — falling back to adb CLI`);
    await execFileAsync("adb", ["-s", serial, "pull", remotePath, localPath]);

    const stat2 = fs.existsSync(localPath) ? fs.statSync(localPath) : null;
    if (!stat2 || stat2.size === 0) {
      throw new Error(`File pulled as empty: ${filename}`);
    }
  }

  return localPath;
}

/**
 * Create a remote directory on the device (idempotent, uses mkdir -p).
 *
 * @param {string} serial    - Device serial number
 * @param {string} remotePath - Remote directory path to create
 */
export async function mkdirOnDevice(serial, remotePath) {
  await runShell(serial, `mkdir -p "${remotePath}"`);
}

/**
 * Push a local file to a destination directory on the device.
 * The destination directory must already exist.
 *
 * @param {string} serial      - Device serial number
 * @param {string} localPath   - Local file to push
 * @param {string} remoteDir   - Target directory on the device
 * @returns {Promise<string>}  Full remote destination path
 */
export async function pushFile(serial, localPath, remoteDir) {
  const filename = path.basename(localPath);
  const remoteDest = `${remoteDir}/${filename}`;

  const transfer = await client
    .getDevice(serial)
    .push(localPath, remoteDest);

  await new Promise((resolve, reject) => {
    transfer.on("end", resolve);
    transfer.on("error", reject);
  });

  return remoteDest;
}

/**
 * Remove the original file from the device's Download folder.
 * NOTE: This is intentionally a "move" operation — we push first, then delete
 *       the source. The organizer only calls this after a successful push.
 *
 * @param {string} serial     - Device serial number
 * @param {string} remotePath - File to delete
 */
export async function removeRemoteFile(serial, remotePath) {
  await runShell(serial, `rm "${remotePath}"`);
}

// ── Internal helper ────────────────────────────────────────────────────────

/**
 * Run a shell command on the device and return its stdout as a string.
 *
 * @param {string} serial  - Device serial number
 * @param {string} command - Shell command
 * @returns {Promise<string>}
 */
async function runShell(serial, command) {
  const stream = await client.getDevice(serial).shell(command);
  return readStream(stream);
}

function readStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    stream.on("error", reject);
  });
}
