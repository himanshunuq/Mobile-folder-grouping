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

const CLASSIFICATION_PROMPT = `You are a file classifier. Analyze the content and return ONLY a raw JSON object (no markdown, no explanation):
{"category": "<topic>", "confidence": <0.0-1.0>}
Category must be one short lowercase word like: java, python, react, cpp, javascript, interview, math, physics, chemistry, history, general_study.
Use "unknown" if not study material.`;

/**
 * Classify the provided content using Google Gemini.
 *
 * @param {string} textOrBase64 - Either plain text (for documents) or a
 *                                base64-encoded string (for images).
 * @param {boolean} [isImage=false] - Pass `true` when `textOrBase64` is a
 *                                    base64-encoded image.
 * @returns {Promise<{category: string, confidence: number}>}
 */
export async function classifyContent(textOrBase64, isImage = false) {
  let contents;

  if (isImage) {
    // Vision path — send the image inline with the prompt
    contents = [
      CLASSIFICATION_PROMPT,
      { inlineData: { data: textOrBase64, mimeType: "image/jpeg" } }
    ];
  } else {
    // Text path — append extracted content to the prompt
    const truncated = textOrBase64.slice(0, 4000); // stay within token limits
    contents = CLASSIFICATION_PROMPT + "\n\nContent:\n" + truncated;
  }

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: contents,
  });

  // Strip any accidental markdown fences
  const raw = response.text
    .replace(/```json|```/g, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Gemini returned non-JSON response: ${raw}`);
  }

  if (
    typeof parsed.category !== "string" ||
    typeof parsed.confidence !== "number"
  ) {
    throw new Error(
      `Unexpected Gemini response shape: ${JSON.stringify(parsed)}`
    );
  }

  return parsed;
}
