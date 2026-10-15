import { env } from 'node:process';
import { test, expect } from '@playwright/test';

const BASE_URL = env.BASE_URL ?? 'https://uat.tripcity.com/';
const USERNAME = env.TEST_USERNAME ?? 'human@yopmail.com';
const PASSWORD = env.TEST_PASSWORD ?? 'Test@123';


test('user can log in and reach the dashboard', async ({ page }) => {
  test.skip(!PASSWORD, 'Set TEST_PASSWORD to run the login test.');
  // test.setTimeout(60_000);

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().fill(USERNAME);
  await page.locator('#signin_password').fill(PASSWORD!);
  await page.getByRole('button', { name: 'Login' }).click();

  await expect(page).toHaveURL(/dashboard/i, { timeout: 30_000 });
  console.log('Login successful.');
  
  await page.locator('id=s_city').fill('90042');
  await page.locator('id=s_city').press('Enter');
  // await page.locator('id=s_city-btn').click();
 await page.locator('(//div[@class="pos_rell overflow-hidden"])[1]').click();
 await page.locator('(//button[@type="button"])[11]').click();

 
 await page .locator('id=submit-btn').click();


  

  
  test.setTimeout(60_000);


});
  
 