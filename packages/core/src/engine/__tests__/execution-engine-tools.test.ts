import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ExecutionEngine } from '../execution-engine.js';
import { createMockDriver } from '../../drivers/mock-driver.js';
import { SelectorResolver } from '../../selector/selector-resolver.js';
import { ResultCapturer } from '../../capture/result-capturer.js';
import { HealingPipeline } from '../../healing/healing-pipeline.js';
import { TemplateRenderer } from '../../utils/template-renderer.js';
import { ok } from '../../types/result.js';
import type { BridgeDriver, ElementHandle } from '../../types/bridge-driver.js';
import type { SemanticStore } from '../../semantic/semantic-store.js';
import type {
  ToolDefinition,
  PageDefinition,
  FieldDefinition,
  OutputDefinition,
} from '../../types/semantic-model.js';
import type { HealingConfig } from '../../types/config.js';

// ─── Helpers ──────────────────────────────────────────────

function createMockStore(overrides?: Partial<SemanticStore>): SemanticStore {
  return {
    loadFromDirectory: vi.fn().mockResolvedValue(ok(undefined)),
    loadFromRegistry: vi.fn().mockResolvedValue(ok(undefined)),
    getApp: vi.fn().mockReturnValue(undefined),
    getPage: vi.fn().mockReturnValue(undefined),
    getTool: vi.fn().mockReturnValue(undefined),
    getWorkflow: vi.fn().mockReturnValue(undefined),
    matchPage: vi.fn().mockReturnValue(undefined),
    resolveFieldRef: vi.fn().mockReturnValue(undefined),
    resolveOutputRef: vi.fn().mockReturnValue(undefined),
    getToolsForPage: vi.fn().mockReturnValue([]),
    getPattern: vi.fn().mockReturnValue(undefined),
    listApps: vi.fn().mockReturnValue([]),
    listPages: vi.fn().mockReturnValue([]),
    listTools: vi.fn().mockReturnValue([]),
    ...overrides,
  } as unknown as SemanticStore;
}

function makePage(overrides?: Partial<PageDefinition>): PageDefinition {
  return {
    id: 'test_page',
    app: 'test_app',
    url_pattern: '/test',
    url_template: 'https://example.com/test',
    wait_for: '.page-ready',
    fields: [],
    outputs: [],
    ...overrides,
  };
}

function makeField(overrides?: Partial<FieldDefinition>): FieldDefinition {
  return {
    id: 'test_field',
    label: 'Test Field',
    type: 'text',
    selectors: [{ strategy: 'css', selector: '#test-input' }],
    interaction: { type: 'type' },
    ...overrides,
  };
}

function makeOutput(overrides?: Partial<OutputDefinition>): OutputDefinition {
  return {
    id: 'test_output',
    label: 'Test Output',
    selectors: [{ strategy: 'css', selector: '.result' }],
    ...overrides,
  };
}

function makeTool(overrides?: Partial<ToolDefinition>): ToolDefinition {
  return {
    name: 'test_tool',
    description: 'A test tool',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query' } },
      required: ['query'],
    },
    bridge: {
      page: 'test_page',
      steps: [],
    },
    ...overrides,
  };
}

function defaultHealingConfig(): HealingConfig {
  return { aiHealing: false, humanInLoop: false };
}

describe('ExecutionEngine.executeTool()', () => {
  let driver: BridgeDriver;
  let store: SemanticStore;
  let selectorResolver: SelectorResolver;
  let resultCapturer: ResultCapturer;
  let healingPipeline: HealingPipeline;
  let templateRenderer: TemplateRenderer;
  let engine: ExecutionEngine;
  const mockElement: ElementHandle = { _brand: 'ElementHandle' };

  beforeEach(() => {
    driver = createMockDriver();
    selectorResolver = new SelectorResolver();
    resultCapturer = new ResultCapturer(selectorResolver);
    healingPipeline = new HealingPipeline(defaultHealingConfig());
    templateRenderer = new TemplateRenderer();
  });

  // ─── 1. Tool not found ────────────────────────────────

  it('returns TOOL_NOT_FOUND when tool does not exist', async () => {
    store = createMockStore({ getTool: vi.fn().mockReturnValue(undefined) });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    const result = await engine.executeTool('missing_tool', {}, driver);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TOOL_NOT_FOUND');
      expect(result.error.source).toBe('engine');
    }
  });

  // ─── 2. Input validation failure ──────────────────────

  it('returns PAGE_NOT_FOUND when tool references page that store cannot find', async () => {
    const tool = makeTool();
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(undefined),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    const result = await engine.executeTool('test_tool', {}, driver);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PAGE_NOT_FOUND');
    }
  });

  // ─── 3. Page not found ────────────────────────────────

  it('returns PAGE_NOT_FOUND when tool references unknown page', async () => {
    const tool = makeTool();
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(undefined),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    const result = await engine.executeTool('test_tool', { query: 'test' }, driver);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PAGE_NOT_FOUND');
    }
  });

  // ─── 4. Navigation failure ────────────────────────────

  it('returns NAVIGATION_FAILED when driver.goto rejects in navigate step', async () => {
    const page = makePage();
    const tool = makeTool({
      bridge: {
        page: 'test_page',
        steps: [{ navigate: { page: 'test_page' } }],
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    (driver.goto as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    const result = await engine.executeTool('test_tool', { query: 'test' }, driver);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NAVIGATION_FAILED');
    }
  });

  // ─── 5. Wait timeout ─────────────────────────────────

  it('returns NAVIGATION_TIMEOUT when wait_for times out in navigate step', async () => {
    const page = makePage();
    const tool = makeTool({
      bridge: {
        page: 'test_page',
        steps: [{ navigate: { page: 'test_page' } }],
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    (driver.waitFor as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Timeout'));

    const result = await engine.executeTool('test_tool', { query: 'test' }, driver);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NAVIGATION_TIMEOUT');
    }
  });

  // ─── 6. Empty steps succeeds ─────────────────────────

  it('succeeds with empty steps and no outputs', async () => {
    const page = makePage();
    const tool = makeTool();
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    const result = await engine.executeTool('test_tool', { query: 'test' }, driver);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(true);
      expect(result.value.stepsExecuted).toBe(0);
      expect(result.value.outputs).toEqual({});
      expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  // ─── 7. Interact step: type ───────────────────────────

  it('executes interact step with type action', async () => {
    const field = makeField();
    const page = makePage({ fields: [field] });
    const tool = makeTool({
      bridge: {
        page: 'test_page',
        steps: [
          { interact: { field: 'test_field', action: 'type', value: '{{query}}' } },
        ],
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
      resolveFieldRef: vi.fn().mockReturnValue(field),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    const result = await engine.executeTool('test_tool', { query: 'hello' }, driver);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(true);
      expect(result.value.stepsExecuted).toBe(1);
    }
    expect(driver.type).toHaveBeenCalledWith(mockElement, 'hello');
  });

  // ─── 8. Interact step: click ──────────────────────────

  it('executes interact step with click action', async () => {
    const field = makeField({ interaction: { type: 'click' } });
    const page = makePage({ fields: [field] });
    const tool = makeTool({
      bridge: {
        page: 'test_page',
        steps: [
          { interact: { field: 'test_field', action: 'click' } },
        ],
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
      resolveFieldRef: vi.fn().mockReturnValue(field),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    const result = await engine.executeTool('test_tool', { query: 'test' }, driver);

    expect(result.ok).toBe(true);
    expect(driver.click).toHaveBeenCalled();
  });

  // ─── 9. Interact step: select ─────────────────────────

  it('executes interact step with select action', async () => {
    const field = makeField({ type: 'picklist' });
    const page = makePage({ fields: [field] });
    const tool = makeTool({
      bridge: {
        page: 'test_page',
        steps: [
          { interact: { field: 'test_field', action: 'select', value: 'option_a' } },
        ],
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
      resolveFieldRef: vi.fn().mockReturnValue(field),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    const result = await engine.executeTool('test_tool', { query: 'test' }, driver);

    expect(result.ok).toBe(true);
    expect(driver.select).toHaveBeenCalledWith(mockElement, 'option_a');
  });

  // ─── 10. Capture step ─────────────────────────────────

  it('executes capture step and stores value in outputs', async () => {
    const output = makeOutput();
    const page = makePage({ outputs: [output] });
    const tool = makeTool({
      bridge: {
        page: 'test_page',
        steps: [
          { capture: { from: 'test_output', store_as: 'result' } },
        ],
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
      resolveOutputRef: vi.fn().mockReturnValue(output),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    (driver.readText as ReturnType<typeof vi.fn>).mockResolvedValue('Captured text');

    const result = await engine.executeTool('test_tool', { query: 'test' }, driver);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outputs['result']).toBe('Captured text');
    }
  });

  // ─── 11. Wait step ────────────────────────────────────

  it('executes wait step', async () => {
    const page = makePage();
    const tool = makeTool({
      bridge: {
        page: 'test_page',
        steps: [{ wait: 500 }],
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    const result = await engine.executeTool('test_tool', { query: 'test' }, driver);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stepsExecuted).toBe(1);
    }
    expect(driver.waitFor).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'timeout' }),
    );
  });

  // ─── 12. Navigate step ────────────────────────────────

  it('executes navigate step to change page', async () => {
    const page1 = makePage({ id: 'page1' });
    const page2 = makePage({
      id: 'page2',
      url_template: 'https://example.com/page2',
      wait_for: '.page2-ready',
    });
    const tool = makeTool({
      bridge: {
        page: 'page1',
        steps: [{ navigate: { page: 'page2' } }],
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockImplementation((id: string) => {
        if (id === 'page1') return page1;
        if (id === 'page2') return page2;
        return undefined;
      }),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    const result = await engine.executeTool('test_tool', { query: 'test' }, driver);

    expect(result.ok).toBe(true);
    // goto called once for the navigate step
    expect(driver.goto).toHaveBeenCalledTimes(1);
  });

  // ─── 13. Evaluate JS step ────────────────────────────

  it('executes evaluate_js step', async () => {
    const page = makePage();
    const tool = makeTool({
      bridge: {
        page: 'test_page',
        steps: [{ evaluate_js: 'document.title = "{{query}}"' }],
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    const result = await engine.executeTool('test_tool', { query: 'hello' }, driver);

    expect(result.ok).toBe(true);
    expect(driver.evaluate).toHaveBeenCalledWith('document.title = "hello"');
  });

  // ─── 14. Selector failure with healing success ────────

  it('invokes healing when selector fails and recovers', async () => {
    // Use a CSS selector that can be relaxed (has nth-child)
    const field = makeField({
      selectors: [{ strategy: 'css', selector: 'input.search:nth-child(2)' }],
    });
    const page = makePage({ fields: [field] });
    const tool = makeTool({
      bridge: {
        page: 'test_page',
        steps: [{ interact: { field: 'test_field', action: 'click' } }],
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
      resolveFieldRef: vi.fn().mockReturnValue(field),
    });

    const healedElement: ElementHandle = { _brand: 'ElementHandle' };

    // findElement fails for original selector, then succeeds for relaxed
    (driver.findElement as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValue(healedElement);

    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    const result = await engine.executeTool('test_tool', { query: 'test' }, driver);

    expect(result.ok).toBe(true);
    expect(driver.click).toHaveBeenCalled();
  });

  // ─── 15. Selector failure + healing failure ───────────

  it('returns SELECTOR_NOT_FOUND when healing also fails', async () => {
    const field = makeField({
      selectors: [{ strategy: 'aria', role: 'button', name: 'Missing' }],
    });
    const page = makePage({ fields: [field] });
    const tool = makeTool({
      bridge: {
        page: 'test_page',
        steps: [{ interact: { field: 'test_field', action: 'click' } }],
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
      resolveFieldRef: vi.fn().mockReturnValue(field),
    });

    (driver.findElement as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));
    (driver.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    const result = await engine.executeTool('test_tool', { query: 'test' }, driver);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SELECTOR_NOT_FOUND');
    }
  });

  // ─── 16. Multiple steps with variable context ────────

  it('accumulates captured values across steps', async () => {
    const field = makeField();
    const output1 = makeOutput({ id: 'output_1' });
    const output2 = makeOutput({ id: 'output_2' });
    const page = makePage({ fields: [field], outputs: [output1, output2] });
    const tool = makeTool({
      bridge: {
        page: 'test_page',
        steps: [
          { interact: { field: 'test_field', action: 'type', value: '{{query}}' } },
          { capture: { from: 'output_1', store_as: 'first_result' } },
          { capture: { from: 'output_2', store_as: 'second_result' } },
        ],
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
      resolveFieldRef: vi.fn().mockReturnValue(field),
      resolveOutputRef: vi.fn().mockImplementation((ref: string) => {
        if (ref.includes('output_1')) return output1;
        if (ref.includes('output_2')) return output2;
        return undefined;
      }),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    (driver.readText as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('Value 1')
      .mockResolvedValueOnce('Value 2');

    const result = await engine.executeTool('test_tool', { query: 'test' }, driver);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outputs['first_result']).toBe('Value 1');
      expect(result.value.outputs['second_result']).toBe('Value 2');
      expect(result.value.stepsExecuted).toBe(3);
    }
  });

  // ─── 17. Returns mapping ──────────────────────────────

  it('applies returns mapping from bridge definition', async () => {
    const output = makeOutput();
    const page = makePage({ outputs: [output] });
    const tool = makeTool({
      bridge: {
        page: 'test_page',
        steps: [
          { capture: { from: 'test_output', store_as: 'raw_value' } },
        ],
        returns: {
          formatted_result: '{{raw_value}}',
        },
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
      resolveOutputRef: vi.fn().mockReturnValue(output),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    (driver.readText as ReturnType<typeof vi.fn>).mockResolvedValue('Hello World');

    const result = await engine.executeTool('test_tool', { query: 'test' }, driver);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outputs['formatted_result']).toBe('Hello World');
    }
  });

  // ─── 18. Conditional step skip ────────────────────────

  it('skips step when condition evaluates to falsy', async () => {
    const field = makeField();
    const page = makePage({ fields: [field] });
    const tool = makeTool({
      bridge: {
        page: 'test_page',
        steps: [
          { interact: { field: 'test_field', action: 'click' }, condition: '{{should_click}}' },
        ],
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
      resolveFieldRef: vi.fn().mockReturnValue(field),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    // should_click is not in inputs, so renders to empty -> falsy
    const result = await engine.executeTool('test_tool', { query: 'test' }, driver);

    expect(result.ok).toBe(true);
    expect(driver.click).not.toHaveBeenCalled();
  });

  // ─── 19. Field default action ─────────────────────────

  it('uses field interaction type when action not specified', async () => {
    const field = makeField({ interaction: { type: 'click' } });
    const page = makePage({ fields: [field] });
    const tool = makeTool({
      bridge: {
        page: 'test_page',
        steps: [
          { interact: { field: 'test_field' } },
        ],
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
      resolveFieldRef: vi.fn().mockReturnValue(field),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    const result = await engine.executeTool('test_tool', { query: 'test' }, driver);

    expect(result.ok).toBe(true);
    expect(driver.click).toHaveBeenCalled();
  });

  // ─── 20. Unknown step type ────────────────────────────

  it('returns error for unknown step type', async () => {
    const page = makePage();
    const tool = makeTool({
      bridge: {
        page: 'test_page',
        steps: [{ unknown_step: true } as unknown as ToolDefinition['bridge']['steps'][0]],
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    const result = await engine.executeTool('test_tool', { query: 'test' }, driver);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DRIVER_ERROR');
    }
  });

  // ─── 21. Check action ────────────────────────────────

  it('executes check action', async () => {
    const field = makeField({ type: 'checkbox' });
    const page = makePage({ fields: [field] });
    const tool = makeTool({
      bridge: {
        page: 'test_page',
        steps: [
          { interact: { field: 'test_field', action: 'check' } },
        ],
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
      resolveFieldRef: vi.fn().mockReturnValue(field),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    const result = await engine.executeTool('test_tool', { query: 'test' }, driver);

    expect(result.ok).toBe(true);
    expect(driver.check).toHaveBeenCalledWith(mockElement, true);
  });

  // ─── 22. Hover action ────────────────────────────────

  it('executes hover action', async () => {
    const field = makeField();
    const page = makePage({ fields: [field] });
    const tool = makeTool({
      bridge: {
        page: 'test_page',
        steps: [
          { interact: { field: 'test_field', action: 'hover' } },
        ],
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
      resolveFieldRef: vi.fn().mockReturnValue(field),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    const result = await engine.executeTool('test_tool', { query: 'test' }, driver);

    expect(result.ok).toBe(true);
    expect(driver.hover).toHaveBeenCalled();
  });

  // ─── 23. Clear action ────────────────────────────────

  it('executes clear action', async () => {
    const field = makeField();
    const page = makePage({ fields: [field] });
    const tool = makeTool({
      bridge: {
        page: 'test_page',
        steps: [
          { interact: { field: 'test_field', action: 'clear' } },
        ],
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
      resolveFieldRef: vi.fn().mockReturnValue(field),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    const result = await engine.executeTool('test_tool', { query: 'test' }, driver);

    expect(result.ok).toBe(true);
    expect(driver.clear).toHaveBeenCalled();
  });

  // ─── 24. Wait with string duration ────────────────────

  it('handles wait step with string duration', async () => {
    const page = makePage();
    const tool = makeTool({
      bridge: {
        page: 'test_page',
        steps: [{ wait: '2s' }],
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    const result = await engine.executeTool('test_tool', { query: 'test' }, driver);

    expect(result.ok).toBe(true);
    expect(driver.waitFor).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'timeout', value: 2000 }),
    );
  });

  // ─── 25. Field not found ──────────────────────────────

  it('returns error when interact field is not found', async () => {
    const page = makePage();
    const tool = makeTool({
      bridge: {
        page: 'test_page',
        steps: [
          { interact: { field: 'nonexistent_field', action: 'click' } },
        ],
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
      resolveFieldRef: vi.fn().mockReturnValue(undefined),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    const result = await engine.executeTool('test_tool', { query: 'test' }, driver);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('nonexistent_field');
    }
  });

  // ─── 26. Output not found ─────────────────────────────

  it('returns error when capture output is not found', async () => {
    const page = makePage();
    const tool = makeTool({
      bridge: {
        page: 'test_page',
        steps: [
          { capture: { from: 'nonexistent_output', store_as: 'val' } },
        ],
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
      resolveOutputRef: vi.fn().mockReturnValue(undefined),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    const result = await engine.executeTool('test_tool', { query: 'test' }, driver);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('nonexistent_output');
    }
  });

  // ─── 27. URL template rendering ───────────────────────

  it('renders URL template with input variables via navigate step', async () => {
    const page = makePage({
      url_template: 'https://example.com/search?q={{query}}',
    });
    const tool = makeTool({
      bridge: {
        page: 'test_page',
        steps: [{ navigate: { page: 'test_page' } }],
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    const result = await engine.executeTool('test_tool', { query: 'hello world' }, driver);

    expect(result.ok).toBe(true);
    expect(driver.goto).toHaveBeenCalledWith('https://example.com/search?q=hello world');
  });

  // ─── 28. Navigate step with params ────────────────────

  it('navigate step renders URL with params', async () => {
    const page1 = makePage({ id: 'page1' });
    const page2 = makePage({
      id: 'page2',
      url_template: 'https://example.com/records/{{record_id}}',
    });
    const tool = makeTool({
      bridge: {
        page: 'page1',
        steps: [
          { navigate: { page: 'page2', params: { record_id: '42' } } },
        ],
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockImplementation((id: string) => {
        if (id === 'page1') return page1;
        if (id === 'page2') return page2;
        return undefined;
      }),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    const result = await engine.executeTool('test_tool', { query: 'test' }, driver);

    expect(result.ok).toBe(true);
    expect(driver.goto).toHaveBeenCalledWith('https://example.com/records/42');
  });

  // ─── 29. Dispatch events ──────────────────────────────

  it('dispatches events after interaction', async () => {
    const field = makeField();
    const page = makePage({ fields: [field] });
    const tool = makeTool({
      bridge: {
        page: 'test_page',
        steps: [
          {
            interact: {
              field: 'test_field',
              action: 'click',
              dispatch: [{ event: 'change', bubbles: true }],
            },
          },
        ],
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
      resolveFieldRef: vi.fn().mockReturnValue(field),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    const result = await engine.executeTool('test_tool', { query: 'test' }, driver);

    expect(result.ok).toBe(true);
    expect(driver.dispatchEvent).toHaveBeenCalledWith(
      mockElement,
      'change',
      expect.objectContaining({ bubbles: true }),
    );
  });

  // ─── 30. Valid inputs pass ────────────────────────────

  it('passes validation with correct inputs', async () => {
    const page = makePage();
    const tool = makeTool({
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name' },
          age: { type: 'number', description: 'Age' },
        },
        required: ['name'],
      },
    });
    store = createMockStore({
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline, templateRenderer);

    const result = await engine.executeTool('test_tool', { name: 'Alice' }, driver);

    expect(result.ok).toBe(true);
  });
});
