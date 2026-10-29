
  import 'dotenv/config';
  import { createRequire } from 'node:module';
  import * as fs from 'node:fs/promises';
  import path from 'node:path';
  import ExcelJS from 'exceljs';
  import { Client } from '@modelcontextprotocol/sdk/client/index.js';
  import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
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
    locatorType?: 'label' | 'placeholder' | 'role' | 'text' | 'css';
    locator?: string;
    role?:
      | 'button'
      | 'link'
      | 'textbox'
      | 'checkbox'
      | 'heading'
      | 'combobox'
      | 'radio'
      | 'slider';
    value?: string;
    url?: string;
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

  class AutomationBlocked extends Error {
    constructor(message: string) {
      super(message.startsWith('AUTOMATION_BLOCKED:')
        ? message
        : `AUTOMATION_BLOCKED: ${message}`);
      this.name = 'AutomationBlocked';
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
  const MCP_REQUEST_TIMEOUT = 45000;
  const DESTRUCTIVE_ACTION_PATTERN =
    /\b(delete|remove|cancel|log\s*out|logout|purchase|buy|pay|payment|book|reserve|confirm|checkout|submit|save|update|add|create|edit|change|register|apply|send|upload|subscribe|transfer|withdraw|reset|deactivate|terminate|refund)\b/i;

  type ToolResult = {
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };

  class McpBrowser {
    private readonly client: Client;

    private constructor(client: Client) {
      this.client = client;
    }

    static async launch(): Promise<McpBrowser> {
      const require = createRequire(path.join(process.cwd(), 'package.json'));
      const packagePath = require.resolve('@playwright/mcp/package.json');
      const cliPath = path.join(path.dirname(packagePath), 'cli.js');
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [
          cliPath,
          '--browser=chrome',
          '--headless',
          '--isolated',
          '--output-dir',
          EVIDENCE_DIR,
          '--timeout-action',
          String(ACTION_TIMEOUT),
          '--timeout-navigation',
          '30000',
        ],
        cwd: process.cwd(),
        stderr: 'pipe',
      });
      const client = new Client({
        name: 'tripcity-ai-qa-runner',
        version: '1.0.0',
      });

      try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        const requiredTools = [
          'browser_navigate',
          'browser_snapshot',
          'browser_click',
          'browser_fill_form',
          'browser_evaluate',
          'browser_press_key',
          'browser_take_screenshot',
          'browser_close',
        ];
        const availableTools = new Set(tools.map(tool => tool.name));
        const missing = requiredTools.filter(name => !availableTools.has(name));

        if (missing.length > 0) {
          throw new AutomationBlocked(
            `Playwright MCP server is missing required tools: ${missing.join(', ')}.`,
          );
        }

        return new McpBrowser(client);
      } catch (error) {
        await client.close().catch(() => undefined);
        throw new AutomationBlocked(
          `Unable to connect to Playwright MCP: ${safeErrorMessage(error)}`,
        );
      }
    }

    async call(name: string, args: Record<string, unknown>): Promise<string> {
      let result: ToolResult;

      try {
        result = await this.client.callTool(
          { name, arguments: args },
          undefined,
          { timeout: MCP_REQUEST_TIMEOUT },
        ) as ToolResult;
      } catch (error) {
        throw new AutomationBlocked(
          `Playwright MCP call "${name}" failed: ${safeErrorMessage(error)}`,
        );
      }

      const text = (result.content ?? [])
        .filter(item => item.type === 'text')
        .map(item => item.text ?? '')
        .join('\n');

      if (result.isError) {
        throw new AutomationBlocked(
          `Playwright MCP tool "${name}" returned an error: ${redactSecrets(text)}`,
        );
      }

      return text;
    }

    async close(): Promise<string | undefined> {
      let cleanupError: string | undefined;

      try {
        await this.call('browser_close', {});
      } catch (error) {
        cleanupError = safeErrorMessage(error);
      }

      try {
        await this.client.close();
      } catch (error) {
        cleanupError = [
          cleanupError,
          `MCP connection close failed: ${safeErrorMessage(error)}`,
        ].filter(Boolean).join('; ');
      }

      return cleanupError;
    }
  }

  function cellText(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) return '';

    if (typeof value === 'object' && 'text' in value) {
      return String(value.text ?? '');
    }

    return String(value);
  }

  function safeErrorMessage(error: unknown): string {
    return redactSecrets(
      error instanceof Error ? error.message : String(error),
    );
  }

  function redactSecrets(value: string): string {
    let result = value;
    const secretValues = Object.entries(process.env)
      .filter(([name, secret]) =>
        Boolean(secret) &&
        /password|username|credential|secret|token|api[_-]?key/i.test(name),
      )
      .map(([, secret]) => secret!)
      .sort((left, right) => right.length - left.length);

    for (const secret of secretValues) {
      result = result.split(secret).join('[REDACTED]');
    }

    return result.replace(
      /((?:password|passphrase|credential|api[_ -]?key|secret|token)\s*[:=]\s*)[^\s,;]+/gi,
      '$1[REDACTED]',
    );
  }

  function sanitizeForGemini(value: string): string {
    return redactSecrets(value);
  }

  function parseToolValue<T>(text: string): T {
    const resultHeader = text.indexOf('### Result');
    const nextSection = resultHeader >= 0
      ? text.indexOf('\n### ', resultHeader + '### Result'.length)
      : -1;
    const trimmed = (
      resultHeader >= 0
        ? text.slice(
          resultHeader + '### Result'.length,
          nextSection >= 0 ? nextSection : undefined,
        )
        : text
    ).trim();

    try {
      return JSON.parse(trimmed) as T;
    } catch {
      try {
        return JSON.parse(JSON.parse(trimmed) as string) as T;
      } catch {
        throw new AutomationBlocked(
          `Playwright MCP returned an invalid value: ${trimmed.slice(0, 300)}`,
        );
      }
    }
  }

  function normalizeSelector(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/["']/g, '');
  }

  function getRoleForSnapshot(action: Action): string | undefined {
    if (action.locatorType === 'role') return action.role;
    if (action.locatorType === 'label' && action.action === 'fill') {
      return action.role ?? 'textbox';
    }
    return undefined;
  }

  function findSnapshotRef(
    snapshot: string,
    role: string,
    name: string,
  ): string | undefined {
    const expected = `- ${role} ${JSON.stringify(name)}`;

    for (const line of snapshot.split(/\r?\n/)) {
      if (!line.trimStart().startsWith(expected)) continue;
      const ref = line.match(/\[ref=([^\]]+)\]/)?.[1];
      if (ref) return ref;
    }

    return undefined;
  }

  function getMcpFieldType(action: Action):
    | 'textbox'
    | 'checkbox'
    | 'radio'
    | 'combobox'
    | 'slider' {
    switch (action.role) {
      case 'checkbox':
      case 'radio':
      case 'combobox':
      case 'slider':
        return action.role;
      default:
        return 'textbox';
    }
  }

  function resolveTestValue(value: string): string {
    return value.replace(
      /\{\{(TEST_USERNAME|TEST_PASSWORD)\}\}/g,
      (_match, key: string) => {
        const resolved = key === 'TEST_USERNAME'
          ? TEST_USERNAME
          : TEST_PASSWORD;

        if (!resolved) {
          throw new AutomationBlocked(
            `Required environment variable ${key} is not set.`,
          );
        }

        return resolved;
      },
    );
  }

  function isNonProductionUrl(url: URL): boolean {
    const hostname = url.hostname.toLowerCase();

    if (
      ['localhost', '127.0.0.1', '::1'].includes(hostname) ||
      hostname.endsWith('.localhost')
    ) {
      return true;
    }

    return /(^|[.-])(uat|staging|stage|test|testing|qa|dev|development)([.-]|$)/i
      .test(hostname);
  }

  function targetSelector(action: Action): string {
    const locator = action.locator?.trim();

    if (!locator) {
      throw new AutomationBlocked('Required locator is missing.');
    }

    const normalized = normalizeSelector(locator);

    if (
      normalized === '#signin_email_address' ||
      (action.locatorType === 'css' && normalized === 'input[type=email]') ||
      (action.locatorType === 'placeholder' && /^(email|e-?mailaddress)$/.test(normalized)) ||
      (action.locatorType === 'label' && /^(email|e-?mailaddress)$/.test(normalized))
    ) {
      return '#signin_email_address';
    }

    if (normalized === '#register_email_address') {
      return '#register_email_address';
    }

    if (
      normalized === '#signin_password' ||
      (action.locatorType === 'placeholder' && normalized === 'password') ||
      (action.locatorType === 'css' && normalized === 'input[type=password]')
    ) {
      return '#signin_password';
    }

    if (
      normalized === '#s_city' ||
      normalized === 'id=s_city'
    ) {
      return '#s_city';
    }

    switch (action.locatorType) {
      case 'label':
        return `label=${JSON.stringify(locator)}`;

      case 'placeholder':
        return `placeholder=${JSON.stringify(locator)}`;

      case 'role':
        if (!action.role) {
          throw new AutomationBlocked('Accessible role is missing.');
        }

        return `role=${action.role}[name=${JSON.stringify(locator)}]`;

      case 'text':
        return `text=${JSON.stringify(locator)}`;

      case 'css':
        if (
          locator.length > 200 ||
          /[{};]/.test(locator) ||
          /:has-text|:contains|javascript:/i.test(locator)
        ) {
          throw new AutomationBlocked('Unsupported CSS selector.');
        }

        return locator;

      default:
        throw new AutomationBlocked(
          `Unsupported locator type: ${action.locatorType}`,
        );
    }
  }

function validatePlan(plan: Plan): void {
  if (!plan || !Array.isArray(plan.actions) || plan.actions.length === 0) {
    throw new AutomationBlocked('AI did not provide an executable plan.');
  }
  if (plan.actions.length > 100) {
    throw new AutomationBlocked('Plan exceeds the 100-action safety limit.');
  }

  const allowedActions = new Set(['goto', 'fill', 'click', 'press', 'expectVisible', 'expectHidden', 'expectUrl', 'expectText']);
  const allowedLocatorTypes = new Set(['label', 'placeholder', 'role', 'text', 'css']);
  const allowedRoles = new Set(['button', 'link', 'textbox', 'checkbox', 'heading', 'combobox', 'radio', 'slider']);
  const assertions = new Set(['expectVisible', 'expectHidden', 'expectUrl', 'expectText']);
  if (!assertions.has(plan.actions[plan.actions.length - 1]?.action)) {
    throw new AutomationBlocked('The final action must verify the expected result.');
  }
  if (plan.actions.every(action => action.action === 'goto' ||
      (action.action === 'expectVisible' && action.locatorType === 'css' && action.locator?.trim().toLowerCase() === 'body'))) {
    throw new AutomationBlocked('Generic body visibility is not a meaningful test assertion.');
  }

  for (const action of plan.actions) {
    if (!action || !allowedActions.has(action.action)) {
      throw new AutomationBlocked('Unsupported action returned by AI.');
    }
    if (action.action === 'goto' && !action.value?.trim() && action.url?.trim()) {
      action.value = action.url.trim();
    }
    if (action.locatorType && !allowedLocatorTypes.has(action.locatorType)) {
      throw new AutomationBlocked('Unsupported locator type.');
    }
    if (action.role && !allowedRoles.has(action.role)) {
      throw new AutomationBlocked('Unsupported accessible role.');
    }
    if (action.locator && (action.locator.length > 200 || /javascript:/i.test(action.locator))) {
      throw new AutomationBlocked('Unsafe or excessively long locator.');
    }
    if (action.action === 'goto' && !action.value?.trim()) {
      throw new AutomationBlocked('Navigation target is missing.');
    }
    if (['fill', 'press', 'expectUrl', 'expectText'].includes(action.action) && action.value === undefined) {
      throw new AutomationBlocked(`Value missing for ${action.action}.`);
    }
    if (typeof action.value === 'string' && /\{\{(?!TEST_USERNAME\}\}|TEST_PASSWORD\}\})[^}]+\}\}/.test(action.value)) {
      throw new AutomationBlocked('Plan contains an unsupported value placeholder.');
    }
    if (['fill', 'click', 'press', 'expectVisible', 'expectHidden'].includes(action.action) &&
        (!action.locator?.trim() || !action.locatorType)) {
      throw new AutomationBlocked(`Locator missing for ${action.action}.`);
    }
    if (action.action === 'click' && !isSafeClickAction(action)) {
      throw new AutomationBlocked(`Potentially destructive click is blocked: ${action.locator}.`);
    }
    if (action.action === 'goto' && BASE_URL && action.value) {
      const base = new URL(BASE_URL);
      const target = new URL(action.value, base);
      if (target.origin !== base.origin || !['http:', 'https:'].includes(target.protocol)) {
        throw new AutomationBlocked('Navigation outside BASE_URL is blocked.');
      }
    }
  }
}

  async function generateValidatedPlan(
  prompt: string,
  maxAttempts = 3,
): Promise<Plan> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(
        `Gemini plan attempt ${attempt}/${maxAttempts}...`,
      );

      const retryPrompt = attempt === 1
        ? prompt
        : `${prompt}

IMPORTANT: Your previous plan was invalid.
Return valid JSON only, matching the required schema.
The final action must be a meaningful verification assertion.
Use only supported actions and verified selectors.
Do not invent expected text, routes, or application behavior.
If the test cannot be safely automated, return {"actions":[]}.`;

      const plan = await askAIForJSON<Plan>(retryPrompt);

      validatePlan(plan);

      return plan;
    // } catch (error: unknown) {
    //   lastError = error;

    //   console.warn(
    //     `Plan attempt ${attempt} failed: ${safeErrorMessage(error)}`,
    //   );
    // }

    
    } catch (error: unknown) {
      lastError = error;

      const message = safeErrorMessage(error);

      console.warn(
        `Plan attempt ${attempt} failed: ${message}`,
      );

      // Invalid navigation origin: stop retrying immediately.
      if (
        message.includes(
          'Navigation outside BASE_URL is blocked',
        )
      ) {
        throw error;
      }

      // Gemini quota/rate limit: avoid repeated API requests.
      if (
        /429|quota exceeded|rate limit|resource_exhausted/i.test(
          message,
        )
      ) {
        throw new AutomationBlocked(
          'Gemini API quota/rate limit reached. Wait for quota reset before retrying.',
        );
      }
    }

  }

  throw new AutomationBlocked(
    `Could not generate a valid plan after ${maxAttempts} attempts. ` +
      safeErrorMessage(lastError),
  );
}

  async function executeAction(
    browser: McpBrowser,
    action: Action,
    base: URL,
  ): Promise<void> {
    switch (action.action) {
      case 'goto': {
        if (!BASE_URL || !action.value) {
          throw new AutomationBlocked('BASE_URL or navigation target is missing.');
        }

        const target = new URL(action.value, base);

        if (
          target.origin !== base.origin ||
          !['http:', 'https:'].includes(target.protocol)
        ) {
          throw new AutomationBlocked('Navigation outside BASE_URL is blocked.');
        }

        await browser.call('browser_navigate', { url: target.toString() });
        return;
      }

      case 'fill': {
        const target = await resolveTarget(browser, action);
        const value = resolveTestValue(action.value!);
        await browser.call('browser_fill_form', {
          fields: [{
            name: action.locator!,
            target,
            type: getMcpFieldType(action),
            value,
          }],
        });
        return;
      }

      case 'click': {
        if (DESTRUCTIVE_ACTION_PATTERN.test(action.locator ?? '')) {
          throw new AutomationBlocked(
            `Potentially destructive click is blocked: ${action.locator}.`,
          );
        }

        const target = await resolveTarget(browser, action);
        const targetInfoText = await browser.call('browser_evaluate', {
          target,
          function: '(element) => { const link = element.closest("a"); const form = element.closest("form"); return JSON.stringify({ href: link?.href ?? null, formAction: form?.action ?? null }); }',
        });
        const targetInfo = parseToolValue<{
          href: string | null;
          formAction: string | null;
        }>(targetInfoText);

        for (const destination of [targetInfo.href, targetInfo.formAction]) {
          if (!destination) continue;
          const url = new URL(destination, base);
          if (url.origin !== base.origin) {
            throw new AutomationBlocked(
              'Click target would navigate or submit outside BASE_URL.',
            );
          }
        }

        await browser.call('browser_click', {
          target,
          element: action.locator,
        });

        const currentUrl = await getCurrentUrl(browser);
        if (new URL(currentUrl).origin !== base.origin) {
          throw new AutomationBlocked(
            'Click navigated outside BASE_URL; further actions were stopped.',
          );
        }
        return;
      }

      case 'press': {
        const target = await resolveTarget(browser, action);
        await browser.call('browser_evaluate', {
          target,
          function: '(element) => { element.focus(); return true; }',
        });
        await browser.call('browser_press_key', { key: action.value! });
        return;
      }

      case 'expectVisible':
      case 'expectHidden': {
        const expectedVisible = action.action === 'expectVisible';
        const visible = await waitForCondition(
          async () => (await isTargetVisible(browser, action)) === expectedVisible,
        );
        if (!visible) {
          throw new AssertionFailure(
            expectedVisible
              ? `Expected element to become visible: ${action.locator} within ${ACTION_TIMEOUT}ms.`
              : `Expected element to become hidden: ${action.locator} within ${ACTION_TIMEOUT}ms.`,
          );
        }
        return;
      }

      case 'expectUrl': {
        const matched = await waitForCondition(async () =>
          (await getCurrentUrl(browser)).includes(action.value!),
        );
        if (!matched) {
          const currentUrl = await getCurrentUrl(browser);
          throw new AssertionFailure(
            `Expected URL to contain "${action.value}" within ${ACTION_TIMEOUT}ms. Current URL: ${currentUrl}.`,
          );
        }
        return;
      }

      case 'expectText': {
        const expected = JSON.stringify(action.value!);
        const matched = await waitForCondition(async () => {
          const result = await browser.call('browser_evaluate', {
            function:
              `() => { const expected = ${expected}; return Array.from(document.querySelectorAll("body *")).some(element => element.children.length === 0 && (element.innerText || element.textContent || "").trim() === expected && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden"); }`,
          });
          return parseToolValue<boolean>(result);
        });
        if (!matched) {
          throw new AssertionFailure(
            `Expected text was not visible within ${ACTION_TIMEOUT}ms: "${action.value}".`,
          );
        }
        return;
      }

      default:
        throw new AutomationBlocked('Unsupported action.');
    }
  }

  async function waitForCondition(
    condition: () => Promise<boolean>,
  ): Promise<boolean> {
    const deadline = Date.now() + ACTION_TIMEOUT;

    do {
      if (await condition()) return true;
      if (Date.now() >= deadline) return false;
      await new Promise(resolve => setTimeout(resolve, 200));
    } while (Date.now() < deadline);

    return false;
  }

  async function resolveTarget(
    browser: McpBrowser,
    action: Action,
  ): Promise<string> {
    const role = getRoleForSnapshot(action);
    if (role) {
      const snapshot = await browser.call('browser_snapshot', {});
      const ref = findSnapshotRef(snapshot, role, action.locator!);
      if (ref) return ref;

      if (action.locatorType === 'role' || action.locatorType === 'label') {
        throw new AutomationBlocked(
          `No accessible ${role} named "${action.locator}" was found in the page snapshot.`,
        );
      }
    }

    return targetSelector(action);
  }

  async function getCurrentUrl(browser: McpBrowser): Promise<string> {
    const result = await browser.call('browser_evaluate', {
      function: '() => location.href',
    });
    return parseToolValue<string>(result);
  }

  async function isTargetVisible(
    browser: McpBrowser,
    action: Action,
  ): Promise<boolean> {
    const description = JSON.stringify({
      type: action.locatorType,
      locator: action.locator,
      role: action.role,
    });
    const functionBody = `() => {
      const query = ${description};
      const visible = element => {
        const style = getComputedStyle(element);
        return element.getClientRects().length > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) !== 0;
      };
      const all = Array.from(document.querySelectorAll("body *"));
      const accessibleName = element => {
        const ariaLabel = element.getAttribute("aria-label");
        if (ariaLabel) return ariaLabel.trim();
        const labels = Array.from(element.labels || []);
        if (labels.length) return labels.map(label => label.innerText.trim()).join(" ");
        return (element.innerText || element.textContent || "").trim();
      };
      let candidates = [];
      if (query.type === "css") {
        candidates = Array.from(document.querySelectorAll(query.locator));
      } else if (query.type === "placeholder") {
        candidates = all.filter(element => element.getAttribute("placeholder") === query.locator);
      } else if (query.type === "label") {
        const labels = all.filter(element => element.tagName === "LABEL" &&
          (element.innerText || element.textContent || "").trim() === query.locator);
        candidates = labels.map(label => label.control || label);
      } else if (query.type === "text") {
        candidates = all.filter(element => element.children.length === 0 &&
          (element.innerText || element.textContent || "").trim() === query.locator);
      } else if (query.type === "role") {
        const roleOf = element => {
          if (element.getAttribute("role")) return element.getAttribute("role");
          const tag = element.tagName.toLowerCase();
          if (tag === "a" && element.hasAttribute("href")) return "link";
          if (tag === "button" || (tag === "input" && ["button", "submit", "reset"].includes(element.type))) return "button";
          if (tag === "textarea" || (tag === "input" && ["text", "email", "password", "search", "tel", "url", "number"].includes(element.type))) return "textbox";
          if (tag === "input" && element.type === "checkbox") return "checkbox";
          if (tag === "input" && element.type === "radio") return "radio";
          if (tag === "select") return "combobox";
          if (/^h[1-6]$/.test(tag)) return "heading";
          return null;
        };
        candidates = all.filter(element => roleOf(element) === query.role &&
          accessibleName(element) === query.locator);
      }
      return candidates.some(visible);
    }`;
    const result = await browser.call('browser_evaluate', {
      function: functionBody,
    });
    return parseToolValue<boolean>(result);
  }

  async function captureEvidence(
    browser: McpBrowser | undefined,
    testId: string,
    suffix = '',
  ): Promise<{ path: string; error?: string }> {
    if (!browser) return { path: '' };

    const safeId = testId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = path.join(
      EVIDENCE_DIR,
      `${safeId}${suffix}.png`,
    );

    try {
      const filename = path.relative(process.cwd(), filePath);
      await browser.call('browser_take_screenshot', {
        filename,
        fullPage: true,
        scale: 'css',
        type: 'png',
      });
      await fs.access(filePath);

      return {
        path: path.relative(path.resolve('reports'), filePath),
      };
    } catch (error) {
      return {
        path: '',
        error: `Screenshot capture failed: ${safeErrorMessage(error)}`,
      };
    }
  }

  function isSafeClickAction(action: Action): boolean {
    return !DESTRUCTIVE_ACTION_PATTERN.test(action.locator ?? '');
  }


  async function main(): Promise<void> {
    
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

    let failureReasonColumn = headers.get('Failure Reason');
    if (!failureReasonColumn) {
      failureReasonColumn = sheet.columnCount + 1;
      sheet.getCell(1, failureReasonColumn).value = 'Failure Reason';
      sheet.getColumn(failureReasonColumn).width = 55;
      headers.set('Failure Reason', failureReasonColumn);
    }

    sheet.autoFilter = {
      from: 'A1',
      to: `${sheet.getColumn(failureReasonColumn).letter}${sheet.rowCount}`,
    };

    const col = (name: string) => headers.get(name)!;
    let base: URL | undefined;
    let preflightFailure = '';

    try {
      if (!BASE_URL) {
        throw new AutomationBlocked('Set BASE_URL in the .env file.');
      }

      base = new URL(BASE_URL);
      if (
        !['http:', 'https:'].includes(base.protocol) ||
        base.username ||
        base.password
      ) {
        throw new AutomationBlocked(
          'BASE_URL must be an HTTP(S) URL without embedded credentials.',
        );
      }
      if (!isNonProductionUrl(base)) {
        throw new AutomationBlocked(
          'Production hosts are blocked; configure BASE_URL for UAT, staging, test, or local use.',
        );
      }
    } catch (error) {
      preflightFailure = safeErrorMessage(error);
    }
    let passed = 0;
    let failed = 0;
    let blocked = 0;

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const testId =
        cellText(row.getCell(col('Test Case ID')).value).trim() ||
        `ROW${rowNumber}`;
      const requirement = cellText(row.getCell(col('Requirement')).value);
      const scenario = cellText(row.getCell(col('Scenario')).value);
      const steps = cellText(row.getCell(col('Test Steps')).value);
      const testData = cellText(row.getCell(col('Test Data')).value);
      const expected = cellText(row.getCell(col('Expected Result')).value);

      let browser: McpBrowser | undefined;
      let status: 'PASS' | 'FAIL' | 'BLOCKED' = 'BLOCKED';
      let actualResult = '';
      let failureReason = '';
      let evidencePath = '';

      try {
        if (preflightFailure) {
          throw new AutomationBlocked(preflightFailure);
        }
        if (!base) {
          throw new AutomationBlocked('BASE_URL validation did not complete.');
        }
        if (!steps.trim() || !expected.trim()) {
          throw new AutomationBlocked(
            'Test steps or expected result is missing.',
          );
        }

        console.log(`${testId}: Creating test plan...`);
const prompt = `
You are a QA test-plan generator for an existing web application.
Return one valid JSON object only. Do not return markdown.

Required schema: {"actions":[{"action":"goto","value":"/relative/path"},{"action":"expectVisible","locatorType":"role","role":"heading","locator":"Verified heading"}]}
The schema example is illustrative only. Do not copy its actions unless the test explicitly requires them.

Supported actions:
- goto: {"action":"goto","value":"/relative/path"}
- fill: {"action":"fill","locatorType":"css|label|placeholder|role","locator":"selector or accessible name","role":"textbox","value":"..."}
- click: {"action":"click","locatorType":"role|text|css|label|placeholder","locator":"...","role":"button"}
- press: {"action":"press","locatorType":"css|label|placeholder|role","locator":"...","role":"textbox","value":"Enter"}
- expectVisible: {"action":"expectVisible","locatorType":"css|label|placeholder|role|text","locator":"...","role":"heading"}
- expectHidden: {"action":"expectHidden","locatorType":"css|label|placeholder|role|text","locator":"...","role":"heading"}
- expectUrl: {"action":"expectUrl","value":"expected URL substring"}
- expectText: {"action":"expectText","value":"exact visible text"}

Navigation rules:
- The only allowed origin is: ${base.origin}
- Use "value", not "url", for goto actions.
- Use "/" for the initial application page unless the test steps explicitly specify a verified relative route.
- Only use routes explicitly provided in the test steps or known application context.
- Never use example.com, about:blank, or an invented URL.
- Never navigate to another origin.
- The runner will open the configured BASE_URL before executing actions.

Known selectors:
- Login email: #signin_email_address
- Registration email: #register_email_address
- Login password: #signin_password
- Login button: accessible role button named Login
- City search: #s_city

Test data rules:
- For login email, use locatorType "css", locator "#signin_email_address".
- For login password, use locatorType "css", locator "#signin_password".
- Never output real credentials.
- Use "{{TEST_USERNAME}}" and "{{TEST_PASSWORD}}" only when the scenario requires those credentials.
- Do not confuse registration email with login email.
- Do not invent selectors, credentials, routes, success messages, or application behavior.
- Do not invent expected text.
- Map actions to the supplied test steps and expected result.
- Do not perform destructive or data-changing actions, including submit, save, update, delete, create, purchase, pay, book, or cancel.
- If the test requires a blocked action or cannot be mapped reliably, return {"actions":[]}.
- Include at least one meaningful verification assertion that checks the specific Expected result.
- A generic body visibility check is never sufficient.
- The final action must be a verification assertion.
- Use only the supported schema above.

Application URL: ${base.origin}${base.pathname}
Test ID: ${sanitizeForGemini(testId)}
Requirement: ${sanitizeForGemini(requirement)}
Scenario: ${sanitizeForGemini(scenario)}
Steps: ${sanitizeForGemini(steps)}
Test data: ${sanitizeForGemini(testData)}
Expected result: ${sanitizeForGemini(expected)}
`;

const plan = await generateValidatedPlan(prompt);



        for (const action of plan.actions) {
          if (action.action === 'fill') {
            const normalized = normalizeSelector(action.locator ?? '');
            if (
              /password/.test(normalized) &&
              action.value !== '{{TEST_PASSWORD}}'
            ) {
              throw new AutomationBlocked(
                'Password fields must use the {{TEST_PASSWORD}} placeholder.',
              );
            }
            if (
              /email|username/.test(normalized) &&
              action.value !== '{{TEST_USERNAME}}'
            ) {
              throw new AutomationBlocked(
                'Username fields must use the {{TEST_USERNAME}} placeholder.',
              );
            }
          }
        }

        browser = await McpBrowser.launch();
        await browser.call('browser_navigate', { url: base.toString() });

        for (const action of plan.actions) {
          await executeAction(browser, action, base);
        }

        status = 'PASS';
        actualResult = 'All planned actions and verification assertions completed.';
        const screenshot = await captureEvidence(browser, testId);
        evidencePath = screenshot.path;
        if (screenshot.error) {
          actualResult += ` ${screenshot.error}`;
        }
      } catch (error: unknown) {
        const message = safeErrorMessage(error);
        status = error instanceof AssertionFailure ? 'FAIL' : 'BLOCKED';
        actualResult = message.slice(0, 1000);
        failureReason = message.slice(0, 1000);

        const screenshot = await captureEvidence(
          browser,
          testId,
          '-failure',
        );
        evidencePath = screenshot.path;
        if (screenshot.error) {
          failureReason =
            `${failureReason} ${screenshot.error}`.slice(0, 1500);
        }
      } finally {
        if (browser) {
          const cleanupWarning = await browser.close();
          if (cleanupWarning) {
            actualResult = `${actualResult} Cleanup warning: ${cleanupWarning}`
              .trim()
              .slice(0, 1500);
          }
        }
      }

      row.getCell(col('Execution Status')).value = status;
      row.getCell(col('Actual Result')).value = actualResult;
      row.getCell(col('Evidence Path')).value = evidencePath;
      row.getCell(col('Failure Reason')).value = failureReason;

      if (status === 'PASS') passed++;
      else if (status === 'FAIL') failed++;
      else blocked++;

      console.log(
        `${testId}: ${status}${failureReason ? ` - ${failureReason}` : ''}`,
      );

      await workbook.xlsx.writeFile(OUTPUT_FILE);
    }

    console.log('');
    console.log('Execution summary');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Blocked: ${blocked}`);
    console.log(`Excel report: ${OUTPUT_FILE}`);
    console.log(`Evidence folder: ${EVIDENCE_DIR}`);
  }
void main().catch((error: unknown) => {
    console.error(
      'Execution runner failed:',
      safeErrorMessage(error),
    );
    process.exitCode = 1;
  });
