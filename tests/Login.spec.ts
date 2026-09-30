import { askAI } from '../utils/ai';
import { test, expect } from '@playwright/test';
import { analyzeFailure } from '../utils/aiFailureAnalyzer';


test('Login', async ({ page }) => {

  try{
  const startTime = Date.now();

  await page.goto('https://uat.tripcity.com/', {
    waitUntil: 'commit',
    timeout: 60000,
  });
 

test.setTimeout(60000);
  await page.locator('(//input[@type="email"])[1]').fill('yutorimurakami1@gmail.com');
  await page.locator('#signin_password').fill('kdt9gwk1gug_wcx2GEV');
   await page.getByRole('button', { name: 'Login' }).click();

  
  
    console.log('Login successful');
  console.log('Current URL:', page.url());
}
catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    console.log('\nSending error to Gemini...\n');

    const aiResult = await analyzeFailure(errorMessage);

    console.log('\n===== GEMINI ANALYSIS =====');
    console.log(aiResult);
    console.log('===========================\n');

    throw error;
}
});  

