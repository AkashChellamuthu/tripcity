
import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { askAIForJSON } from '../utils/ai';

type TestCase = {
  id: string;
  requirement: string;
  scenario: string;
  type: 'Positive' | 'Negative' | 'Boundary' | 'Validation';
  preconditions: string;
  steps: string[];
  testData: string;
  expectedResult: string;
  priority: 'High' | 'Medium' | 'Low';
};

async function main() {
  const requirementPath = path.resolve(
    'requirements',
    'requirement.txt'
  );

  const requirement = await fs.readFile(requirementPath, 'utf8');

  if (!requirement.trim()) {
    throw new Error('Requirement file is empty.');
  }

  const prompt = `
You are an experienced software QA engineer.

Analyze the requirement below and generate comprehensive,
non-duplicate manual test cases.

Include positive, negative, validation and relevant boundary cases.
Do not invent application URLs, selectors, credentials or unspecified
business rules. Use "Not specified" where details are missing.

Return valid JSON only, using this exact structure:
{
  "testCases": [
    {
      "id": "TC001",
      "requirement": "Requirement covered",
      "scenario": "Short scenario name",
      "type": "Positive",
      "preconditions": "Preconditions",
      "steps": ["Step 1", "Step 2"],
      "testData": "Required test data",
      "expectedResult": "Expected behavior",
      "priority": "High"
    }
  ]
}

Allowed type values: Positive, Negative, Boundary, Validation.
Allowed priority values: High, Medium, Low.
Generate at least one case for each applicable requirement.

REQUIREMENT:
${requirement}
`;

  const result = await askAIForJSON<{ testCases: TestCase[] }>(prompt);

  if (
    !result ||
    !Array.isArray(result.testCases) ||
    result.testCases.length === 0
  ) {
    throw new Error('Gemini returned no valid test cases.');
  }

  const validTypes = new Set([
    'Positive',
    'Negative',
    'Boundary',
    'Validation',
  ]);

  const validPriorities = new Set(['High', 'Medium', 'Low']);

  for (const [index, tc] of result.testCases.entries()) {
    if (
      !tc.scenario ||
      !tc.expectedResult ||
      !Array.isArray(tc.steps) ||
      tc.steps.length === 0 ||
      !validTypes.has(tc.type) ||
      !validPriorities.has(tc.priority)
    ) {
      throw new Error(`Invalid test case data at item ${index + 1}.`);
    }
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AI QA Test Case Generator';

  const sheet = workbook.addWorksheet('Test Cases');

  sheet.columns = [
    { header: 'Test Case ID', key: 'id', width: 15 },
    { header: 'Requirement', key: 'requirement', width: 35 },
    { header: 'Scenario', key: 'scenario', width: 35 },
    { header: 'Test Type', key: 'type', width: 15 },
    { header: 'Preconditions', key: 'preconditions', width: 30 },
    { header: 'Test Steps', key: 'steps', width: 50 },
    { header: 'Test Data', key: 'testData', width: 30 },
    { header: 'Expected Result', key: 'expectedResult', width: 40 },
    { header: 'Priority', key: 'priority', width: 12 },
    { header: 'Execution Status', key: 'status', width: 18 },
    { header: 'Actual Result', key: 'actualResult', width: 35 },
    { header: 'Evidence Path', key: 'evidence', width: 35 },
  ];

  for (const tc of result.testCases) {
    sheet.addRow({
      ...tc,
      steps: tc.steps.map((step, i) => `${i + 1}. ${step}`).join('\n'),
      status: 'Not Run',
      actualResult: '',
      evidence: '',
    });
  }

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = {
    vertical: 'middle',
    wrapText: true,
  };

  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = {
    from: 'A1',
    to: `L${result.testCases.length + 1}`,
  };

  const outputDir = path.resolve('reports');
  await fs.mkdir(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, 'AI-Generated-Test-Cases.xlsx');
  await workbook.xlsx.writeFile(outputPath);

  console.log(`Generated ${result.testCases.length} test cases.`);
  console.log(`Excel report: ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error(
    'Test case generation failed:',
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
});
