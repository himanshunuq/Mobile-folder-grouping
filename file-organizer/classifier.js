// classifier.js
// Uses OpenRouter (google/gemini-1.5-flash) to classify file content into study categories.

import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error(
    "OPENROUTER_API_KEY is not set. Please add it to your .env file."
  );
}

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

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
  let messages;

  if (isImage) {
    // Vision path — send the image inline with the prompt
    messages = [
      {
        role: "user",
        content: [
          { type: "text", text: CLASSIFICATION_PROMPT },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${textOrBase64}`
            }
          }
        ]
      }
    ];
  } else {
    // Text path — append extracted content to the prompt
    const truncated = textOrBase64.slice(0, 4000); // stay within token limits
    messages = [
      {
        role: "user",
        content: CLASSIFICATION_PROMPT + "\n\nContent:\n" + truncated
      }
    ];
  }

  const completion = await openai.chat.completions.create({
    model: "google/gemini-1.5-flash",
    messages: messages,
  });

  // Strip any accidental markdown fences
  const raw = completion.choices[0].message.content
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
