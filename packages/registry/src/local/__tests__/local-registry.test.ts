import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { LocalRegistry } from '../local-registry.js';

/**
 * Helper: create a valid app directory for install tests.
 */
function createTestAppDir(tmpDir: string, appId: string): string {
  const appDir = path.join(tmpDir, `source-${appId}`);
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(path.join(appDir, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(appDir, 'tools'), { recursive: true });
  fs.mkdirSync(path.join(appDir, 'workflows'), { recursive: true });

  fs.writeFileSync(
    path.join(appDir, 'app.yaml'),
    `id: ${appId}
name: Test App
base_url: https://example.com
url_patterns:
  - /app/**
description: A test application
registry:
  publisher: tester
  tags:
    - productivity
    - web
  license: MIT
`,
  );

  // Create a page
  fs.writeFileSync(
    path.join(appDir, 'pages', 'home.yaml'),
    `id: home
app: ${appId}
url_pattern: /app/home
wait_for: .content
fields:
  - id: search_input
    label: Search
    type: text
    selectors:
      - strategy: css
        selector: input.search
    interaction:
      type: fill
  - id: search_btn
    label: Search Button
    type: action_button
    selectors:
      - strategy: css
        selector: button.search
    interaction:
      type: click
outputs:
  - id: results
    label: Results
    selectors:
      - strategy: css
        selector: .results
`,
  );

  // Create a tool
  fs.writeFileSync(
    path.join(appDir, 'tools', 'search.yaml'),
    `name: search
description: Search the app
inputSchema:
  type: object
  properties:
    query:
      type: string
  required: [query]
bridge:
  page: home
  steps:
    - interact:
        field: home.fields.search_input
        value: "{{query}}"
`,
  );

  return appDir;
}

describe('LocalRegistry', () => {
  let tmpDir: string;
  let registryBasePath: string;
  let registry: LocalRegistry;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-registry-test-'));
    registryBasePath = path.join(tmpDir, 'registry');
    registry = new LocalRegistry(registryBasePath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── install ─────────────────────────────────────────────

  describe('install', () => {
    it('installs app from local directory', async () => {
      const appDir = createTestAppDir(tmpDir, 'my_app');
      await registry.install('my_app', '1.0.0', appDir);

      // Verify files were copied
      const installPath = path.join(registryBasePath, 'my_app', '1.0.0');
      expect(fs.existsSync(path.join(installPath, 'app.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(installPath, 'pages', 'home.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(installPath, 'tools', 'search.yaml'))).toBe(true);
    });

    it('creates metadata.json on install', async () => {
      const appDir = createTestAppDir(tmpDir, 'my_app');
      await registry.install('my_app', '1.0.0', appDir);

      const metadataPath = path.join(registryBasePath, 'my_app', '1.0.0', 'metadata.json');
      expect(fs.existsSync(metadataPath)).toBe(true);

      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      expect(metadata.appId).toBe('my_app');
      expect(metadata.version).toBe('1.0.0');
      expect(metadata.name).toBe('Test App');
      expect(metadata.pageCount).toBe(1);
      expect(metadata.toolCount).toBe(1);
    });

    it('updates registry index on install', async () => {
      const appDir = createTestAppDir(tmpDir, 'my_app');
      await registry.install('my_app', '1.0.0', appDir);

      const indexPath = path.join(registryBasePath, 'registry-index.json');
      expect(fs.existsSync(indexPath)).toBe(true);

      const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      expect(index['my_app']).toBeDefined();
      expect(index['my_app'].versions).toContain('1.0.0');
      expect(index['my_app'].latest).toBe('1.0.0');
    });

    it('rejects install if version already exists', async () => {
      const appDir = createTestAppDir(tmpDir, 'my_app');
      await registry.install('my_app', '1.0.0', appDir);

      await expect(registry.install('my_app', '1.0.0', appDir)).rejects.toThrow(
        /already installed/i,
      );
    });

    it('rejects install if app.yaml is missing', async () => {
      const badDir = path.join(tmpDir, 'bad-app');
      fs.mkdirSync(badDir, { recursive: true });
      fs.mkdirSync(path.join(badDir, 'pages'));
      fs.mkdirSync(path.join(badDir, 'tools'));

      await expect(registry.install('bad_app', '1.0.0', badDir)).rejects.toThrow(
        /app\.yaml/i,
      );
    });

    it('rejects install if pages/ is missing', async () => {
      const badDir = path.join(tmpDir, 'bad-app');
      fs.mkdirSync(badDir, { recursive: true });
      fs.writeFileSync(path.join(badDir, 'app.yaml'), 'id: bad\nname: Bad');
      fs.mkdirSync(path.join(badDir, 'tools'));

      await expect(registry.install('bad_app', '1.0.0', badDir)).rejects.toThrow(
        /pages/i,
      );
    });

    it('rejects install if tools/ is missing', async () => {
      const badDir = path.join(tmpDir, 'bad-app');
      fs.mkdirSync(badDir, { recursive: true });
      fs.writeFileSync(path.join(badDir, 'app.yaml'), 'id: bad\nname: Bad');
      fs.mkdirSync(path.join(badDir, 'pages'));

      await expect(registry.install('bad_app', '1.0.0', badDir)).rejects.toThrow(
        /tools/i,
      );
    });

    it('supports multiple versions of same app', async () => {
      const appDir = createTestAppDir(tmpDir, 'my_app');
      await registry.install('my_app', '1.0.0', appDir);
      await registry.install('my_app', '1.1.0', appDir);

      const versions = await registry.listVersions('my_app');
      expect(versions).toContain('1.0.0');
      expect(versions).toContain('1.1.0');
    });
  });

  // ─── uninstall ───────────────────────────────────────────

  describe('uninstall', () => {
    it('removes specific version', async () => {
      const appDir = createTestAppDir(tmpDir, 'my_app');
      await registry.install('my_app', '1.0.0', appDir);

      await registry.uninstall('my_app', '1.0.0');

      const installPath = path.join(registryBasePath, 'my_app', '1.0.0');
      expect(fs.existsSync(installPath)).toBe(false);
    });

    it('updates index after uninstall', async () => {
      const appDir = createTestAppDir(tmpDir, 'my_app');
      await registry.install('my_app', '1.0.0', appDir);
      await registry.install('my_app', '1.1.0', appDir);

      await registry.uninstall('my_app', '1.0.0');

      const indexPath = path.join(registryBasePath, 'registry-index.json');
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      expect(index['my_app'].versions).not.toContain('1.0.0');
      expect(index['my_app'].versions).toContain('1.1.0');
    });

    it('removes app entry from index when last version removed', async () => {
      const appDir = createTestAppDir(tmpDir, 'my_app');
      await registry.install('my_app', '1.0.0', appDir);
      await registry.uninstall('my_app', '1.0.0');

      const indexPath = path.join(registryBasePath, 'registry-index.json');
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      expect(index['my_app']).toBeUndefined();
    });

    it('throws when app not found', async () => {
      await expect(registry.uninstall('nonexistent', '1.0.0')).rejects.toThrow(
        /not found/i,
      );
    });
  });

  // ─── list ────────────────────────────────────────────────

  describe('list', () => {
    it('returns empty array when no apps installed', async () => {
      const result = await registry.list();
      expect(result).toEqual([]);
    });

    it('returns all installed apps', async () => {
      const appDir1 = createTestAppDir(tmpDir, 'app_one');
      const appDir2 = createTestAppDir(tmpDir, 'app_two');
      await registry.install('app_one', '1.0.0', appDir1);
      await registry.install('app_two', '2.0.0', appDir2);

      const result = await registry.list();
      expect(result).toHaveLength(2);

      const ids = result.map((e) => e.appId);
      expect(ids).toContain('app_one');
      expect(ids).toContain('app_two');
    });

    it('includes version info in list', async () => {
      const appDir = createTestAppDir(tmpDir, 'my_app');
      await registry.install('my_app', '1.0.0', appDir);
      await registry.install('my_app', '1.1.0', appDir);

      const result = await registry.list();
      expect(result).toHaveLength(1);
      expect(result[0]!.versions).toContain('1.0.0');
      expect(result[0]!.versions).toContain('1.1.0');
    });
  });

  // ─── listVersions ───────────────────────────────────────

  describe('listVersions', () => {
    it('returns versions for installed app', async () => {
      const appDir = createTestAppDir(tmpDir, 'my_app');
      await registry.install('my_app', '1.0.0', appDir);
      await registry.install('my_app', '2.0.0', appDir);

      const versions = await registry.listVersions('my_app');
      expect(versions).toEqual(['1.0.0', '2.0.0']);
    });

    it('returns empty array for unknown app', async () => {
      const versions = await registry.listVersions('nonexistent');
      expect(versions).toEqual([]);
    });
  });

  // ─── resolve ─────────────────────────────────────────────

  describe('resolve', () => {
    it('returns path to latest version by default', async () => {
      const appDir = createTestAppDir(tmpDir, 'my_app');
      await registry.install('my_app', '1.0.0', appDir);
      await registry.install('my_app', '1.1.0', appDir);

      const resolved = await registry.resolve('my_app');
      expect(resolved).toBe(path.join(registryBasePath, 'my_app', '1.1.0'));
    });

    it('returns path to specific version', async () => {
      const appDir = createTestAppDir(tmpDir, 'my_app');
      await registry.install('my_app', '1.0.0', appDir);
      await registry.install('my_app', '1.1.0', appDir);

      const resolved = await registry.resolve('my_app', '1.0.0');
      expect(resolved).toBe(path.join(registryBasePath, 'my_app', '1.0.0'));
    });

    it('returns null for unknown app', async () => {
      const resolved = await registry.resolve('nonexistent');
      expect(resolved).toBeNull();
    });

    it('returns null for unknown version', async () => {
      const appDir = createTestAppDir(tmpDir, 'my_app');
      await registry.install('my_app', '1.0.0', appDir);

      const resolved = await registry.resolve('my_app', '9.9.9');
      expect(resolved).toBeNull();
    });
  });

  // ─── search ──────────────────────────────────────────────

  describe('search', () => {
    it('returns empty when no apps match', async () => {
      const appDir = createTestAppDir(tmpDir, 'my_app');
      await registry.install('my_app', '1.0.0', appDir);

      const results = await registry.search('zzz_nonexistent');
      expect(results).toEqual([]);
    });

    it('matches by app name (case-insensitive)', async () => {
      const appDir = createTestAppDir(tmpDir, 'my_app');
      await registry.install('my_app', '1.0.0', appDir);

      const results = await registry.search('test app');
      expect(results).toHaveLength(1);
      expect(results[0]!.appId).toBe('my_app');
    });

    it('matches by description (case-insensitive)', async () => {
      const appDir = createTestAppDir(tmpDir, 'my_app');
      await registry.install('my_app', '1.0.0', appDir);

      const results = await registry.search('application');
      expect(results).toHaveLength(1);
      expect(results[0]!.appId).toBe('my_app');
    });

    it('matches by app ID', async () => {
      const appDir = createTestAppDir(tmpDir, 'my_app');
      await registry.install('my_app', '1.0.0', appDir);

      const results = await registry.search('my_app');
      expect(results).toHaveLength(1);
    });

    it('returns all when query is empty', async () => {
      const appDir1 = createTestAppDir(tmpDir, 'app_one');
      const appDir2 = createTestAppDir(tmpDir, 'app_two');
      await registry.install('app_one', '1.0.0', appDir1);
      await registry.install('app_two', '1.0.0', appDir2);

      const results = await registry.search('');
      expect(results).toHaveLength(2);
    });

    it('includes tags in search results', async () => {
      const appDir = createTestAppDir(tmpDir, 'my_app');
      await registry.install('my_app', '1.0.0', appDir);

      const results = await registry.search('test');
      expect(results[0]!.tags).toContain('productivity');
    });
  });
});
