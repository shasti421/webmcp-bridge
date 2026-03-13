/**
 * Unit tests for ExecutionEngine.getToolSchemas().
 * Covers: empty store, single tool, multiple tools, schema format,
 * optional outputSchema, LLM function calling compatibility.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ExecutionEngine } from '../execution-engine.js';
import { SelectorResolver } from '../../selector/selector-resolver.js';
import { ResultCapturer } from '../../capture/result-capturer.js';
import { HealingPipeline } from '../../healing/healing-pipeline.js';
import type { SemanticStore } from '../../semantic/semantic-store.js';
import type { ToolDefinition } from '../../types/semantic-model.js';
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

describe('ExecutionEngine.getToolSchemas()', () => {
  let store: SemanticStore;
  let engine: ExecutionEngine;

  beforeEach(() => {
    const selectorResolver = new SelectorResolver();
    const resultCapturer = new ResultCapturer(selectorResolver);
    const healingPipeline = new HealingPipeline(defaultHealingConfig());
    store = createMockStore();
    engine = new ExecutionEngine(store, selectorResolver, resultCapturer, healingPipeline);
  });

  // ─── 1. Empty store returns empty array ───────────────

  it('returns empty array when no tools are loaded', () => {
    const schemas = engine.getToolSchemas();
    expect(schemas).toEqual([]);
    expect(schemas).toHaveLength(0);
  });

  // ─── 2. Single tool returns one schema ────────────────

  it('returns schema for a single loaded tool', () => {
    const tool = makeTool();
    store = createMockStore({ listTools: vi.fn().mockReturnValue([tool]) });
    const selectorResolver = new SelectorResolver();
    engine = new ExecutionEngine(
      store,
      selectorResolver,
      new ResultCapturer(selectorResolver),
      new HealingPipeline(defaultHealingConfig()),
    );

    const schemas = engine.getToolSchemas();

    expect(schemas).toHaveLength(1);
    expect(schemas[0]!.name).toBe('test_tool');
    expect(schemas[0]!.description).toBe('A test tool');
    expect(schemas[0]!.inputSchema).toEqual({
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query' } },
      required: ['query'],
    });
  });

  // ─── 3. Multiple tools return all schemas ─────────────

  it('returns schemas for all loaded tools', () => {
    const tool1 = makeTool({ name: 'add_todo', description: 'Add a todo item' });
    const tool2 = makeTool({ name: 'delete_todo', description: 'Delete a todo item' });
    const tool3 = makeTool({ name: 'list_todos', description: 'List all todo items' });
    store = createMockStore({
      listTools: vi.fn().mockReturnValue([tool1, tool2, tool3]),
    });
    const selectorResolver = new SelectorResolver();
    engine = new ExecutionEngine(
      store,
      selectorResolver,
      new ResultCapturer(selectorResolver),
      new HealingPipeline(defaultHealingConfig()),
    );

    const schemas = engine.getToolSchemas();

    expect(schemas).toHaveLength(3);
    const names = schemas.map(s => s.name);
    expect(names).toContain('add_todo');
    expect(names).toContain('delete_todo');
    expect(names).toContain('list_todos');
  });

  // ─── 4. Schema includes inputSchema ───────────────────

  it('includes inputSchema with properties and required fields', () => {
    const tool = makeTool({
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Todo title' },
          priority: { type: 'number', description: 'Priority level' },
          done: { type: 'boolean', description: 'Is done' },
        },
        required: ['title'],
      },
    });
    store = createMockStore({ listTools: vi.fn().mockReturnValue([tool]) });
    const selectorResolver = new SelectorResolver();
    engine = new ExecutionEngine(
      store,
      selectorResolver,
      new ResultCapturer(selectorResolver),
      new HealingPipeline(defaultHealingConfig()),
    );

    const schemas = engine.getToolSchemas();
    const schema = schemas[0]!;
    const input = schema.inputSchema as { type: string; properties: Record<string, unknown>; required: string[] };

    expect(input.type).toBe('object');
    expect(input.properties).toHaveProperty('title');
    expect(input.properties).toHaveProperty('priority');
    expect(input.properties).toHaveProperty('done');
    expect(input.required).toEqual(['title']);
  });

  // ─── 5. Schema includes optional outputSchema ─────────

  it('includes outputSchema when tool defines one', () => {
    const tool = makeTool({
      outputSchema: {
        type: 'object',
        properties: {
          item_count: { type: 'number', description: 'Number of items' },
        },
      },
    });
    store = createMockStore({ listTools: vi.fn().mockReturnValue([tool]) });
    const selectorResolver = new SelectorResolver();
    engine = new ExecutionEngine(
      store,
      selectorResolver,
      new ResultCapturer(selectorResolver),
      new HealingPipeline(defaultHealingConfig()),
    );

    const schemas = engine.getToolSchemas();
    const schema = schemas[0]!;

    expect(schema.outputSchema).toBeDefined();
    const output = schema.outputSchema as { type: string; properties: Record<string, unknown> };
    expect(output.type).toBe('object');
    expect(output.properties).toHaveProperty('item_count');
  });

  // ─── 6. Schema omits outputSchema when not defined ────

  it('has undefined outputSchema when tool does not define one', () => {
    const tool = makeTool();
    store = createMockStore({ listTools: vi.fn().mockReturnValue([tool]) });
    const selectorResolver = new SelectorResolver();
    engine = new ExecutionEngine(
      store,
      selectorResolver,
      new ResultCapturer(selectorResolver),
      new HealingPipeline(defaultHealingConfig()),
    );

    const schemas = engine.getToolSchemas();
    const schema = schemas[0]!;

    expect(schema.outputSchema).toBeUndefined();
  });

  // ─── 7. Schema format matches LLM function calling ────

  it('schema format is compatible with LLM function calling', () => {
    const tool = makeTool({
      name: 'search_records',
      description: 'Search for records in the database',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Maximum results' },
        },
        required: ['query'],
      },
    });
    store = createMockStore({ listTools: vi.fn().mockReturnValue([tool]) });
    const selectorResolver = new SelectorResolver();
    engine = new ExecutionEngine(
      store,
      selectorResolver,
      new ResultCapturer(selectorResolver),
      new HealingPipeline(defaultHealingConfig()),
    );

    const schemas = engine.getToolSchemas();
    const schema = schemas[0]!;

    // Verify it has the expected shape for function calling
    expect(typeof schema.name).toBe('string');
    expect(typeof schema.description).toBe('string');
    expect(schema.inputSchema).toBeDefined();
    expect(typeof schema.inputSchema).toBe('object');

    // Verify inputSchema has JSON Schema structure
    const input = schema.inputSchema as { type: string; properties: Record<string, { type: string; description: string }>; required?: string[] };
    expect(input.type).toBe('object');
    expect(input.properties).toBeDefined();
    expect(typeof input.properties).toBe('object');
  });

  // ─── 8. Preserves tool order from store ───────────────

  it('returns schemas in the same order as store.listTools()', () => {
    const tools = [
      makeTool({ name: 'z_tool', description: 'Last alphabetically' }),
      makeTool({ name: 'a_tool', description: 'First alphabetically' }),
      makeTool({ name: 'm_tool', description: 'Middle alphabetically' }),
    ];
    store = createMockStore({ listTools: vi.fn().mockReturnValue(tools) });
    const selectorResolver = new SelectorResolver();
    engine = new ExecutionEngine(
      store,
      selectorResolver,
      new ResultCapturer(selectorResolver),
      new HealingPipeline(defaultHealingConfig()),
    );

    const schemas = engine.getToolSchemas();
    const names = schemas.map(s => s.name);

    expect(names).toEqual(['z_tool', 'a_tool', 'm_tool']);
  });

  // ─── 9. Does not include bridge details ───────────────

  it('does not leak bridge implementation details in schemas', () => {
    const tool = makeTool({
      bridge: {
        page: 'secret_page',
        steps: [{ navigate: { page: 'secret_page' } }],
      },
    });
    store = createMockStore({ listTools: vi.fn().mockReturnValue([tool]) });
    const selectorResolver = new SelectorResolver();
    engine = new ExecutionEngine(
      store,
      selectorResolver,
      new ResultCapturer(selectorResolver),
      new HealingPipeline(defaultHealingConfig()),
    );

    const schemas = engine.getToolSchemas();
    const schema = schemas[0]!;

    // Schema should only have name, description, inputSchema, outputSchema
    const keys = Object.keys(schema);
    expect(keys).toContain('name');
    expect(keys).toContain('description');
    expect(keys).toContain('inputSchema');
    expect(keys).not.toContain('bridge');
    expect(keys).not.toContain('steps');
    expect(keys).not.toContain('page');
  });

  // ─── 10. Tool with no required fields ─────────────────

  it('handles tool with no required input fields', () => {
    const tool = makeTool({
      inputSchema: {
        type: 'object',
        properties: {
          optional_param: { type: 'string', description: 'Optional' },
        },
      },
    });
    store = createMockStore({ listTools: vi.fn().mockReturnValue([tool]) });
    const selectorResolver = new SelectorResolver();
    engine = new ExecutionEngine(
      store,
      selectorResolver,
      new ResultCapturer(selectorResolver),
      new HealingPipeline(defaultHealingConfig()),
    );

    const schemas = engine.getToolSchemas();
    const input = schemas[0]!.inputSchema as { required?: string[] };

    expect(input.required).toBeUndefined();
  });

  // ─── 11. Tool with empty properties ───────────────────

  it('handles tool with no input properties (action-only tool)', () => {
    const tool = makeTool({
      inputSchema: {
        type: 'object',
        properties: {},
      },
    });
    store = createMockStore({ listTools: vi.fn().mockReturnValue([tool]) });
    const selectorResolver = new SelectorResolver();
    engine = new ExecutionEngine(
      store,
      selectorResolver,
      new ResultCapturer(selectorResolver),
      new HealingPipeline(defaultHealingConfig()),
    );

    const schemas = engine.getToolSchemas();
    const input = schemas[0]!.inputSchema as { properties: Record<string, unknown> };

    expect(input.properties).toEqual({});
  });
});
