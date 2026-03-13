/**
 * Unit tests for ExecutionEngine.
 * Uses mock driver and mock semantic store.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ExecutionEngine } from '../execution-engine.js';
import { createMockDriver } from '../../drivers/mock-driver.js';
import type { BridgeDriver } from '../../types/bridge-driver.js';
import type { SemanticStore } from '../../semantic/semantic-store.js';
import type { SelectorResolver } from '../../selector/selector-resolver.js';
import type { ResultCapturer } from '../../capture/result-capturer.js';
import type { HealingPipeline } from '../../healing/healing-pipeline.js';
import type { ToolDefinition, PageDefinition, FieldDefinition, OutputDefinition, AppDefinition } from '../../types/semantic-model.js';
import { ok, err } from '../../types/result.js';
import { createBridgeError } from '../../types/errors.js';

// ─── Fixtures ────────────────────────────────────────

const mockField: FieldDefinition = {
  id: 'name_input',
  label: 'Name',
  type: 'text',
  selectors: [{ strategy: 'css', selector: '#name' }],
  interaction: { type: 'text_input' },
};

const mockButtonField: FieldDefinition = {
  id: 'submit_btn',
  label: 'Submit',
  type: 'action_button',
  selectors: [{ strategy: 'css', selector: '#submit' }],
  interaction: { type: 'click' },
};

const mockOutput: OutputDefinition = {
  id: 'result_text',
  label: 'Result',
  selectors: [{ strategy: 'css', selector: '.result' }],
};

const mockPage: PageDefinition = {
  id: 'test_page',
  app: 'test-app',
  url_pattern: '/',
  url_template: '{{app.base_url}}/',
  wait_for: '.loaded',
  fields: [mockField, mockButtonField],
  outputs: [mockOutput],
};

const mockApp: AppDefinition = {
  id: 'test-app',
  name: 'Test App',
  base_url: 'http://localhost:3000',
  url_patterns: ['http://localhost:3000/**'],
};

const mockTool: ToolDefinition = {
  name: 'create_item',
  description: 'Create an item',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Item name' } },
    required: ['name'],
  },
  bridge: {
    page: 'test_page',
    steps: [
      { navigate: { page: 'test_page' } },
      { interact: { field: 'test_page.fields.name_input', action: 'fill', value: '{{name}}' } },
      { interact: { action: 'click', target: 'test_page.fields.submit_btn' } },
      { capture: { from: 'test_page.outputs.result_text', store_as: 'result', wait: true } },
    ],
    returns: { result: '{{result}}' },
  },
};

// ─── Mock Factories ─────────────────────────────────

function createMockStore(overrides?: Partial<SemanticStore>): SemanticStore {
  return {
    getTool: vi.fn().mockReturnValue(mockTool),
    getPage: vi.fn().mockReturnValue(mockPage),
    getApp: vi.fn().mockReturnValue(mockApp),
    getWorkflow: vi.fn().mockReturnValue(undefined),
    resolveFieldRef: vi.fn().mockImplementation((ref: string) => {
      if (ref === 'test_page.fields.name_input') return mockField;
      if (ref === 'test_page.fields.submit_btn') return mockButtonField;
      return undefined;
    }),
    resolveOutputRef: vi.fn().mockImplementation((ref: string) => {
      if (ref === 'test_page.outputs.result_text') return mockOutput;
      return undefined;
    }),
    listTools: vi.fn().mockReturnValue([mockTool]),
    ...overrides,
  } as unknown as SemanticStore;
}

function createMockResolver(overrides?: Partial<SelectorResolver>): SelectorResolver {
  return {
    resolve: vi.fn().mockResolvedValue(ok({
      element: { _brand: 'ElementHandle' as const },
      strategyIndex: 0,
      strategyName: 'css',
    })),
    resolveText: vi.fn().mockResolvedValue(ok('mock text')),
    resolvePattern: vi.fn().mockResolvedValue(ok(null)),
    ...overrides,
  } as unknown as SelectorResolver;
}

function createMockCapturer(overrides?: Partial<ResultCapturer>): ResultCapturer {
  return {
    capture: vi.fn().mockResolvedValue(ok('captured value')),
    captureAll: vi.fn().mockResolvedValue(ok({})),
    ...overrides,
  } as unknown as ResultCapturer;
}

function createMockHealer(overrides?: Partial<HealingPipeline>): HealingPipeline {
  return {
    heal: vi.fn().mockResolvedValue(err(createBridgeError('HEALING_EXHAUSTED', 'All healing failed', 'healing'))),
    ...overrides,
  } as unknown as HealingPipeline;
}

// ─── Tests ──────────────────────────────────────────

describe('ExecutionEngine', () => {
  let engine: ExecutionEngine;
  let store: SemanticStore;
  let resolver: SelectorResolver;
  let capturer: ResultCapturer;
  let healer: HealingPipeline;
  let driver: BridgeDriver;

  beforeEach(() => {
    store = createMockStore();
    resolver = createMockResolver();
    capturer = createMockCapturer();
    healer = createMockHealer();
    driver = createMockDriver();
    engine = new ExecutionEngine(store, resolver, capturer, healer);
  });

  describe('executeTool', () => {
    it('should return TOOL_NOT_FOUND for unknown tool', async () => {
      (store.getTool as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
      const result = await engine.executeTool('unknown', {}, driver);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOOL_NOT_FOUND');
      }
    });

    it('should return PAGE_NOT_FOUND when tool references missing page', async () => {
      (store.getPage as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
      const result = await engine.executeTool('create_item', { name: 'Test' }, driver);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PAGE_NOT_FOUND');
      }
    });

    it('should execute a simple tool successfully', async () => {
      const result = await engine.executeTool('create_item', { name: 'Test Item' }, driver);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        expect(result.value.stepsExecuted).toBe(4);
        expect(result.value.outputs).toHaveProperty('result');
      }
    });

    it('should navigate to page URL', async () => {
      await engine.executeTool('create_item', { name: 'Test' }, driver);
      expect(driver.goto).toHaveBeenCalledWith('http://localhost:3000/');
    });

    it('should wait for page ready selector', async () => {
      await engine.executeTool('create_item', { name: 'Test' }, driver);
      expect(driver.waitFor).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'selector', value: '.loaded' }),
      );
    });

    it('should type rendered value into field', async () => {
      await engine.executeTool('create_item', { name: 'Hello World' }, driver);
      expect(driver.type).toHaveBeenCalledWith(
        expect.objectContaining({ _brand: 'ElementHandle' }),
        'Hello World',
      );
    });

    it('should click the button', async () => {
      await engine.executeTool('create_item', { name: 'Test' }, driver);
      expect(driver.click).toHaveBeenCalled();
    });

    it('should capture output values', async () => {
      (capturer.capture as ReturnType<typeof vi.fn>).mockResolvedValue(ok('3 items left'));
      const result = await engine.executeTool('create_item', { name: 'Test' }, driver);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outputs.result).toBe('3 items left');
      }
    });

    it('should handle navigation failure', async () => {
      (driver.goto as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('net::ERR_FAILED'));
      const result = await engine.executeTool('create_item', { name: 'Test' }, driver);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NAVIGATION_FAILED');
      }
    });

    it('should handle selector failure with healing attempt', async () => {
      (resolver.resolve as ReturnType<typeof vi.fn>).mockResolvedValue(
        err(createBridgeError('SELECTOR_NOT_FOUND', 'not found', 'selector')),
      );
      const result = await engine.executeTool('create_item', { name: 'Test' }, driver);
      expect(result.ok).toBe(false);
      // Healing was attempted but failed (default mock)
      expect(healer.heal).toHaveBeenCalled();
    });

    it('should succeed when healing finds element', async () => {
      // First call to resolve fails, then succeeds (for the button step)
      (resolver.resolve as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(err(createBridgeError('SELECTOR_NOT_FOUND', 'not found', 'selector')))
        .mockResolvedValue(ok({ element: { _brand: 'ElementHandle' as const }, strategyIndex: 0, strategyName: 'css' }));

      (healer.heal as ReturnType<typeof vi.fn>).mockResolvedValue(ok({
        element: { _brand: 'ElementHandle' as const },
        newSelector: { strategy: 'css', selector: '#name-healed' },
        stage: 'fuzzy_match',
      }));

      const result = await engine.executeTool('create_item', { name: 'Test' }, driver);
      expect(result.ok).toBe(true);
    });
  });

  describe('executeTool with conditional steps', () => {
    it('should skip step when condition is false', async () => {
      const conditionalTool: ToolDefinition = {
        ...mockTool,
        name: 'conditional_tool',
        bridge: {
          page: 'test_page',
          steps: [
            { navigate: { page: 'test_page' } },
            { interact: { field: 'test_page.fields.name_input', action: 'fill', value: 'test' }, condition: '{{skip_fill}}' } as unknown as typeof mockTool.bridge.steps[0],
          ],
        },
      };

      (store.getTool as ReturnType<typeof vi.fn>).mockReturnValue(conditionalTool);
      const result = await engine.executeTool('conditional_tool', { skip_fill: false }, driver);
      expect(result.ok).toBe(true);
      // type should NOT have been called since condition was falsy
      expect(driver.type).not.toHaveBeenCalled();
    });
  });

  describe('executeTool with evaluate_js step', () => {
    it('should evaluate JavaScript', async () => {
      const jsTool: ToolDefinition = {
        ...mockTool,
        name: 'js_tool',
        bridge: {
          page: 'test_page',
          steps: [
            { navigate: { page: 'test_page' } },
            { evaluate_js: 'document.title' },
          ],
        },
      };

      (store.getTool as ReturnType<typeof vi.fn>).mockReturnValue(jsTool);
      const result = await engine.executeTool('js_tool', {}, driver);
      expect(result.ok).toBe(true);
      expect(driver.evaluate).toHaveBeenCalledWith('document.title');
    });
  });

  describe('executeTool with wait step', () => {
    it('should wait for specified duration', async () => {
      const waitTool: ToolDefinition = {
        ...mockTool,
        name: 'wait_tool',
        bridge: {
          page: 'test_page',
          steps: [
            { navigate: { page: 'test_page' } },
            { wait: 1000 },
          ],
        },
      };

      (store.getTool as ReturnType<typeof vi.fn>).mockReturnValue(waitTool);
      const result = await engine.executeTool('wait_tool', {}, driver);
      expect(result.ok).toBe(true);
      // waitFor called for navigate + explicit wait
      expect(driver.waitFor).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'timeout', value: 1000 }),
      );
    });
  });

  describe('getToolSchemas', () => {
    it('should return all tool schemas', () => {
      const schemas = engine.getToolSchemas();
      expect(schemas).toHaveLength(1);
      expect(schemas[0]!.name).toBe('create_item');
      expect(schemas[0]!.description).toBe('Create an item');
      expect(schemas[0]!.inputSchema).toBeDefined();
    });
  });

  describe('executeWorkflow', () => {
    it('should return error for unknown workflow', async () => {
      const result = await engine.executeWorkflow('unknown', {}, driver);
      expect(result.ok).toBe(false);
    });
  });
});
