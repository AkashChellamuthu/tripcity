
import 'dotenv/config';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {
  chromium,
  type Page,
  type Locator,
  type BrowserContext,
} from '@playwright/test';
import { askAIForJSON } from '../utils/ai';

const TEST_USERNAME = process.env.TEST_USERNAME;
const TEST_PASSWORD = process.env.TEST_PASSWORD;

type Action = {
  action:
    | 'goto'
    | 'fill'
    | 'click'
    | 'press'
    | 'expectVisible'
    | 'expectHidden'
    | 'expectUrl'
    | 'expectText';
  locatorType?: 'label' | 'placeholder' | 'role' | 'text' | 'css' | 'xpath';
  locator?: string;
  role?: 'button' | 'link' | 'textbox' | 'checkbox' | 'heading';
  value?: string;
};

type Plan = {
  actions: Action[];
};

class AssertionFailure extends Error {
  constructor(message: string) {
    super(`ASSERTION_FAILURE: ${message}`);
    this.name = 'AssertionFailure';
  }
}

const BASE_URL = process.env.BASE_URL;

const INPUT_FILE = path.resolve(
  'reports',
  'AI-Generated-Test-Cases.xlsx',
);
const OUTPUT_FILE = path.resolve(
  'reports',
  'AI-Execution-Report.xlsx',
);
const EVIDENCE_DIR = path.resolve('reports', 'evidence');

const ACTION_TIMEOUT = 8000;

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';

  if (typeof value === 'object' && 'text' in value) {
    return String(value.text ?? '');
  }

  return String(value);
}

function normalizeSelector(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/["']/g, '');
}

/**
 * Known TripCity selectors are resolved before generic AI selectors.
 * Keep registration fields separate from login fields.
 */
function getLocator(page: Page, action: Action): Locator {
  const locator = action.locator?.trim();

  if (!locator) {
    throw new Error('AUTOMATION_BLOCKED: Required locator is missing.');
  }

  const normalized = normalizeSelector(locator);

  // Explicit login email selector.
  if (
    normalized === '#signin_email_address' ||
    (
      action.locatorType === 'css' &&
      normalized === 'input[type=email]'
    ) ||
    (
      action.locatorType === 'placeholder' &&
      /^(email|e-?mailaddress)$/.test(normalized)
    ) ||
    (
      action.locatorType === 'label' &&
      /^(email|e-?mailaddress)$/.test(normalized)
    )
  ) {
    return page.locator('#signin_email_address');
  }

  // Explicit registration email selector must remain separate.
  if (normalized === '#register_email_address') {
    return page.locator('#register_email_address');
  }

  // Known TripCity login password selector.
  if (
    normalized === '#signin_password' ||
    (
      action.locatorType === 'placeholder' &&
      normalized === 'password'
    ) ||
    (
      action.locatorType === 'css' &&
      normalized === 'input[type=password]'
    )
  ) {
    return page.locator('#signin_password');
  }

  // Known TripCity city-search selector.
  if (
    normalized === '#s_city' ||
    normalized === 'id=s_city'
  ) {
    return page.locator('#s_city');
  }

  switch (action.locatorType) {
    case 'label':
      return page.getByLabel(locator, { exact: true });

    case 'placeholder':
      return page.getByPlaceholder(locator, { exact: true });

    case 'role':
      if (!action.role) {
        throw new Error(
          'AUTOMATION_BLOCKED: Accessible role is missing.',
        );
      }

      return page.getByRole(action.role, {
        name: locator,
        exact: true,
      });

    case 'text':
      return page.getByText(locator, { exact: true });

    case 'css':
      if (
        locator.length > 200 ||
        /[{};]/.test(locator) ||
        /:has-text|:contains|javascript:/i.test(locator)
      ) {
        throw new Error(
          'AUTOMATION_BLOCKED: Unsupported CSS selector.',
        );
      }

      return page.locator(locator);

    default:
      throw new Error(
        `AUTOMATION_BLOCKED: Unsupported locator type: ${action.locatorType}`,
      );
  }
}

function validatePlan(plan: Plan): void {
  if (
    !plan ||
    !Array.isArray(plan.actions) ||
    plan.actions.length === 0
  ) {
    throw new Error(
      'AUTOMATION_BLOCKED: AI did not provide an executable plan.',
    );
  }

  const allowedActions = new Set([
    'goto',
    'fill',
    'click',
    'press',
    'expectVisible',
    'expectHidden',
    'expectUrl',
    'expectText',
  ]);

  const allowedLocatorTypes = new Set([
    'label',
    'placeholder',
    'role',
    'text',
    'css',
  ]);

  const verificationActions = new Set([
    'expectVisible',
    'expectHidden',
    'expectUrl',
    'expectText',
  ]);

  if (
    !plan.actions.some(action =>
      verificationActions.has(action.action),
    )
  ) {
    throw new Error(
      'AUTOMATION_BLOCKED: Plan contains no verification assertion.',
    );
  }

  for (const action of plan.actions) {
    if (!action || !allowedActions.has(action.action)) {
      throw new Error(
        'AUTOMATION_BLOCKED: Unsupported action returned by AI.',
      );
    }

    if (
      action.locatorType &&
      !allowedLocatorTypes.has(action.locatorType)
    ) {
      throw new Error(
        'AUTOMATION_BLOCKED: Unsupported locator type.',
      );
    }

    if (
      action.locator &&
      (
        action.locator.length > 200 ||
        /javascript:/i.test(action.locator)
      )
    ) {
      throw new Error(
        'AUTOMATION_BLOCKED: Unsafe or excessively long locator.',
      );
    }

    if (
      action.action === 'goto' &&
      !action.value?.trim()
    ) {
      throw new Error(
        'AUTOMATION_BLOCKED: Navigation target is missing.',
      );
    }

    if (
      ['fill', 'press', 'expectUrl', 'expectText'].includes(
        action.action,
      ) &&
      action.value === undefined
    ) {
      throw new Error(
        `AUTOMATION_BLOCKED: Value missing for ${action.action}.`,
      );
    }

    if (
      ['fill', 'click', 'press', 'expectVisible', 'expectHidden'].includes(
        action.action,
      ) &&
      (!action.locator?.trim() || !action.locatorType)
    ) {
      throw new Error(
        `AUTOMATION_BLOCKED: Locator missing for ${action.action}.`,
      );
    }
  }
}

async function executeAction(
  page: Page,
  action: Action,
): Promise<void> {
  switch (action.action) {
    case 'goto': {
      if (!BASE_URL || !action.value) {
        throw new Error(
          'AUTOMATION_BLOCKED: BASE_URL or navigation target is missing.',
        );
      }

      const base = new URL(BASE_URL);
      const target = new URL(action.value, base);

      if (
        target.origin !== base.origin ||
        !['http:', 'https:'].includes(target.protocol)
      ) {
        throw new Error(
          'AUTOMATION_BLOCKED: Navigation outside BASE_URL is blocked.',
        );
      }

      await page.goto(target.toString(), {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      return;
    }

    case 'fill': {
      const locator = getLocator(page, action);

      try {
        await locator.waitFor({
          state: 'visible',
          timeout: ACTION_TIMEOUT,
        });

        await locator.fill(action.value!, {
          timeout: ACTION_TIMEOUT,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);

        throw new Error(
          `AUTOMATION_BLOCKED: Unable to fill "${action.locator}". ` +
          `Current URL: ${page.url()}. ${message}`,
        );
      }
      return;
    }


     case 'click': {
      const locator = getLocator(page, action);

      try {
        await locator.waitFor({
          state: 'visible',
          timeout: ACTION_TIMEOUT,
        });

        await locator.click({
          timeout: ACTION_TIMEOUT,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);

        throw new Error(
          `AUTOMATION_BLOCKED: Unable to click "${action.locator}". ` +
          `Current URL: ${page.url()}. ${message}`,
        );
      }
      return;
    }

    case 'press':
      await getLocator(page, action).press(action.value!, {
        timeout: ACTION_TIMEOUT,
      });
      return;

    case 'expectVisible': {
      const locator = getLocator(page, action);

      try {
        await locator.waitFor({
          state: 'visible',
          timeout: ACTION_TIMEOUT,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);

        if (/selector|syntax|strict mode|invalid/i.test(message)) {
          throw error;
        }

        throw new AssertionFailure(
          `Expected element to be visible: ${action.locator}. ${message}`,
        );
      }
      return;
    }

    case 'expectHidden': {
      const locator = getLocator(page, action);

      try {
        await locator.waitFor({
          state: 'hidden',
          timeout: ACTION_TIMEOUT,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);

        if (/selector|syntax|strict mode|invalid/i.test(message)) {
          throw error;
        }

        throw new AssertionFailure(
          `Expected element to be hidden: ${action.locator}. ${message}`,
        );
      }
      return;
    }

    case 'expectUrl': {
      const expected = action.value!;

      try {
        await page.waitForURL(
          url => url.href.includes(expected),
          { timeout: ACTION_TIMEOUT },
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);

        let pageText = '';

        try {
          pageText = (await page.locator('body').innerText({
            timeout: 2000,
          })).slice(0, 1500);
        } catch {
          pageText = 'Unable to read page text.';
        }

        throw new AssertionFailure(
          `Expected URL to contain "${expected}". ` +
          `Current URL: ${page.url()}. ` +
          `Visible page text: ${pageText}. ` +
          `Navigation error: ${message}`,
        );
      }
      return;
    }

    case 'expectText': {
      try {
        await page.getByText(action.value!, { exact: true }).waitFor({
          state: 'visible',
          timeout: ACTION_TIMEOUT,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);

        if (/selector|syntax|strict mode|invalid/i.test(message)) {
          throw error;
        }

        throw new AssertionFailure(
          `Expected text was not visible: "${action.value}". ${message}`,
        );
      }
      return;
    }

    default:
      throw new Error('AUTOMATION_BLOCKED: Unsupported action.');
  }
}

async function captureEvidence(
  page: Page | undefined,
  testId: string,
  suffix = '',
): Promise<string> {
  if (!page || page.isClosed()) return '';

  const safeId = testId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(
    EVIDENCE_DIR,
    `${safeId}${suffix}.png`,
  );

  try {
    await page.screenshot({
      path: filePath,
      fullPage: true,
      timeout: ACTION_TIMEOUT,
    });

    return path.relative(path.resolve('reports'), filePath);
  } catch {
    return '';
  }
}

async function closeContext(
  context?: BrowserContext,
): Promise<void> {
  if (!context) return;

  try {
    await context.close();
  } catch {
    // Context may already be closed.
  }
}

async function main(): Promise<void> {
  if (!BASE_URL) {
    throw new Error('Set BASE_URL in your .env file.');
  }

  const base = new URL(BASE_URL);

  if (!['http:', 'https:'].includes(base.protocol)) {
    throw new Error('BASE_URL must use HTTP or HTTPS.');
  }

  await fs.access(INPUT_FILE);
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(INPUT_FILE);

  const sheet =
    workbook.getWorksheet('Test Cases') ??
    workbook.worksheets[0];

  if (!sheet || sheet.rowCount < 2) {
    throw new Error('No test cases found in the Excel file.');
  }

  const headers = new Map<string, number>();

  sheet.getRow(1).eachCell((cell, column) => {
    headers.set(cellText(cell.value).trim(), column);
  });

  const requiredHeaders = [
    'Test Case ID',
    'Requirement',
    'Scenario',
    'Test Steps',
    'Test Data',
    'Expected Result',
    'Execution Status',
    'Actual Result',
    'Evidence Path',
  ];

  for (const header of requiredHeaders) {
    if (!headers.has(header)) {
      throw new Error(
        `Required Excel column is missing: ${header}`,
      );
    }
  }

  const col = (name: string) => headers.get(name)!;
  const browser = await chromium.launch({ headless: true });

  let passed = 0;
  let failed = 0;
  let blocked = 0;

  try {
    for (
      let rowNumber = 2;
      rowNumber <= sheet.rowCount;
      rowNumber++
    ) {
      const row = sheet.getRow(rowNumber);

      const testId =
        cellText(row.getCell(col('Test Case ID')).value).trim() ||
        `ROW${rowNumber}`;

      const requirement = cellText(
        row.getCell(col('Requirement')).value,
      );
      const scenario = cellText(
        row.getCell(col('Scenario')).value,
      );
      const steps = cellText(
        row.getCell(col('Test Steps')).value,
      );
      const testData = cellText(
        row.getCell(col('Test Data')).value,
      );
      const expected = cellText(
        row.getCell(col('Expected Result')).value,
      );

      let page: Page | undefined;
      let context: BrowserContext | undefined;

      row.getCell(col('Execution Status')).value = 'Blocked';
      row.getCell(col('Actual Result')).value =
        'Execution pending.';
      row.getCell(col('Evidence Path')).value = '';

      try {
        if (!steps.trim() || !expected.trim()) {
          throw new Error(
            'AUTOMATION_BLOCKED: Test steps or expected result is missing.',
          );
        }

        console.log(`${testId}: Creating test plan...`);

        const plan = await askAIForJSON<Plan>(`
You are a QA test-plan generator for a Playwright runner.
Return valid JSON only, with this shape:
{"actions":[...]}

Allowed actions:
- {"action":"goto","value":"/relative/path"}
- {"action":"fill","locatorType":"label|placeholder|role|css","locator":"...","role":"textbox","value":"..."}
- {"action":"click","locatorType":"label|placeholder|role|text|css","locator":"...","role":"button"}
- {"action":"press","locatorType":"label|placeholder|role|css","locator":"...","role":"textbox","value":"Enter"}
- {"action":"expectVisible","locatorType":"label|placeholder|role|text|css","locator":"...","role":"heading"}
- {"action":"expectHidden","locatorType":"label|placeholder|role|text|css","locator":"...","role":"heading"}
- {"action":"expectUrl","value":"expected URL substring"}
- {"action":"expectText","value":"exact visible text"}

Verified TripCity selectors:
- Login email: #signin_email_address
- Registration email: #register_email_address
- Login password: #signin_password
- Login button: role button named Login
- City search: #s_city
- First car result: (//div[@class="pos_rell overflow-hidden"])[1]
- Car selection button: (//button[@type="button"])[11]

Rules:
- Use the verified selectors above only when they match the test scenario.
- For CSS selectors, return a complete valid selector. Never return malformed CSS.
- For login email, use locatorType "css" and locator "#signin_email_address".
- For login password, use locatorType "css" and locator "#signin_password".
- For login button, use locatorType "role", role "button", locator "Login".
- Do not confuse registration email with login email.
- Do not invent credentials, selectors, routes, or application behavior.
- Do not invent success messages such as "Email is required".
- For empty-field validation, use only an assertion supported by the known UI or report the plan as unsupported.
- Use only relative paths for goto.
- Do not include JavaScript, code, or secrets in the plan.
- Include at least one meaningful verification assertion for the stated expected result.
- If the steps, selector, test data, or expected behavior cannot be mapped reliably, return {"actions":[]}.

Application base URL: ${BASE_URL}
Test ID: ${testId}
Requirement: ${requirement}
Scenario: ${scenario}
Steps: ${steps}
Test data: ${testData}
Expected result: ${expected}
`);

        validatePlan(plan);

        context = await browser.newContext();
        page = await context.newPage();
        page.setDefaultTimeout(ACTION_TIMEOUT);

        // Every test begins at the configured .env BASE_URL.
        await page.goto(BASE_URL, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        for (const action of plan.actions) {
          await executeAction(page, action);
        }

        const evidence = await captureEvidence(page, testId);

        row.getCell(col('Execution Status')).value = 'Pass';
        row.getCell(col('Actual Result')).value =
          'All planned actions and verification assertions completed.';
        row.getCell(col('Evidence Path')).value = evidence;

        passed++;
        console.log(`${testId}: Pass`);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : String(error);

        const evidence = await captureEvidence(
          page,
          testId,
          '-failure',
        );

        // Only an explicitly executed assertion failure is marked Fail.
        // Selector, strict-mode, plan and environment issues remain Blocked.
        const status =
          error instanceof AssertionFailure ? 'Fail' : 'Blocked';

        row.getCell(col('Execution Status')).value = status;
        row.getCell(col('Actual Result')).value =
          message.slice(0, 1000);
        row.getCell(col('Evidence Path')).value = evidence;

        if (status === 'Fail') {
          failed++;
        } else {
          blocked++;
        }

        console.log(`${testId}: ${status} - ${message}`);
      } finally {
        await closeContext(context);
      }

      // Save after each test so progress is retained if a later test stops.
      await workbook.xlsx.writeFile(OUTPUT_FILE);
    }
  } finally {
    await browser.close();
  }

  console.log('');
  console.log('Execution summary');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Blocked: ${blocked}`);
  console.log(`Excel report: ${OUTPUT_FILE}`);
  console.log(`Evidence folder: ${EVIDENCE_DIR}`);
}

main().catch((error: unknown) => {
  console.error(
    'Execution runner failed:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
