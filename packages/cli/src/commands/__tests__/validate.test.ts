import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { validateCommand } from '../validate.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-validate-test-'));
}

function writeFile(dir: string, filePath: string, content: string): void {
  const fullPath = path.join(dir, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

const validAppYaml = `
id: my-test-app
name: My Test App
base_url: "https://example.com"
url_patterns:
  - "/app/**"
description: "A test app"
`;

const validPageYaml = `
id: home_page
app: my-test-app
url_pattern: "/app/home"
wait_for: ".content"
fields:
  - id: search_input
    label: Search
    type: text
    selectors:
      - strategy: css
        selector: "input.search"
      - strategy: aria
        role: textbox
        name: Search
    interaction:
      type: fill
  - id: search_btn
    label: Search Button
    type: action_button
    selectors:
      - strategy: css
        selector: "button.search"
      - strategy: aria
        role: button
        name: Search
    interaction:
      type: click
outputs:
  - id: results
    label: Results
    selectors:
      - strategy: css
        selector: ".results"
`;

const validToolYaml = `
name: search_app
description: "Search the app"
inputSchema:
  type: object
  properties:
    query:
      type: string
  required: [query]
bridge:
  page: home_page
  steps:
    - interact:
        field: home_page.fields.search_input
        value: "{{query}}"
`;

const validWorkflowYaml = `
name: batch_search
description: "Search multiple queries"
input:
  queries:
    type: array
    required: true
steps:
  - for_each: "{{queries}}"
    as: q
    on_error: continue
    steps:
      - tool: search_app
        params:
          query: "{{q}}"
`;

describe('validateCommand', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns success for valid app directory', async () => {
    writeFile(tmpDir, 'app.yaml', validAppYaml);
    writeFile(tmpDir, 'pages/home.yaml', validPageYaml);
    writeFile(tmpDir, 'tools/search.yaml', validToolYaml);
    writeFile(tmpDir, 'workflows/batch.yaml', validWorkflowYaml);

    const result = await validateCommand(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.fileCount).toBe(4);
  });

  it('reports error for missing app.yaml', async () => {
    writeFile(tmpDir, 'pages/home.yaml', validPageYaml);

    const result = await validateCommand(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes('app.yaml'))).toBe(true);
  });

  it('reports validation errors in page yaml', async () => {
    writeFile(tmpDir, 'app.yaml', validAppYaml);
    writeFile(tmpDir, 'pages/bad.yaml', `
id: bad_page
app: my-test-app
url_pattern: "/"
fields: []
outputs: []
`);

    const result = await validateCommand(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('reports YAML parse errors', async () => {
    writeFile(tmpDir, 'app.yaml', '{ bad yaml: [unclosed');

    const result = await validateCommand(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /parse/i.test(e))).toBe(true);
  });

  it('reports errors for invalid tool schema', async () => {
    writeFile(tmpDir, 'app.yaml', validAppYaml);
    writeFile(tmpDir, 'tools/bad.yaml', `
name: bad tool with spaces
description: ""
inputSchema:
  type: object
bridge:
  page: home
  steps: []
`);

    const result = await validateCommand(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns error for nonexistent directory', async () => {
    const result = await validateCommand('/nonexistent/dir');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /not found|not exist/i.test(e))).toBe(true);
  });

  it('returns summary info about files', async () => {
    writeFile(tmpDir, 'app.yaml', validAppYaml);
    writeFile(tmpDir, 'pages/home.yaml', validPageYaml);
    writeFile(tmpDir, 'tools/search.yaml', validToolYaml);

    const result = await validateCommand(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.fileCount).toBe(3);
    expect(result.summary.apps).toBe(1);
    expect(result.summary.pages).toBe(1);
    expect(result.summary.tools).toBe(1);
  });

  it('handles empty directory', async () => {
    const result = await validateCommand(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /app\.yaml/i.test(e) || /no.*yaml/i.test(e))).toBe(true);
  });

  it('handles app.yaml with wrapper key', async () => {
    writeFile(tmpDir, 'app.yaml', `
app:
  id: my-test-app
  name: My Test App
  base_url: "https://example.com"
  url_patterns:
    - "/app/**"
  description: "A test app"
`);

    const result = await validateCommand(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.summary.apps).toBe(1);
  });

  it('validates all files and reports multiple errors', async () => {
    writeFile(tmpDir, 'app.yaml', validAppYaml);
    writeFile(tmpDir, 'pages/bad1.yaml', `
id: bad
app: x
url_pattern: "/"
fields: []
outputs: []
`);
    writeFile(tmpDir, 'pages/bad2.yaml', `
id: bad2
app: x
url_pattern: "/"
fields: []
outputs: []
`);

    const result = await validateCommand(tmpDir);
    expect(result.valid).toBe(false);
    // Should have errors from both files
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});
