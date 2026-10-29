Tripcity-ai

## AI-generated Playwright MCP test execution

The execution runner reads `reports/AI-Generated-Test-Cases.xlsx`, generates
validated action plans with Gemini, and executes them through a
Playwright MCP stdio client. It starts one isolated, headless MCP server for
each test case in sequence; it does not reuse VS Code's MCP connection or run
parallel browser servers.

Configure `BASE_URL` to a non-production environment (for example, a UAT,
staging, test, or local URL) in `.env`. Set `GEMINI_API_KEY` there to generate
plans. Set `TEST_USERNAME` and `TEST_PASSWORD` only when a test needs valid
login credentials; the runner substitutes these locally and does not send
their values to Gemini. No credentials are hardcoded in the project.

Install dependencies and browsers as needed, then run:

```powershell
npm.cmd install
npx.cmd @playwright/mcp@0.0.83 install-browser chrome-for-testing
npm.cmd run generate:test-cases
npm.cmd run execute:test-cases
```

The runner updates `reports/AI-Execution-Report.xlsx` after every case and
writes screenshots to `reports/evidence/`. Existing workbook columns are
preserved; a `Failure Reason` column is appended when missing. Actions that
could delete, cancel, add, update, save, purchase, reserve, or otherwise
change account data are blocked. Production hosts are blocked.

The VS Code MCP server configuration pins the same Playwright MCP version.
Standalone execution starts its own stdio server process because VS Code's
stdio MCP session is not available to Node.js scripts.
