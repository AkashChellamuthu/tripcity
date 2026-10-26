
import 'dotenv/config';
import OpenAI from 'openai';

async function main() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY missing');

  const client = new OpenAI({
    apiKey: key,
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    timeout: 60000,
    maxRetries: 0,
  });

  console.log('Testing Gemini with a small prompt...');

  const response = await client.chat.completions.create({
    model: 'gemini-3.5-flash-lite',
    reasoning_effort: 'low',
    max_tokens: 20,
    messages: [{ role: 'user', content: 'Reply only OK' }],
  });

  console.log('Response:', response.choices[0]?.message?.content);
}

main().catch((error: unknown) => {
  console.error('Gemini test failed:', error);
  process.exitCode = 1;
});
