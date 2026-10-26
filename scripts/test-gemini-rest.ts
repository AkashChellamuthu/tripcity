
import 'dotenv/config';

async function main() {
  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    throw new Error('GEMINI_API_KEY missing in .env');
  }

  console.log('Testing direct Gemini REST API...');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: 'Reply with only OK' }],
            },
          ],
          generationConfig: {
            maxOutputTokens: 20,
          },
        }),
        signal: controller.signal,
      }
    );

    const body = await response.text();

    console.log('HTTP status:', response.status);
    console.log('Response body:', body);
  } catch (error) {
    console.error(
      'Direct API request failed:',
      error instanceof Error ? error.message : error
    );
  } finally {
    clearTimeout(timer);
  }
}

main();
