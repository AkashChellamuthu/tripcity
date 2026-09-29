import { askAI } from './ai';

export async function analyzeFailure(errorMessage: string) {
  try {
    const prompt = `
You are a Playwright automation expert.

Analyze this Playwright test failure.

ERROR:
${errorMessage}

Provide:
1. Root cause
2. Why the test failed
3. Recommended Playwright fix
4. Correct code example

Keep the explanation simple.
`;

    return await askAI(prompt);

  } catch (error) {
    console.log('⚠️ Gemini analysis failed.');

    if (error instanceof Error) {
      console.log('Gemini error:', error.message);
    }

    return 'Gemini is currently unavailable. Please check the Gemini API/model and try again.';
  }
}