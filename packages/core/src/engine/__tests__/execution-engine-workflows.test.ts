/**
 * Unit tests for ExecutionEngine.executeWorkflow().
 * Covers: workflow not found, tool step execution, for_each loops,
 * aggregate steps, on_error handling, variable accumulation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ExecutionEngine } from '../execution-engine.js';
import { createMockDriver } from '../../drivers/mock-driver.js';
import { SelectorResolver } from '../../selector/selector-resolver.js';
import { ResultCapturer } from '../../capture/result-capturer.js';
import { HealingPipeline } from '../../healing/healing-pipeline.js';
import type { BridgeDriver } from '../../types/bridge-driver.js';
import type { SemanticStore } from '../../semantic/semantic-store.js';
import type {
  ToolDefinition,
  PageDefinition,
  FieldDefinition,
  OutputDefinition,
  WorkflowDefinition,
} from '../../types/semantic-model.js';
import type { HealingConfig } from '../../types/config.js';
import { ok } from '../../types/result.js';

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

function makeWorkflow(overrides?: Partial<WorkflowDefinition>): WorkflowDefinition {
  return {
    name: 'test_workflow',
    description: 'A test workflow',
    input: {
      type: 'object',
      properties: {},
    },
    steps: [],
    ...overrides,
  };
}

function defaultHealingConfig(): HealingConfig {
  return { aiHealing: false, humanInLoop: false };
}

describe('ExecutionEngine.executeWorkflow()', () => {
  let driver: BridgeDriver;
  let store: SemanticStore;
  let selectorResolver: SelectorResolver;
  let resultCapturer: ResultCapturer;
  let healingPipeline: HealingPipeline;
  let engine: ExecutionEngine;

  beforeEach(() => {
    driver = createMockDriver();
    selectorResolver = new SelectorResolver();
    resultCapturer = new ResultCapturer(selectorResolver);
    healingPipeline = new HealingPipeline(defaultHealingConfig());
  });

  // ─── 1. Workflow not found ─────────────────────────────

  it('returns error when workflow does not exist', async () => {
    store = createMockStore({ getWorkflow: vi.fn().mockReturnValue(undefined) });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline);

    const result = await engine.executeWorkflow('missing_workflow', {}, driver);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TOOL_NOT_FOUND');
      expect(result.error.message).toContain('missing_workflow');
    }
  });

  // ─── 2. Empty workflow succeeds ────────────────────────

  it('succeeds with empty workflow steps', async () => {
    const workflow = makeWorkflow({ steps: [] });
    store = createMockStore({ getWorkflow: vi.fn().mockReturnValue(workflow) });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline);

    const result = await engine.executeWorkflow('test_workflow', { data: 'hello' }, driver);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(true);
      expect(result.value.outputs).toHaveProperty('data', 'hello');
      expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  // ─── 3. Workflow tool step executes tool ───────────────

  it('executes a workflow tool step that calls a tool', async () => {
    const field = makeField();
    const output = makeOutput();
    const page = makePage({ fields: [field], outputs: [output] });
    const tool = makeTool({
      name: 'add_item',
      bridge: {
        page: 'test_page',
        steps: [
          { interact: { field: 'test_field', action: 'type', value: '{{query}}' } },
          { capture: { from: 'test_output', store_as: 'result' } },
        ],
        returns: { result: '{{result}}' },
      },
    });
    const workflow = makeWorkflow({
      steps: [
        { tool: 'add_item', params: { query: '{{item_name}}' } },
      ],
    });

    store = createMockStore({
      getWorkflow: vi.fn().mockReturnValue(workflow),
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
      resolveFieldRef: vi.fn().mockReturnValue(field),
      resolveOutputRef: vi.fn().mockReturnValue(output),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline);

    (driver.readText as ReturnType<typeof vi.fn>).mockResolvedValue('Item added');

    const result = await engine.executeWorkflow('test_workflow', { item_name: 'Test' }, driver);

    expect(result.ok).toBe(true);
    expect(driver.type).toHaveBeenCalledWith(
      expect.objectContaining({ _brand: 'ElementHandle' }),
      'Test',
    );
  });

  // ─── 4. Workflow tool step with capture ────────────────

  it('captures tool outputs into workflow context', async () => {
    const output = makeOutput();
    const page = makePage({ outputs: [output] });
    const tool = makeTool({
      name: 'count_items',
      bridge: {
        page: 'test_page',
        steps: [
          { capture: { from: 'test_output', store_as: 'count' } },
        ],
        returns: { count: '{{count}}' },
      },
    });
    const workflow = makeWorkflow({
      steps: [
        { tool: 'count_items', params: {}, capture: { item_count: 'count' } },
      ],
    });

    store = createMockStore({
      getWorkflow: vi.fn().mockReturnValue(workflow),
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
      resolveOutputRef: vi.fn().mockReturnValue(output),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline);

    (driver.readText as ReturnType<typeof vi.fn>).mockResolvedValue('5');

    const result = await engine.executeWorkflow('test_workflow', {}, driver);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outputs['item_count']).toBe('5');
    }
  });

  // ─── 5. Workflow tool step with on_error: skip ────────

  it('skips failed tool step when on_error is skip', async () => {
    const workflow = makeWorkflow({
      steps: [
        { tool: 'missing_tool', params: {}, on_error: 'skip' },
      ],
    });

    store = createMockStore({
      getWorkflow: vi.fn().mockReturnValue(workflow),
      getTool: vi.fn().mockReturnValue(undefined),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline);

    const result = await engine.executeWorkflow('test_workflow', {}, driver);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(true);
    }
  });

  // ─── 6. Workflow tool step fails without on_error ─────

  it('returns error when tool step fails and no on_error', async () => {
    const workflow = makeWorkflow({
      steps: [
        { tool: 'missing_tool', params: {} },
      ],
    });

    store = createMockStore({
      getWorkflow: vi.fn().mockReturnValue(workflow),
      getTool: vi.fn().mockReturnValue(undefined),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline);

    const result = await engine.executeWorkflow('test_workflow', {}, driver);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TOOL_NOT_FOUND');
    }
  });

  // ─── 7. for_each step iterates over array ─────────────

  it('iterates over array with for_each step', async () => {
    const field = makeField();
    const page = makePage({ fields: [field] });
    const tool = makeTool({
      name: 'add_item',
      bridge: {
        page: 'test_page',
        steps: [
          { interact: { field: 'test_field', action: 'type', value: '{{name}}' } },
        ],
      },
    });
    const workflow = makeWorkflow({
      steps: [
        {
          for_each: 'items',
          as: 'item',
          steps: [
            { tool: 'add_item', params: { name: '{{item}}' } },
          ],
        },
      ],
    });

    store = createMockStore({
      getWorkflow: vi.fn().mockReturnValue(workflow),
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
      resolveFieldRef: vi.fn().mockReturnValue(field),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline);

    const result = await engine.executeWorkflow(
      'test_workflow',
      { items: ['Apple', 'Banana', 'Cherry'] },
      driver,
    );

    expect(result.ok).toBe(true);
    // type should be called 3 times (once per item)
    expect(driver.type).toHaveBeenCalledTimes(3);
  });

  // ─── 8. for_each with non-array returns error ─────────

  it('returns error when for_each variable is not an array', async () => {
    const workflow = makeWorkflow({
      steps: [
        {
          for_each: 'not_an_array',
          as: 'item',
          steps: [],
        },
      ],
    });

    store = createMockStore({
      getWorkflow: vi.fn().mockReturnValue(workflow),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline);

    const result = await engine.executeWorkflow(
      'test_workflow',
      { not_an_array: 'just a string' },
      driver,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('WORKFLOW_STEP_FAILED');
      expect(result.error.message).toContain('not an array');
    }
  });

  // ─── 9. for_each with on_error: continue ──────────────

  it('continues iteration when on_error is continue and inner step fails', async () => {
    const page = makePage();
    const tool = makeTool({
      name: 'process_item',
      bridge: { page: 'test_page', steps: [] },
    });
    const workflow = makeWorkflow({
      steps: [
        {
          for_each: 'items',
          as: 'item',
          on_error: 'continue',
          steps: [
            { tool: 'process_item', params: {} },
          ],
        },
      ],
    });

    let callCount = 0;
    store = createMockStore({
      getWorkflow: vi.fn().mockReturnValue(workflow),
      getTool: vi.fn().mockImplementation(() => {
        callCount++;
        // Fail on second item
        if (callCount === 2) return undefined;
        return tool;
      }),
      getPage: vi.fn().mockReturnValue(page),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline);

    const result = await engine.executeWorkflow(
      'test_workflow',
      { items: ['a', 'b', 'c'] },
      driver,
    );

    // Should succeed because on_error: continue
    expect(result.ok).toBe(true);
  });

  // ─── 10. for_each stops on error without on_error ─────

  it('stops iteration on error when on_error is not set', async () => {
    const workflow = makeWorkflow({
      steps: [
        {
          for_each: 'items',
          as: 'item',
          steps: [
            { tool: 'missing_tool', params: {} },
          ],
        },
      ],
    });

    store = createMockStore({
      getWorkflow: vi.fn().mockReturnValue(workflow),
      getTool: vi.fn().mockReturnValue(undefined),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline);

    const result = await engine.executeWorkflow(
      'test_workflow',
      { items: ['a', 'b'] },
      driver,
    );

    expect(result.ok).toBe(false);
  });

  // ─── 11. Aggregate step ───────────────────────────────

  it('aggregate step renders templates and stores variables', async () => {
    const workflow = makeWorkflow({
      steps: [
        {
          aggregate: {
            summary: 'Processed {{count}} items',
            status: 'done',
          },
        },
      ],
    });

    store = createMockStore({
      getWorkflow: vi.fn().mockReturnValue(workflow),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline);

    const result = await engine.executeWorkflow(
      'test_workflow',
      { count: '3' },
      driver,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outputs['summary']).toBe('Processed 3 items');
      expect(result.value.outputs['status']).toBe('done');
    }
  });

  // ─── 12. Multi-step workflow with tool chaining ───────

  it('chains tool outputs across multiple workflow steps', async () => {
    const output = makeOutput();
    const page = makePage({ outputs: [output] });
    const tool1 = makeTool({
      name: 'step_one',
      bridge: {
        page: 'test_page',
        steps: [{ capture: { from: 'test_output', store_as: 'intermediate' } }],
        returns: { result: '{{intermediate}}' },
      },
    });
    const tool2 = makeTool({
      name: 'step_two',
      bridge: {
        page: 'test_page',
        steps: [{ capture: { from: 'test_output', store_as: 'final' } }],
        returns: { result: '{{final}}' },
      },
    });
    const workflow = makeWorkflow({
      steps: [
        { tool: 'step_one', params: {}, capture: { first_result: 'result' } },
        { tool: 'step_two', params: {}, capture: { second_result: 'result' } },
      ],
    });

    store = createMockStore({
      getWorkflow: vi.fn().mockReturnValue(workflow),
      getTool: vi.fn().mockImplementation((name: string) => {
        if (name === 'step_one') return tool1;
        if (name === 'step_two') return tool2;
        return undefined;
      }),
      getPage: vi.fn().mockReturnValue(page),
      resolveOutputRef: vi.fn().mockReturnValue(output),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline);

    (driver.readText as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('Result A')
      .mockResolvedValueOnce('Result B');

    const result = await engine.executeWorkflow('test_workflow', {}, driver);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outputs['first_result']).toBe('Result A');
      expect(result.value.outputs['second_result']).toBe('Result B');
    }
  });

  // ─── 13. Workflow variables include inputs ────────────

  it('workflow outputs include input variables', async () => {
    const workflow = makeWorkflow({ steps: [] });
    store = createMockStore({ getWorkflow: vi.fn().mockReturnValue(workflow) });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline);

    const result = await engine.executeWorkflow(
      'test_workflow',
      { user: 'alice', mode: 'batch' },
      driver,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outputs['user']).toBe('alice');
      expect(result.value.outputs['mode']).toBe('batch');
    }
  });

  // ─── 14. Unknown workflow step type ───────────────────

  it('returns error for unknown workflow step type', async () => {
    const workflow = makeWorkflow({
      steps: [
        { unknown_step: true } as unknown as WorkflowDefinition['steps'][0],
      ],
    });

    store = createMockStore({
      getWorkflow: vi.fn().mockReturnValue(workflow),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline);

    const result = await engine.executeWorkflow('test_workflow', {}, driver);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DRIVER_ERROR');
    }
  });

  // ─── 15. Auth step in workflow is no-op ───────────────

  it('auth step in workflow succeeds as no-op', async () => {
    const workflow = makeWorkflow({
      steps: [
        { auth: 'oauth2' } as unknown as WorkflowDefinition['steps'][0],
      ],
    });

    store = createMockStore({
      getWorkflow: vi.fn().mockReturnValue(workflow),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline);

    const result = await engine.executeWorkflow('test_workflow', {}, driver);

    expect(result.ok).toBe(true);
  });

  // ─── 16. for_each with empty array ────────────────────

  it('for_each with empty array succeeds with no iterations', async () => {
    const workflow = makeWorkflow({
      steps: [
        {
          for_each: 'items',
          as: 'item',
          steps: [
            { tool: 'some_tool', params: {} },
          ],
        },
      ],
    });

    store = createMockStore({
      getWorkflow: vi.fn().mockReturnValue(workflow),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline);

    const result = await engine.executeWorkflow(
      'test_workflow',
      { items: [] },
      driver,
    );

    expect(result.ok).toBe(true);
  });

  // ─── 17. for_each sets loop variable correctly ────────

  it('for_each sets the loop variable for each iteration', async () => {
    const page = makePage();
    const tool = makeTool({
      name: 'echo_tool',
      bridge: { page: 'test_page', steps: [] },
    });
    const workflow = makeWorkflow({
      steps: [
        {
          for_each: 'names',
          as: 'current_name',
          steps: [
            { tool: 'echo_tool', params: { query: '{{current_name}}' } },
          ],
        },
      ],
    });

    store = createMockStore({
      getWorkflow: vi.fn().mockReturnValue(workflow),
      getTool: vi.fn().mockReturnValue(tool),
      getPage: vi.fn().mockReturnValue(page),
    });
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline);

    // executeTool is called for each iteration - we can verify it doesn't fail
    const result = await engine.executeWorkflow(
      'test_workflow',
      { names: ['Alice', 'Bob'] },
      driver,
    );

    expect(result.ok).toBe(true);
  });
});
