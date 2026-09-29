// import OpenAI from "openai";
// import dotenv from "dotenv";


// dotenv.config();

// console.log("ENV:", process.env.GEMINI_API_KEY);
// dotenv.config();


// console.log("Gemini key loaded:", !!process.env.GEMINI_API_KEY);

// if (!process.env.GEMINI_API_KEY) {
//   throw new Error("GEMINI_API_KEY is not set. Check your .env file.");
// }

// if (!process.env.GEMINI_API_KEY) {
//   throw new Error("GEMINI_API_KEY is not set. Check your .env file.");
// }

// const client = new OpenAI({
//   apiKey: process.env.GEMINI_API_KEY,
//   baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
// });

// export async function askAI(prompt: string): Promise<string> {
//   const response = await client.chat.completions.create({
//     model: "gemini-2.5-flash",
//     messages: [
//       {
//         role: "user",
//         content: prompt,
//       },
//     ],
//   });

//   return response.choices[0].message.content ?? "";
// }

// export async function askAIForJSON<T>(prompt: string): Promise<T> {
//   const text = await askAI(
//     `{prompt}\n\nRespond with valid JSON only. No markdown, no explanation.`
//   );

//   const cleaned = text.replace(/```json|```/g, "").trim();

//   return JSON.parse(cleaned) as T;
// }

import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

console.log("Gemini key loaded:", !!process.env.GEMINI_API_KEY);

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is not set. Check your .env file.");
}

const client = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

export async function askAI(prompt: string): Promise<string> {
  const response = await client.chat.completions.create({
    model: "gemini-3.8-flash",
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  return response.choices[0].message.content ?? "";
}

export async function askAIForJSON<T>(prompt: string): Promise<T> {
  const text = await askAI(
    `${prompt}\n\nRespond with valid JSON only. No markdown, no explanation.`
  );

  const cleaned = text.replace(/```json|```/g, "").trim();

  return JSON.parse(cleaned) as T;
}