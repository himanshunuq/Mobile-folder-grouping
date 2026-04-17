// extractor.js
// Extracts text or base64 content from a local file based on its extension.

import fs from "fs";
import path from "path";

// Lazy-load heavy parsers only when needed to keep cold-start fast
async function parsePdf(filePath) {
  const { default: pdfParse } = await import("pdf-parse");
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  // Limit to first 600 words
  return data.text.split(/\s+/).slice(0, 600).join(" ");
}

async function parseDocx(filePath) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value.split(/\s+/).slice(0, 600).join(" ");
}

async function parseXlsx(filePath) {
  const xlsxLib = await import("xlsx");
  const XLSX = xlsxLib.default || xlsxLib;
  const workbook = XLSX.readFile(filePath);
  const lines = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    lines.push(csv);
  }

  // Return all cell data joined; the classifier will handle relevance
  return lines.join("\n");
}

/**
 * Extract text content (or base64 for images) from a local file.
 *
 * @param {string} filePath - Absolute path to the file on the local machine
 *                            (i.e., inside ./temp/).
 * @returns {Promise<{text: string|null, isImage: boolean, supported: boolean}>}
 */
export async function extractContent(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  try {
    switch (ext) {
      case ".pdf": {
        const text = await parsePdf(filePath);
        return { text, isImage: false, supported: true };
      }

      case ".docx": {
        const text = await parseDocx(filePath);
        return { text, isImage: false, supported: true };
      }

      case ".xlsx":
      case ".xls": {
        const text = await parseXlsx(filePath);
        return { text, isImage: false, supported: true };
      }

      case ".jpg":
      case ".jpeg":
      case ".png": {
        const buffer = fs.readFileSync(filePath);
        const base64 = buffer.toString("base64");
        return { text: base64, isImage: true, supported: true };
      }

      case ".txt": {
        const raw = fs.readFileSync(filePath, "utf-8");
        // Limit to first 600 words
        const text = raw.split(/\s+/).slice(0, 600).join(" ");
        return { text, isImage: false, supported: true };
      }

      default:
        return { text: null, isImage: false, supported: false };
    }
  } catch (err) {
    // Propagate with context so organizer can log it
    throw new Error(`Extraction failed for "${path.basename(filePath)}": ${err.message}`);
  }
}
