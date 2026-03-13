import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { publishCommand } from '../publish.js';

// Mock fetch for remote registry
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-publish-test-'));
}

function writeFile(dir: string, filePath: string, content: string): void {
  const fullPath = path.join(dir, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

function createValidApp(tmpDir: string): string {
  const appDir = path.join(tmpDir, 'my_app');
  writeFile(appDir, 'app.yaml', `
id: my-app
name: My App
base_url: "https://example.com"
url_patterns:
  - "/app/**"
description: "Test app"
`);
  writeFile(appDir, 'pages/home.yaml', `
id: home
app: my-app
url_pattern: "/app/home"
wait_for: ".content"
fields:
  - id: input_one
    label: Input One
    type: text
    selectors:
      - strategy: css
        selector: "input.one"
      - strategy: aria
        role: textbox
        name: One
    interaction:
      type: fill
  - id: input_two
    label: Input Two
    type: text
    selectors:
      - strategy: css
        selector: "input.two"
      - strategy: aria
        role: textbox
        name: Two
    interaction:
      type: fill
outputs:
  - id: result
    label: Result
    selectors:
      - strategy: css
        selector: ".result"
`);
  writeFile(appDir, 'tools/action.yaml', `
name: do_action
description: "Do an action"
inputSchema:
  type: object
  properties:
    input:
      type: string
  required: [input]
bridge:
  page: home
  steps:
    - interact:
        field: home.fields.input_one
        value: "{{input}}"
`);
  return appDir;
}

describe('publishCommand', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    mockFetch.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('validates before publishing', async () => {
    const badDir = path.join(tmpDir, 'bad');
    fs.mkdirSync(badDir);

    const result = await publishCommand(badDir, {
      appId: 'bad_app',
      version: '1.0.0',
      registryUrl: 'https://registry.example.com',
      apiKey: 'test-key',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/validation|app\.yaml/i);
    // fetch should not have been called
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('publishes valid app to local registry', async () => {
    const appDir = createValidApp(tmpDir);
    const registryBase = path.join(tmpDir, 'local-registry');

    const result = await publishCommand(appDir, {
      appId: 'my-app',
      version: '1.0.0',
      localRegistryPath: registryBase,
    });

    expect(result.success).toBe(true);

    // Verify installed in local registry
    const installPath = path.join(registryBase, 'my-app', '1.0.0', 'app.yaml');
    expect(fs.existsSync(installPath)).toBe(true);
  });

  it('rejects publish without app ID', async () => {
    const appDir = createValidApp(tmpDir);

    const result = await publishCommand(appDir, {
      appId: '',
      version: '1.0.0',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/app.*id/i);
  });

  it('rejects publish without version', async () => {
    const appDir = createValidApp(tmpDir);

    const result = await publishCommand(appDir, {
      appId: 'my-app',
      version: '',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/version/i);
  });
});
