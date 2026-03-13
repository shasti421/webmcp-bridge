import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { initCommand } from '../init.js';

describe('initCommand', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-init-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates app directory with correct structure', async () => {
    const appDir = path.join(tmpDir, 'my_app');
    await initCommand('my_app', { outputDir: tmpDir });

    expect(fs.existsSync(appDir)).toBe(true);
    expect(fs.existsSync(path.join(appDir, 'app.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(appDir, 'pages', '.gitkeep'))).toBe(true);
    expect(fs.existsSync(path.join(appDir, 'tools', '.gitkeep'))).toBe(true);
    expect(fs.existsSync(path.join(appDir, 'workflows', '.gitkeep'))).toBe(true);
  });

  it('generates app.yaml with correct id', async () => {
    await initCommand('my_test_app', { outputDir: tmpDir });

    const content = fs.readFileSync(path.join(tmpDir, 'my_test_app', 'app.yaml'), 'utf-8');
    expect(content).toContain('id: my_test_app');
  });

  it('uses --name option in app.yaml', async () => {
    await initCommand('my_app', { outputDir: tmpDir, name: 'My Application' });

    const content = fs.readFileSync(path.join(tmpDir, 'my_app', 'app.yaml'), 'utf-8');
    expect(content).toContain('name: My Application');
  });

  it('uses --url option as base_url in app.yaml', async () => {
    await initCommand('my_app', { outputDir: tmpDir, url: 'https://myapp.example.com' });

    const content = fs.readFileSync(path.join(tmpDir, 'my_app', 'app.yaml'), 'utf-8');
    expect(content).toContain('base_url: https://myapp.example.com');
  });

  it('defaults name to app id when not specified', async () => {
    await initCommand('todo_app', { outputDir: tmpDir });

    const content = fs.readFileSync(path.join(tmpDir, 'todo_app', 'app.yaml'), 'utf-8');
    expect(content).toContain('name: todo_app');
  });

  it('defaults base_url to https://example.com when not specified', async () => {
    await initCommand('my_app', { outputDir: tmpDir });

    const content = fs.readFileSync(path.join(tmpDir, 'my_app', 'app.yaml'), 'utf-8');
    expect(content).toContain('base_url: https://example.com');
  });

  it('includes url_patterns in app.yaml', async () => {
    await initCommand('my_app', { outputDir: tmpDir });

    const content = fs.readFileSync(path.join(tmpDir, 'my_app', 'app.yaml'), 'utf-8');
    expect(content).toContain('url_patterns:');
  });

  it('includes version in app.yaml', async () => {
    await initCommand('my_app', { outputDir: tmpDir });

    const content = fs.readFileSync(path.join(tmpDir, 'my_app', 'app.yaml'), 'utf-8');
    expect(content).toContain('version: 1.0.0');
  });

  it('includes auth section in app.yaml', async () => {
    await initCommand('my_app', { outputDir: tmpDir });

    const content = fs.readFileSync(path.join(tmpDir, 'my_app', 'app.yaml'), 'utf-8');
    expect(content).toContain('auth:');
    expect(content).toContain('type: browser_session');
  });

  it('includes registry section in app.yaml', async () => {
    await initCommand('my_app', { outputDir: tmpDir });

    const content = fs.readFileSync(path.join(tmpDir, 'my_app', 'app.yaml'), 'utf-8');
    expect(content).toContain('registry:');
    expect(content).toContain('publisher:');
    expect(content).toContain('license: MIT');
  });

  it('throws if app directory already exists', async () => {
    const appDir = path.join(tmpDir, 'existing_app');
    fs.mkdirSync(appDir);

    await expect(initCommand('existing_app', { outputDir: tmpDir }))
      .rejects.toThrow(/already exists/);
  });

  it('creates subdirectories (pages, tools, workflows)', async () => {
    await initCommand('my_app', { outputDir: tmpDir });

    const appDir = path.join(tmpDir, 'my_app');
    expect(fs.statSync(path.join(appDir, 'pages')).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(appDir, 'tools')).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(appDir, 'workflows')).isDirectory()).toBe(true);
  });

  it('app.yaml is valid YAML', async () => {
    await initCommand('my_app', { outputDir: tmpDir });

    const content = fs.readFileSync(path.join(tmpDir, 'my_app', 'app.yaml'), 'utf-8');
    // Basic YAML structure check — no tabs, proper indentation
    expect(content).not.toContain('\t');
    // Should start with 'id:'
    expect(content.trim().startsWith('id:')).toBe(true);
  });
});
