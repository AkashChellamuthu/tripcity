
import 'dotenv/config';

async function main() {
  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    throw new Error('GEMINI_API_KEY missing in .env');
  }

  console.log('Checking available Gemini models...');

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models',
    {
      headers: { 'x-goog-api-key': key },
      signal: AbortSignal.timeout(15000),
    }
  );

  const body = await response.json() as {
    error?: { message?: string };
    models?: {
      name: string;
      supportedGenerationMethods?: string[];
    }[];
  };

  console.log('HTTP status:', response.status);

  if (!response.ok) {
    console.error('API error:', body.error?.message ?? body);
    return;
  }

  const available = (body.models ?? []).filter(model =>
    model.supportedGenerationMethods?.includes('generateContent')
  );

  console.log('Models supporting generateContent:');
  for (const model of available) {
    console.log(model.name);
  }
}

main().catch(error => {
  console.error(
    'Model list request failed:',
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
});
