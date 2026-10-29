import 'dotenv/config';
import { env } from 'node:process';
import { test, expect } from '@playwright/test';

const BASE_URL = env.BASE_URL ?? 'https://uat.tripcity.com/';
const USERNAME = env.TEST_USERNAME;
const PASSWORD = env.TEST_PASSWORD;


  test('user can log in and reach the dashboard', async ({ page }) => {
     test.setTimeout(60_000);
    test.skip(
      !USERNAME || !PASSWORD,
      'Set TEST_USERNAME and TEST_PASSWORD to run the login test.',
    );
    if (!USERNAME || !PASSWORD) return;

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').first().fill(USERNAME);
    await page.locator('#signin_password').fill(PASSWORD);
    await page.locator('(//button[@type="button"])[2]').click();


    await expect(page).toHaveURL(/dashboard/i, { timeout: 30_000 });
    console.log('Login successful.');
    
    await page.locator('id=s_city').fill('90042');
    await page.locator('id=s_city').press('Enter');
    // await page.locator('id=s_city-btn').click();
  // await page.locator("(//img[@class='fac-media__image'])[1]").click();
  // await page.locator('//a[@class="btn btn-primary w-100"]').click();

  // new tab handling 
  const newPagePromise = page.context().waitForEvent('page');

await page.locator("(//img[@class='fac-media__image'])[1]").click();

const newPage = await newPagePromise;

await newPage.waitForLoadState('domcontentloaded');

await newPage.locator('//a[@class="btn btn-primary w-100"]').click();
  console.log('car selected successfully.');

 
  
//  await page .locator('id=submit-btn').click();


  });
 