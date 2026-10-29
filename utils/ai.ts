import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is not set. Check your .env file.");
}

const client = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  timeout: 30000,
  maxRetries: 0,
});


export async function askAI(prompt: string): Promise<string> {
  console.log('1. Sending request to Gemini...');

  try {
    const response = await client.chat.completions.create({
      model: 'gemini-3.5-flash-lite',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    console.log('2. Gemini response received.');

    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error('Gemini returned an empty response.');
    }

    return content;
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error('Gemini API request failed.');
    }

    throw error;
  }
}

// export async function askAIForJSON<T>(prompt: string): Promise<T> {
//   const text = await askAI(
//     `${prompt}\n\nRespond with valid JSON only. No markdown, no explanation.`
//   );

//   const cleaned = text.replace(/```json|```/g, "").trim();

//   return JSON.parse(cleaned) as T;
// }


export async function askAIForJSON<T>(prompt: string): Promise<T> {
  const text = await askAI(
    `${prompt}

Return exactly one JSON object with this structure:
{
  "actions": [
    { "action": "goto", "url": "https://your-test-url" },
    { "action": "expectVisible", "selector": "body" }
  ]
}

Use only actions supported by the supplied instructions.
The final action must verify the expected result.
Return JSON only, without markdown or explanation.`
  );

  const cleaned = text
    .replace(/```(?:json)?/gi, "")
    .trim();

  console.log("Gemini raw response:", cleaned);

  let parsed: unknown;

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start === -1 || end <= start) {
      throw new Error(
        `Gemini did not return a JSON object. Response: ${cleaned.slice(0, 500)}`
      );
    }

    try {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      throw new Error(
        `Gemini returned invalid JSON. Response: ${cleaned.slice(0, 500)}`
      );
    }
  }

  return parsed as T;
}
