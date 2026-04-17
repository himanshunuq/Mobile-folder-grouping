// classifier.js
// Uses official @google/genai SDK to classify file content into study categories.

import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

if (!process.env.GEMINI_API_KEY) {
  throw new Error(
    "GEMINI_API_KEY is not set. Please add it to your .env file."
  );
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const BATCH_CLASSIFICATION_PROMPT = `You are a file classifier. Analyze the content of the provided files and return ONLY a raw JSON object (no markdown, no explanation).
The JSON object should map each file ID to its classification, like this:
{
  "file1.pdf": {"category": "<topic>", "confidence": <0.0-1.0>},
  "file2.jpg": {"category": "<topic>", "confidence": <0.0-1.0>}
}
Category must be one short lowercase word like: java, python, react, cpp, javascript, interview, math, physics, chemistry, history, general_study.
Use "unknown" if not study material.`;

/**
 * Classify a batch of files using Google Gemini.
 *
 * @param {Array<{id: string, text: string, isImage: boolean}>} files
 * @returns {Promise<Record<string, {category: string, confidence: number}>>}
 */
export async function classifyBatch(files) {
  if (!files || files.length === 0) return {};

  const contents = [BATCH_CLASSIFICATION_PROMPT];

  for (const file of files) {
    contents.push(`\n--- START FILE: ${file.id} ---\n`);
    if (file.isImage) {
      contents.push({ inlineData: { data: file.text, mimeType: "image/jpeg" } });
    } else {
      const truncated = file.text.slice(0, 4000); // stay within token limits
      contents.push(`Content:\n${truncated}\n`);
    }
    contents.push(`\n--- END FILE: ${file.id} ---\n`);
  }

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: contents,
  });

  // Strip any accidental markdown fences
  const raw = response.text
    .replace(/```[a-z]*\n?/g, "")
    .replace(/```/g, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Gemini returned non-JSON response in batch: ${raw}`);
  }

  // Basic shape validation
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Unexpected Gemini response shape: ${JSON.stringify(parsed)}`);
  }

  return parsed;
}
