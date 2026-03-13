import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { SemanticStore } from '../semantic-store.js';
import { YamlSchemaValidator } from '../yaml-schema-validator.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-registry-test-'));
}

function writeYaml(dir: string, filePath: string, content: string): void {
  const fullPath = path.join(dir, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

const validAppYaml = `
id: demo-todo-app
name: Demo Todo Application
base_url: "http://localhost:3000"
url_patterns:
  - "/"
  - "/items/{id}"
description: "Simple todo app"
`;

const validPageYaml = `
id: todo_list
app: demo-todo-app
url_pattern: "/"
wait_for: ".todo-list"
fields:
  - id: new_todo_input
    label: New Todo
    type: text
    selectors:
      - strategy: aria
        role: textbox
        name: "New Todo"
      - strategy: css
        selector: "input.new-todo"
    interaction:
      type: fill
  - id: add_button
    label: Add Todo
    type: action_button
    selectors:
      - strategy: aria
        role: button
        name: "Add"
      - strategy: css
        selector: "button.add-todo"
    interaction:
      type: click
outputs:
  - id: todo_count
    label: Items Count
    selectors:
      - strategy: css
        selector: ".todo-count"
`;

const validToolYaml = `
name: add_todo
description: "Add a new todo item"
inputSchema:
  type: object
  properties:
    text:
      type: string
      description: The text
  required:
    - text
bridge:
  page: todo_list
  steps:
    - navigate:
        page: todo_list
    - interact:
        field: new_todo_input
        action: fill
        value: "{{text}}"
  returns:
    item_count: "{{item_count}}"
`;

/**
 * Creates a mock registry directory structure simulating
 * what LocalRegistry.resolve() would point to.
 */
function createMockRegistryApp(baseDir: string, appId: string, version: string): string {
  const appDir = path.join(baseDir, appId, version);
  writeYaml(appDir, 'app.yaml', validAppYaml);
  writeYaml(appDir, 'pages/todo_list.yaml', validPageYaml);
  writeYaml(appDir, 'tools/add_todo.yaml', validToolYaml);
  return appDir;
}

describe('SemanticStore — loadFromRegistry', () => {
  let tempDir: string;
  let store: SemanticStore;

  beforeEach(() => {
    tempDir = createTempDir();
    const validator = new YamlSchemaValidator();
    store = new SemanticStore(validator);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads definitions from a registry path', async () => {
    const appDir = createMockRegistryApp(tempDir, 'demo-todo-app', '1.0.0');

    const result = await store.loadFromRegistry(appDir);
    expect(result.ok).toBe(true);

    expect(store.getApp('demo-todo-app')).toBeDefined();
    expect(store.getPage('todo_list')).toBeDefined();
    expect(store.getTool('add_todo')).toBeDefined();
  });

  it('returns error when registry path does not exist', async () => {
    const result = await store.loadFromRegistry('/nonexistent/path');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('REGISTRY_ERROR');
    }
  });

  it('returns error when registry path has no app.yaml', async () => {
    fs.mkdirSync(path.join(tempDir, 'empty-app'), { recursive: true });
    const result = await store.loadFromRegistry(path.join(tempDir, 'empty-app'));
    // Empty dir loads fine with loadFromDirectory (returns ok with empty indices)
    // but loadFromRegistry should error because there's no app definition
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('REGISTRY_ERROR');
    }
  });

  it('merges with existing loaded definitions', async () => {
    // First load from a directory
    const dir1 = path.join(tempDir, 'dir1');
    writeYaml(dir1, 'app.yaml', validAppYaml);
    writeYaml(dir1, 'pages/todo_list.yaml', validPageYaml);
    await store.loadFromDirectory(dir1);

    expect(store.getApp('demo-todo-app')).toBeDefined();
    expect(store.getTool('add_todo')).toBeUndefined();

    // Then load from registry path (has tool too)
    const registryDir = createMockRegistryApp(tempDir, 'demo-todo-app', '1.0.0');
    const result = await store.loadFromRegistry(registryDir);
    expect(result.ok).toBe(true);

    // Tool should now be available
    expect(store.getTool('add_todo')).toBeDefined();
  });

  it('validates YAML files from registry path', async () => {
    const appDir = path.join(tempDir, 'bad-app', '1.0.0');
    writeYaml(appDir, 'app.yaml', validAppYaml);
    writeYaml(appDir, 'pages/bad.yaml', `
id: bad_page
app: demo-todo-app
url_pattern: "/"
fields: []
outputs: []
`);

    const result = await store.loadFromRegistry(appDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SCHEMA_VALIDATION_ERROR');
    }
  });
});
