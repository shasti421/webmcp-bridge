import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { pullCommand } from '../pull.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-pull-test-'));
}

function writeFile(dir: string, filePath: string, content: string): void {
  const fullPath = path.join(dir, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

/**
 * Create a mock "remote" app that simulates a downloaded bundle
 * already extracted to a local path.
 */
function createMockRemoteApp(tmpDir: string): string {
  const sourceDir = path.join(tmpDir, 'remote-source');
  writeFile(sourceDir, 'app.yaml', `
id: remote-app
name: Remote App
base_url: "https://remote.example.com"
url_patterns:
  - "/remote/**"
description: "Remote test app"
`);
  writeFile(sourceDir, 'pages/main.yaml', `
id: main_page
app: remote-app
url_pattern: "/remote/main"
wait_for: ".main"
fields:
  - id: field_a
    label: Field A
    type: text
    selectors:
      - strategy: css
        selector: "input.a"
      - strategy: aria
        role: textbox
        name: A
    interaction:
      type: fill
  - id: field_b
    label: Field B
    type: text
    selectors:
      - strategy: css
        selector: "input.b"
      - strategy: aria
        role: textbox
        name: B
    interaction:
      type: fill
outputs:
  - id: output_main
    label: Main Output
    selectors:
      - strategy: css
        selector: ".output"
`);
  writeFile(sourceDir, 'tools/main_action.yaml', `
name: main_action
description: "Main action"
inputSchema:
  type: object
  properties:
    value:
      type: string
bridge:
  page: main_page
  steps:
    - interact:
        field: main_page.fields.field_a
        value: "{{value}}"
`);
  return sourceDir;
}

describe('pullCommand', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('installs app from local source path to local registry', async () => {
    const sourceDir = createMockRemoteApp(tmpDir);
    const registryBase = path.join(tmpDir, 'local-registry');

    const result = await pullCommand({
      appId: 'remote-app',
      version: '1.0.0',
      sourcePath: sourceDir,
      localRegistryPath: registryBase,
    });

    expect(result.success).toBe(true);

    // Verify installed in local registry
    const installPath = path.join(registryBase, 'remote-app', '1.0.0', 'app.yaml');
    expect(fs.existsSync(installPath)).toBe(true);
  });

  it('rejects pull without app ID', async () => {
    const result = await pullCommand({
      appId: '',
      version: '1.0.0',
      sourcePath: '/some/path',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/app.*id/i);
  });

  it('fails when source path does not exist', async () => {
    const result = await pullCommand({
      appId: 'my-app',
      version: '1.0.0',
      sourcePath: '/nonexistent/path',
      localRegistryPath: path.join(tmpDir, 'registry'),
    });

    expect(result.success).toBe(false);
  });

  it('fails when app is already installed', async () => {
    const sourceDir = createMockRemoteApp(tmpDir);
    const registryBase = path.join(tmpDir, 'local-registry');

    // Install first time
    await pullCommand({
      appId: 'remote-app',
      version: '1.0.0',
      sourcePath: sourceDir,
      localRegistryPath: registryBase,
    });

    // Try to install again
    const result = await pullCommand({
      appId: 'remote-app',
      version: '1.0.0',
      sourcePath: sourceDir,
      localRegistryPath: registryBase,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already installed/i);
  });

  it('supports pulling different versions', async () => {
    const sourceDir = createMockRemoteApp(tmpDir);
    const registryBase = path.join(tmpDir, 'local-registry');

    const r1 = await pullCommand({
      appId: 'remote-app',
      version: '1.0.0',
      sourcePath: sourceDir,
      localRegistryPath: registryBase,
    });
    expect(r1.success).toBe(true);

    const r2 = await pullCommand({
      appId: 'remote-app',
      version: '2.0.0',
      sourcePath: sourceDir,
      localRegistryPath: registryBase,
    });
    expect(r2.success).toBe(true);

    // Both versions should exist
    expect(fs.existsSync(path.join(registryBase, 'remote-app', '1.0.0', 'app.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(registryBase, 'remote-app', '2.0.0', 'app.yaml'))).toBe(true);
  });
});
