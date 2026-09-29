// import { test, expect } from '@playwright/test';

// import { askAI } from '../utils/ai';

// test('has title', async ({ page }) => {
//   await page.goto('https://playwright.dev/');

//   // Expect a title "to contain" a substring.
//   await expect(page).toHaveTitle(/Playwright/);
// });

// test('get started link', async ({ page }) => {
//   await page.goto('https://playwright.dev/');

//   // Click the get started link.
//   await page.getByRole('link', { name: 'Get started' }).click();

//   // Expects page to have a heading with the name of Installation.
//   await expect(page.getByRole('heading', { name: 'Installation' })).toBeVisible();
// });



// test('has title', async ({ page }) => {
//   await page.goto('https://playwright.dev/');

//   await expect(page).toHaveTitle(/Playwright/);
// });

// test('get started link', async ({ page }) => {
//   await page.goto('https://playwright.dev/');

//   await page.getByRole('link', { name: 'Get started' }).click();

//   await expect(
//     page.getByRole('heading', { name: 'Installation' })
//   ).toBeVisible();
// });

// test('Ask Gemini from Playwright', async () => {
//   const answer = await askAI(
//     'Explain Playwright locators in simple words and give me 3 examples.'
//   );

//   console.log('\n===== GEMINI RESPONSE =====');
//   console.log(answer);
//   console.log('===========================\n');

//   expect(answer).toBeTruthy();
// });


import { test, expect } from '@playwright/test';
import { askAI } from '../utils/ai';

test('has title', async ({ page }) => {
  await page.goto('https://playwright.dev/');

  await expect(page).toHaveTitle(/Playwright/);
});

test('get started link', async ({ page }) => {
  await page.goto('https://playwright.dev/');

  await page.getByRole('link', { name: 'Get started' }).click();

  await expect(
    page.getByRole('heading', { name: 'Installation' })
  ).toBeVisible();
});

test('Ask Gemini from Playwright', async () => {
  const answer = await askAI(
    'Explain Playwright locators in simple words and give me 3 examples.'
  );

  console.log('\n===== GEMINI RESPONSE =====');
  console.log(answer);
  console.log('===========================\n');

  expect(answer).toBeTruthy();
});