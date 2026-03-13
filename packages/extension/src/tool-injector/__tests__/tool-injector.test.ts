/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  createModelContext,
  injectToolContext,
  type ToolInjectorDeps,
  type ModelContextTool,
} from '../index.js';

// ─── Mocks ─────────────────────────────────────────────

function createMockChrome() {
  return {
    runtime: {
      sendMessage: vi.fn(),
    },
  };
}

function createMockDeps(overrides?: Partial<ToolInjectorDeps>): ToolInjectorDeps {
  return {
    chrome: createMockChrome() as unknown as typeof chrome,
    navigator: globalThis.navigator,
    document: globalThis.document,
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────

describe('Tool Injector', () => {
  beforeEach(() => {
    // Clean up any prior injections
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (navigator as any).modelContext;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (navigator as any).modelContext;
  });

  describe('createModelContext', () => {
    it('creates a model context with tools array', () => {
      const tools: ModelContextTool[] = [
        { name: 'create_todo', description: 'Create a todo', inputSchema: { type: 'object' } },
      ];

      const mockChrome = createMockChrome();
      const ctx = createModelContext(tools, mockChrome as unknown as typeof chrome);

      expect(ctx.tools).toEqual(tools);
    });

    it('creates a model context with execute function', () => {
      const tools: ModelContextTool[] = [];
      const mockChrome = createMockChrome();
      const ctx = createModelContext(tools, mockChrome as unknown as typeof chrome);

      expect(typeof ctx.execute).toBe('function');
    });

    it('execute sends EXECUTE_TOOL message via chrome runtime', () => {
      const tools: ModelContextTool[] = [
        { name: 'create_todo', description: 'Create', inputSchema: { type: 'object' } },
      ];
      const mockChrome = createMockChrome();
      mockChrome.runtime.sendMessage.mockImplementation(
        (_msg: unknown, callback: (response: { ok: boolean; data?: unknown; error?: string }) => void) => {
          callback({ ok: true, data: { id: '123' } });
        },
      );

      const ctx = createModelContext(tools, mockChrome as unknown as typeof chrome);

      const promise = ctx.execute('create_todo', { title: 'Test' });

      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
        {
          type: 'EXECUTE_TOOL',
          payload: { toolName: 'create_todo', inputs: { title: 'Test' } },
        },
        expect.any(Function),
      );

      return expect(promise).resolves.toEqual({ id: '123' });
    });

    it('execute rejects on error response', () => {
      const tools: ModelContextTool[] = [];
      const mockChrome = createMockChrome();
      mockChrome.runtime.sendMessage.mockImplementation(
        (_msg: unknown, callback: (response: { ok: boolean; error?: string }) => void) => {
          callback({ ok: false, error: 'Tool not found' });
        },
      );

      const ctx = createModelContext(tools, mockChrome as unknown as typeof chrome);
      const promise = ctx.execute('unknown_tool', {});

      return expect(promise).rejects.toThrow('Tool not found');
    });
  });

  describe('injectToolContext', () => {
    it('fetches tools from service worker and injects modelContext', async () => {
      const deps = createMockDeps();
      const mockSendMessage = deps.chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;

      // Mock GET_TOOLS response
      mockSendMessage.mockImplementation(
        (msg: { type: string }, callback?: (response: { tools: ModelContextTool[] }) => void) => {
          if (msg.type === 'GET_TOOLS' && callback) {
            callback({
              tools: [
                { name: 'create_todo', description: 'Create todo', inputSchema: { type: 'object' } },
              ],
            });
          }
        },
      );

      injectToolContext(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const modelContext = (deps.navigator as any).modelContext;
      expect(modelContext).toBeDefined();
      expect(modelContext.tools).toHaveLength(1);
      expect(modelContext.tools[0].name).toBe('create_todo');
    });

    it('does not overwrite existing native modelContext tools', async () => {
      const deps = createMockDeps();

      // Simulate existing native WebMCP tools
      const nativeTool = { name: 'native_tool', description: 'Native', inputSchema: { type: 'object' } };
      Object.defineProperty(deps.navigator, 'modelContext', {
        value: { tools: [nativeTool], execute: vi.fn() },
        writable: true,
        configurable: true,
      });

      const mockSendMessage = deps.chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
      mockSendMessage.mockImplementation(
        (msg: { type: string }, callback?: (response: { tools: ModelContextTool[] }) => void) => {
          if (msg.type === 'GET_TOOLS' && callback) {
            callback({
              tools: [
                { name: 'bridge_tool', description: 'Bridge', inputSchema: { type: 'object' } },
              ],
            });
          }
        },
      );

      injectToolContext(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const modelContext = (deps.navigator as any).modelContext;
      // Should include both native and bridge tools
      expect(modelContext.tools).toHaveLength(2);
      const names = modelContext.tools.map((t: ModelContextTool) => t.name);
      expect(names).toContain('native_tool');
      expect(names).toContain('bridge_tool');
    });

    it('handles empty tools response', () => {
      const deps = createMockDeps();
      const mockSendMessage = deps.chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;

      mockSendMessage.mockImplementation(
        (msg: { type: string }, callback?: (response: { tools: ModelContextTool[] }) => void) => {
          if (msg.type === 'GET_TOOLS' && callback) {
            callback({ tools: [] });
          }
        },
      );

      injectToolContext(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const modelContext = (deps.navigator as any).modelContext;
      expect(modelContext).toBeDefined();
      expect(modelContext.tools).toHaveLength(0);
    });

    it('defers to native tools when names conflict', () => {
      const deps = createMockDeps();

      // Simulate existing native tool with same name
      const nativeTool = { name: 'create_todo', description: 'Native create', inputSchema: { type: 'object' } };
      Object.defineProperty(deps.navigator, 'modelContext', {
        value: { tools: [nativeTool], execute: vi.fn() },
        writable: true,
        configurable: true,
      });

      const mockSendMessage = deps.chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
      mockSendMessage.mockImplementation(
        (msg: { type: string }, callback?: (response: { tools: ModelContextTool[] }) => void) => {
          if (msg.type === 'GET_TOOLS' && callback) {
            callback({
              tools: [
                { name: 'create_todo', description: 'Bridge create', inputSchema: { type: 'object' } },
              ],
            });
          }
        },
      );

      injectToolContext(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const modelContext = (deps.navigator as any).modelContext;
      // Should keep native version, not duplicate
      expect(modelContext.tools).toHaveLength(1);
      expect(modelContext.tools[0].description).toBe('Native create');
    });
  });
});
