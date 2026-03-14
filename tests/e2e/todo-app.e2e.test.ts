/**
 * E2E Test: Todo App Tool Execution via Playwright
 *
 * Loads the demo-todo-app semantic definitions, launches Playwright against
 * the fixture server, and exercises the add_todo tool through the full
 * ExecutionEngine pipeline.
 *
 * Dependencies: #10 (ExecutionEngine), #13 (PlaywrightDriver), #14 (fixture server)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PlaywrightDriver } from '../../packages/playwright/src/playwright-driver.js';
import { SemanticStore } from '../../packages/core/src/semantic/semantic-store.js';
import { YamlSchemaValidator } from '../../packages/core/src/semantic/yaml-schema-validator.js';
import { SelectorResolver } from '../../packages/core/src/selector/selector-resolver.js';
import { ResultCapturer } from '../../packages/core/src/capture/result-capturer.js';
import { HealingPipeline } from '../../packages/core/src/healing/healing-pipeline.js';
import { ExecutionEngine } from '../../packages/core/src/engine/execution-engine.js';
import { createTodoServer, type TodoServer } from './fixtures/todo-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('E2E: Todo App Tool Execution', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let driver: PlaywrightDriver;
  let engine: ExecutionEngine;
  let server: TodoServer;
  let store: SemanticStore;
  let baseUrl: string;

  beforeAll(async () => {
    // Start fixture server
    server = createTodoServer();
    const port = await server.start(0);
    baseUrl = `http://localhost:${port}`;

    // Launch browser
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    page = await context.newPage();

    // Create driver
    driver = new PlaywrightDriver(page, browser, context, 10000);

    // Load semantic definitions
    const validator = new YamlSchemaValidator();
    store = new SemanticStore(validator);
    const semanticPath = path.resolve(__dirname, '../../semantic-examples/demo-todo-app');
    const loadResult = await store.loadFromDirectory(semanticPath);
    if (!loadResult.ok) {
      console.error('Load error:', JSON.stringify(loadResult.error, null, 2));
    }
    expect(loadResult.ok).toBe(true);

    // Override app base_url to match our dynamic port
    // Since the YAML says http://localhost:3000, we need to override
    // We'll patch the app definition
    const app = store.getApp('demo-todo-app');
    if (app) {
      (app as { base_url: string }).base_url = baseUrl;
    }

    // Also patch the page url_template
    const todoPage = store.getPage('todo_list');
    if (todoPage) {
      (todoPage as { url_template: string }).url_template = `${baseUrl}/`;
    }

    // Create engine components
    const resolver = new SelectorResolver();
    const capturer = new ResultCapturer(resolver);
    const healer = new HealingPipeline({ aiHealing: false, humanInLoop: false });

    engine = new ExecutionEngine(store, resolver, capturer, healer);
  }, 30000);

  afterAll(async () => {
    await browser?.close();
    await server?.stop();
  });

  it('should load semantic definitions successfully', () => {
    const app = store.getApp('demo-todo-app');
    expect(app).toBeDefined();
    expect(app?.name).toBe('Demo Todo Application');

    const todoPage = store.getPage('todo_list');
    expect(todoPage).toBeDefined();
    expect(todoPage?.fields.length).toBeGreaterThan(0);

    const tool = store.getTool('add_todo');
    expect(tool).toBeDefined();
    expect(tool?.name).toBe('add_todo');
  });

  it('should navigate to todo app and see initial todos', async () => {
    await driver.goto(baseUrl);

    // Wait for todo list to render
    await driver.waitFor({ type: 'selector', value: '.todo-list', timeout: 5000 });

    // Check page title
    const ctx = await driver.getPageContext();
    expect(ctx.title).toBe('Todo App');
  });

  it('should find elements using ARIA strategy', async () => {
    await driver.goto(baseUrl);
    await driver.waitFor({ type: 'selector', value: '.todo-list', timeout: 5000 });

    // Find the input by ARIA role
    const input = await driver.findElement([
      { strategy: 'aria', role: 'textbox', name: 'New Todo' },
    ]);
    expect(input._brand).toBe('ElementHandle');

    // Find the add button by ARIA role
    const button = await driver.findElement([
      { strategy: 'aria', role: 'button', name: 'Add' },
    ]);
    expect(button._brand).toBe('ElementHandle');
  });

  it('should find elements using CSS strategy', async () => {
    await driver.goto(baseUrl);
    await driver.waitFor({ type: 'selector', value: '.todo-list', timeout: 5000 });

    const input = await driver.findElement([
      { strategy: 'css', selector: 'input.new-todo' },
    ]);
    expect(input._brand).toBe('ElementHandle');

    const button = await driver.findElement([
      { strategy: 'css', selector: 'button.add-todo' },
    ]);
    expect(button._brand).toBe('ElementHandle');
  });

  it('should type text and add a todo manually', async () => {
    await driver.goto(baseUrl);
    await driver.waitFor({ type: 'selector', value: '.todo-list', timeout: 5000 });

    // Wait for initial todos to load
    await driver.waitFor({ type: 'timeout', value: 500 });

    // Find input and type
    const input = await driver.findElement([
      { strategy: 'css', selector: 'input.new-todo' },
    ]);
    await driver.type(input, 'Buy groceries');

    // Find and click add button
    const button = await driver.findElement([
      { strategy: 'css', selector: 'button.add-todo' },
    ]);
    await driver.click(button);

    // Wait for DOM update
    await driver.waitFor({ type: 'timeout', value: 500 });

    // Read the todo count
    const countText = await driver.readText([
      { strategy: 'css', selector: '.todo-count' },
    ]);
    expect(countText).toContain('item');
  });

  it('should execute add_todo tool via ExecutionEngine', async () => {
    // Reset server state
    server.reset();

    const result = await engine.executeTool('add_todo', { text: 'Test via engine' }, driver);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(true);
      expect(result.value.stepsExecuted).toBe(4);
      // The tool captures item_count
      expect(result.value.outputs).toHaveProperty('item_count');
      // After adding, there should be items
      const count = result.value.outputs['item_count'];
      expect(count).toBeDefined();
    }
  });

  it('should read todo count after adding multiple items', async () => {
    server.reset();

    // Add first todo
    const result1 = await engine.executeTool('add_todo', { text: 'First item' }, driver);
    expect(result1.ok).toBe(true);

    // Add second todo
    const result2 = await engine.executeTool('add_todo', { text: 'Second item' }, driver);
    expect(result2.ok).toBe(true);

    if (result2.ok) {
      // Count should reflect all uncompleted items
      const count = result2.value.outputs['item_count'];
      expect(count).toBeDefined();
    }
  });

  it('should handle strategy fallback (CSS -> ARIA)', { timeout: 15000 }, async () => {
    await driver.goto(baseUrl);
    await driver.waitFor({ type: 'selector', value: '.todo-list', timeout: 5000 });

    // Use a non-existent CSS selector first, fall back to ARIA
    const element = await driver.findElement([
      { strategy: 'css', selector: '.nonexistent-class' },
      { strategy: 'aria', role: 'textbox', name: 'New Todo' },
    ]);
    expect(element._brand).toBe('ElementHandle');
  });

  it('should take a screenshot', async () => {
    await driver.goto(baseUrl);
    await driver.waitFor({ type: 'selector', value: '.todo-list', timeout: 5000 });

    const screenshot = await driver.screenshot();
    expect(Buffer.isBuffer(screenshot)).toBe(true);
    expect(screenshot.length).toBeGreaterThan(0);
  });

  it('should evaluate JavaScript on the page', async () => {
    await driver.goto(baseUrl);
    await driver.waitFor({ type: 'selector', value: '.todo-list', timeout: 5000 });

    const title = await driver.evaluate('document.title');
    expect(title).toBe('Todo App');
  });

  it('should read text with pattern matching', async () => {
    server.reset();
    await driver.goto(baseUrl);
    await driver.waitFor({ type: 'selector', value: '.todo-count', timeout: 5000 });
    await driver.waitFor({ type: 'timeout', value: 500 });

    const count = await driver.readPattern(
      [{ strategy: 'css', selector: '.todo-count' }],
      '(\\d+) items? left',
    );
    expect(count).toBeDefined();
    expect(Number(count)).toBeGreaterThanOrEqual(0);
  });
});
