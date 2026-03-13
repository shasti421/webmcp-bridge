import { describe, it, expect, beforeEach } from 'vitest';

import { YamlSchemaValidator } from '../yaml-schema-validator.js';

describe('YamlSchemaValidator', () => {
  let validator: YamlSchemaValidator;

  beforeEach(() => {
    validator = new YamlSchemaValidator();
  });

  // ─── AppDefinition ────────────────────────────────────

  describe('validateApp()', () => {
    const validApp = {
      id: 'demo-todo-app',
      name: 'Demo Todo Application',
      base_url: 'http://localhost:3000',
      url_patterns: ['http://localhost:3000/**'],
    };

    it('accepts a valid app definition', () => {
      const result = validator.validateApp(validApp);
      expect(result.ok).toBe(true);
    });

    it('accepts app with all optional fields', () => {
      const result = validator.validateApp({
        ...validApp,
        version: '1.0.0',
        description: 'A test app',
        auth: {
          type: 'browser_session',
          login_url: 'http://localhost:3000/login',
          session_check: '.logged-in',
        },
        registry: {
          publisher: 'test-team',
          tags: ['demo', 'testing'],
          license: 'MIT',
        },
      });
      expect(result.ok).toBe(true);
    });

    it('rejects missing required field: url_patterns', () => {
      const noPatterns = { id: validApp.id, name: validApp.name, base_url: validApp.base_url };
      const result = validator.validateApp(noPatterns);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SCHEMA_VALIDATION_ERROR');
        expect(result.error.message).toContain('url_patterns');
      }
    });

    it('rejects missing required field: id', () => {
      const noId = { name: validApp.name, base_url: validApp.base_url, url_patterns: validApp.url_patterns };
      const result = validator.validateApp(noId);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SCHEMA_VALIDATION_ERROR');
        expect(result.error.message).toContain('id');
      }
    });

    it('rejects url_patterns as string instead of array', () => {
      const result = validator.validateApp({
        ...validApp,
        url_patterns: '/path',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SCHEMA_VALIDATION_ERROR');
        expect(result.error.message).toContain('array');
      }
    });

    it('rejects invalid base_url format', () => {
      const result = validator.validateApp({
        ...validApp,
        base_url: 'not-a-url',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SCHEMA_VALIDATION_ERROR');
        expect(result.error.source).toBe('semantic');
      }
    });

    it('rejects invalid id pattern (uppercase)', () => {
      const result = validator.validateApp({
        ...validApp,
        id: 'MyApp',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SCHEMA_VALIDATION_ERROR');
        expect(result.error.message).toContain('pattern');
      }
    });

    it('rejects extra unknown fields', () => {
      const result = validator.validateApp({
        ...validApp,
        unknown_field: 'value',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SCHEMA_VALIDATION_ERROR');
      }
    });

    it('rejects empty url_patterns array', () => {
      const result = validator.validateApp({
        ...validApp,
        url_patterns: [],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SCHEMA_VALIDATION_ERROR');
      }
    });
  });

  // ─── PageDefinition ───────────────────────────────────

  describe('validatePage()', () => {
    const validPage = {
      id: 'todo_list',
      app: 'demo-todo-app',
      url_pattern: '/',
      wait_for: '.todo-list',
      fields: [
        {
          id: 'new_todo_input',
          label: 'New Todo',
          type: 'text',
          selectors: [
            { strategy: 'aria', role: 'textbox', name: 'New Todo', confidence: 0.95 },
            { strategy: 'css', selector: 'input.new-todo', confidence: 0.80 },
          ],
          interaction: { type: 'fill' },
        },
        {
          id: 'add_button',
          label: 'Add Todo',
          type: 'action_button',
          selectors: [
            { strategy: 'aria', role: 'button', name: 'Add', confidence: 0.95 },
            { strategy: 'css', selector: 'button.add-todo', confidence: 0.80 },
          ],
          interaction: { type: 'click' },
        },
      ],
      outputs: [
        {
          id: 'todo_items',
          label: 'Todo Items',
          selectors: [
            { strategy: 'css', selector: '.todo-item .todo-text' },
          ],
        },
      ],
    };

    it('accepts a valid page definition', () => {
      const result = validator.validatePage(validPage);
      expect(result.ok).toBe(true);
    });

    it('rejects page with only 1 field (minimum 2)', () => {
      const result = validator.validatePage({
        ...validPage,
        fields: [validPage.fields[0]],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SCHEMA_VALIDATION_ERROR');
        expect(result.error.message).toContain('2');
      }
    });

    it('rejects page with empty outputs', () => {
      const result = validator.validatePage({
        ...validPage,
        outputs: [],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SCHEMA_VALIDATION_ERROR');
        expect(result.error.message).toContain('1');
      }
    });

    it('rejects page missing wait_for', () => {
      const noWaitFor = {
        id: validPage.id, app: validPage.app, url_pattern: validPage.url_pattern,
        fields: validPage.fields, outputs: validPage.outputs,
      };
      const result = validator.validatePage(noWaitFor);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SCHEMA_VALIDATION_ERROR');
        expect(result.error.message).toContain('wait_for');
      }
    });

    it('rejects field with empty selectors', () => {
      const result = validator.validatePage({
        ...validPage,
        fields: [
          { ...validPage.fields[0], selectors: [] },
          validPage.fields[1],
        ],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SCHEMA_VALIDATION_ERROR');
      }
    });

    it('rejects invalid selector strategy', () => {
      const result = validator.validatePage({
        ...validPage,
        fields: [
          {
            ...validPage.fields[0],
            selectors: [{ strategy: 'invalid', something: 'bad' }],
          },
          validPage.fields[1],
        ],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SCHEMA_VALIDATION_ERROR');
      }
    });

    it('accepts page with optional overlays', () => {
      const result = validator.validatePage({
        ...validPage,
        overlays: [
          {
            id: 'cookie-banner',
            trigger: '.cookie-overlay',
            dismiss: [{ strategy: 'click_close', selector: '.close-btn' }],
          },
        ],
      });
      expect(result.ok).toBe(true);
    });

    it('accepts output without capture_strategies (optional)', () => {
      const result = validator.validatePage({
        ...validPage,
        outputs: [
          {
            id: 'status',
            label: 'Status',
            selectors: [{ strategy: 'css', selector: '.status' }],
          },
        ],
      });
      expect(result.ok).toBe(true);
    });

    it('reports multiple validation errors in a single message', () => {
      const result = validator.validatePage({
        id: 'test',
        app: 'test-app',
        url_pattern: '/',
        fields: [
          {
            id: 'f1',
            label: 'F1',
            type: 'text',
            selectors: [{ strategy: 'css', selector: '.f1' }],
            interaction: { type: 'fill' },
          },
        ],
        outputs: [],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SCHEMA_VALIDATION_ERROR');
        // Should have multiple errors separated by semicolons
        const parts = result.error.message.split(';');
        expect(parts.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  // ─── ToolDefinition ───────────────────────────────────

  describe('validateTool()', () => {
    const validTool = {
      name: 'add_todo',
      description: 'Add a new todo item',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text' },
        },
        required: ['text'],
      },
      bridge: {
        page: 'todo_list',
        steps: [
          { navigate: { page: 'todo_list' } },
          { interact: { field: 'new_todo_input', action: 'fill', value: '{{text}}' } },
        ],
        returns: { item_count: '{{item_count}}' },
      },
    };

    it('accepts a valid tool definition', () => {
      const result = validator.validateTool(validTool);
      expect(result.ok).toBe(true);
    });

    it('rejects tool missing required bridge field', () => {
      const noBridge = { name: validTool.name, description: validTool.description, inputSchema: validTool.inputSchema };
      const result = validator.validateTool(noBridge);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SCHEMA_VALIDATION_ERROR');
        expect(result.error.message).toContain('bridge');
      }
    });

    it('rejects tool with empty steps', () => {
      const result = validator.validateTool({
        ...validTool,
        bridge: { ...validTool.bridge, steps: [] },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SCHEMA_VALIDATION_ERROR');
      }
    });

    it('accepts tool with page ref that does not exist (validation only)', () => {
      const result = validator.validateTool({
        ...validTool,
        bridge: { ...validTool.bridge, page: 'nonexistent' },
      });
      expect(result.ok).toBe(true);
    });

    it('accepts tool with capture step', () => {
      const result = validator.validateTool({
        ...validTool,
        bridge: {
          ...validTool.bridge,
          steps: [
            { navigate: { page: 'todo_list' } },
            { capture: { from: 'todo_count', store_as: 'count', wait: true } },
          ],
        },
      });
      expect(result.ok).toBe(true);
    });

    it('accepts tool with wait step', () => {
      const result = validator.validateTool({
        ...validTool,
        bridge: {
          ...validTool.bridge,
          steps: [{ wait: 1000 }],
        },
      });
      expect(result.ok).toBe(true);
    });

    it('accepts tool with evaluate_js step', () => {
      const result = validator.validateTool({
        ...validTool,
        bridge: {
          ...validTool.bridge,
          steps: [{ evaluate_js: 'document.title' }],
        },
      });
      expect(result.ok).toBe(true);
    });

    it('rejects tool with invalid name pattern', () => {
      const result = validator.validateTool({
        ...validTool,
        name: 'Add-Todo',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SCHEMA_VALIDATION_ERROR');
      }
    });
  });

  // ─── WorkflowDefinition ───────────────────────────────

  describe('validateWorkflow()', () => {
    const validWorkflow = {
      name: 'batch_add_todos',
      description: 'Add multiple todo items',
      input: {
        items: { type: 'array', required: true, description: 'Items to add' },
      },
      steps: [
        {
          for_each: '{{items}}',
          as: 'item',
          on_error: 'continue',
          steps: [
            { tool: 'add_todo', params: { text: '{{item}}' } },
          ],
        },
        {
          aggregate: { added_count: '{{loop.successes.length}}' },
        },
      ],
    };

    it('accepts a valid workflow definition', () => {
      const result = validator.validateWorkflow(validWorkflow);
      expect(result.ok).toBe(true);
    });

    it('rejects workflow with no steps', () => {
      const result = validator.validateWorkflow({
        ...validWorkflow,
        steps: [],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SCHEMA_VALIDATION_ERROR');
        expect(result.error.message).toContain('1');
      }
    });

    it('rejects workflow missing required fields', () => {
      const result = validator.validateWorkflow({
        name: 'test_workflow',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SCHEMA_VALIDATION_ERROR');
      }
    });

    it('accepts workflow with output definition', () => {
      const result = validator.validateWorkflow({
        ...validWorkflow,
        output: {
          total: { type: 'number', description: 'Total items' },
        },
      });
      expect(result.ok).toBe(true);
    });

    it('rejects workflow with invalid name pattern', () => {
      const result = validator.validateWorkflow({
        ...validWorkflow,
        name: 'Batch-Add',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SCHEMA_VALIDATION_ERROR');
      }
    });

    it('rejects workflow with empty input', () => {
      const result = validator.validateWorkflow({
        ...validWorkflow,
        input: {},
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SCHEMA_VALIDATION_ERROR');
      }
    });
  });

  // ─── Error formatting ─────────────────────────────────

  describe('error formatting', () => {
    it('includes source: semantic in all errors', () => {
      const result = validator.validateApp({});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.source).toBe('semantic');
      }
    });

    it('includes cause with ajv errors', () => {
      const result = validator.validateApp({ id: 123 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.cause).toBeDefined();
      }
    });
  });
});
