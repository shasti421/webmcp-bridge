import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { SemanticStore } from '../semantic-store.js';
import { YamlSchemaValidator } from '../yaml-schema-validator.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-test-'));
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

const validWorkflowYaml = `
name: batch_add
description: "Add multiple items"
input:
  items:
    type: array
    required: true
steps:
  - for_each: "{{items}}"
    as: item
    on_error: continue
    steps:
      - tool: add_todo
        params:
          text: "{{item}}"
  - aggregate:
      count: "{{loop.successes.length}}"
`;

describe('SemanticStore — loadFromDirectory', () => {
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

  it('loads a valid directory structure', async () => {
    writeYaml(tempDir, 'app.yaml', validAppYaml);
    writeYaml(tempDir, 'pages/todo_list.yaml', validPageYaml);
    writeYaml(tempDir, 'tools/add_todo.yaml', validToolYaml);
    writeYaml(tempDir, 'workflows/batch_add.yaml', validWorkflowYaml);

    const result = await store.loadFromDirectory(tempDir);
    expect(result.ok).toBe(true);

    expect(store.getApp('demo-todo-app')).toBeDefined();
    expect(store.getPage('todo_list')).toBeDefined();
    expect(store.getTool('add_todo')).toBeDefined();
    expect(store.getWorkflow('batch_add')).toBeDefined();
  });

  it('returns ok for empty directory', async () => {
    const result = await store.loadFromDirectory(tempDir);
    expect(result.ok).toBe(true);
    expect(store.listApps()).toHaveLength(0);
  });

  it('returns err for invalid YAML syntax', async () => {
    writeYaml(tempDir, 'app.yaml', '{ bad yaml: [unclosed');

    const result = await store.loadFromDirectory(tempDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('YAML_PARSE_ERROR');
      expect(result.error.source).toBe('semantic');
    }
  });

  it('returns err for schema validation failure in app.yaml', async () => {
    writeYaml(tempDir, 'app.yaml', `
id: demo
name: Demo
`);

    const result = await store.loadFromDirectory(tempDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SCHEMA_VALIDATION_ERROR');
    }
  });

  it('returns err for schema validation failure in pages/', async () => {
    writeYaml(tempDir, 'app.yaml', validAppYaml);
    writeYaml(tempDir, 'pages/bad.yaml', `
id: bad_page
app: demo-todo-app
url_pattern: "/"
fields: []
outputs: []
`);

    const result = await store.loadFromDirectory(tempDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SCHEMA_VALIDATION_ERROR');
    }
  });

  it('indexes pages by id', async () => {
    writeYaml(tempDir, 'app.yaml', validAppYaml);
    writeYaml(tempDir, 'pages/todo_list.yaml', validPageYaml);

    const result = await store.loadFromDirectory(tempDir);
    expect(result.ok).toBe(true);

    const page = store.getPage('todo_list');
    expect(page).toBeDefined();
    expect(page?.app).toBe('demo-todo-app');
    expect(page?.fields).toHaveLength(2);
  });

  it('indexes tools by name', async () => {
    writeYaml(tempDir, 'app.yaml', validAppYaml);
    writeYaml(tempDir, 'pages/todo_list.yaml', validPageYaml);
    writeYaml(tempDir, 'tools/add_todo.yaml', validToolYaml);

    const result = await store.loadFromDirectory(tempDir);
    expect(result.ok).toBe(true);

    const tool = store.getTool('add_todo');
    expect(tool).toBeDefined();
    expect(tool?.bridge.page).toBe('todo_list');
  });

  it('indexes workflows by name', async () => {
    writeYaml(tempDir, 'app.yaml', validAppYaml);
    writeYaml(tempDir, 'tools/add_todo.yaml', validToolYaml);
    writeYaml(tempDir, 'workflows/batch_add.yaml', validWorkflowYaml);

    const result = await store.loadFromDirectory(tempDir);
    expect(result.ok).toBe(true);

    const workflow = store.getWorkflow('batch_add');
    expect(workflow).toBeDefined();
    expect(workflow?.steps).toHaveLength(2);
  });

  it('lists all apps', async () => {
    writeYaml(tempDir, 'app.yaml', validAppYaml);
    await store.loadFromDirectory(tempDir);
    expect(store.listApps()).toHaveLength(1);
    expect(store.listApps()[0]?.id).toBe('demo-todo-app');
  });

  it('lists pages filtered by appId', async () => {
    writeYaml(tempDir, 'app.yaml', validAppYaml);
    writeYaml(tempDir, 'pages/todo_list.yaml', validPageYaml);
    await store.loadFromDirectory(tempDir);

    expect(store.listPages('demo-todo-app')).toHaveLength(1);
    expect(store.listPages('nonexistent')).toHaveLength(0);
    expect(store.listPages()).toHaveLength(1);
  });

  it('handles duplicate page IDs (last write wins)', async () => {
    writeYaml(tempDir, 'app.yaml', validAppYaml);
    writeYaml(tempDir, 'pages/todo_list.yaml', validPageYaml);
    writeYaml(tempDir, 'pages/todo_list_v2.yaml', validPageYaml.replace('wait_for: ".todo-list"', 'wait_for: ".todo-list-v2"'));

    const result = await store.loadFromDirectory(tempDir);
    expect(result.ok).toBe(true);

    // Second file overwrites first
    const page = store.getPage('todo_list');
    expect(page).toBeDefined();
  });

  it('supports .yml extension', async () => {
    writeYaml(tempDir, 'app.yml', validAppYaml);

    const result = await store.loadFromDirectory(tempDir);
    expect(result.ok).toBe(true);
    expect(store.getApp('demo-todo-app')).toBeDefined();
  });

  it('returns undefined for nonexistent entries', async () => {
    await store.loadFromDirectory(tempDir);
    expect(store.getApp('nonexistent')).toBeUndefined();
    expect(store.getPage('nonexistent')).toBeUndefined();
    expect(store.getTool('nonexistent')).toBeUndefined();
    expect(store.getWorkflow('nonexistent')).toBeUndefined();
  });

  it('handles YAML files with wrapper keys (app: / page: / tool: / workflow:)', async () => {
    writeYaml(tempDir, 'app.yaml', `
app:
  ${validAppYaml.trim().split('\n').join('\n  ')}
`);
    writeYaml(tempDir, 'pages/todo_list.yaml', `
page:
  ${validPageYaml.trim().split('\n').join('\n  ')}
`);
    writeYaml(tempDir, 'tools/add_todo.yaml', `
tool:
  ${validToolYaml.trim().split('\n').join('\n  ')}
`);
    writeYaml(tempDir, 'workflows/batch_add.yaml', `
workflow:
  ${validWorkflowYaml.trim().split('\n').join('\n  ')}
`);

    const result = await store.loadFromDirectory(tempDir);
    expect(result.ok).toBe(true);
    expect(store.getApp('demo-todo-app')).toBeDefined();
    expect(store.getPage('todo_list')).toBeDefined();
    expect(store.getTool('add_todo')).toBeDefined();
    expect(store.getWorkflow('batch_add')).toBeDefined();
  });
});
