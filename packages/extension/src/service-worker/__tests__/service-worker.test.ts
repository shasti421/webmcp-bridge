import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  handlePageDetected,
  handleDomSnapshot,
  handleExecuteTool,
  handleGetTools,
  handleGetConfig,
  createServiceWorkerMessageRouter,
  type ServiceWorkerState,
} from '../index.js';

// ─── Chrome API mocks ─────────────────────────────────

function createMockChrome() {
  const listeners: Array<(message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean | void> = [];

  return {
    runtime: {
      onMessage: {
        addListener: vi.fn((cb: (message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean | void) => {
          listeners.push(cb);
        }),
      },
      sendMessage: vi.fn().mockResolvedValue(undefined),
      _listeners: listeners,
    },
    storage: {
      session: {
        set: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue({}),
      },
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
    sidePanel: {
      open: vi.fn(),
    },
  };
}

function createMockSender(tabId = 1) {
  return {
    tab: { id: tabId, url: 'https://example.com' },
    id: 'extension-id',
  };
}

// ─── Tests ─────────────────────────────────────────────

describe('Service Worker', () => {
  let mockChrome: ReturnType<typeof createMockChrome>;
  let state: ServiceWorkerState;

  beforeEach(() => {
    mockChrome = createMockChrome();
    state = {
      tabContexts: new Map(),
      toolDefinitions: [
        {
          name: 'create_todo',
          description: 'Create a todo item',
          inputSchema: {
            type: 'object',
            properties: { title: { type: 'string', description: 'Todo title' } },
            required: ['title'],
          },
          bridge: {
            page: 'todo_list',
            steps: [],
          },
        },
      ],
      config: {
        bridgeApiUrl: 'http://localhost:3000',
      },
    };
  });

  describe('handlePageDetected', () => {
    it('stores page context for the tab', () => {
      const payload = { url: 'https://example.com/todos', title: 'Todos', timestamp: Date.now() };
      const sender = createMockSender(42);

      handlePageDetected(payload, sender, state, mockChrome.storage as unknown as typeof chrome.storage);

      const ctx = state.tabContexts.get(42);
      expect(ctx).toBeDefined();
      expect(ctx!.url).toBe('https://example.com/todos');
      expect(ctx!.title).toBe('Todos');
    });

    it('persists to session storage', () => {
      const payload = { url: 'https://example.com/todos', title: 'Todos', timestamp: Date.now() };
      const sender = createMockSender(42);

      handlePageDetected(payload, sender, state, mockChrome.storage as unknown as typeof chrome.storage);

      expect(mockChrome.storage.session.set).toHaveBeenCalledWith(
        expect.objectContaining({ 'tab_42': expect.objectContaining({ url: 'https://example.com/todos' }) }),
      );
    });

    it('handles missing tab id gracefully', () => {
      const payload = { url: 'https://example.com', title: 'Test', timestamp: Date.now() };
      const sender = { tab: { id: undefined, url: '' }, id: 'ext' };

      // Should not throw
      handlePageDetected(payload, sender as unknown as chrome.runtime.MessageSender, state, mockChrome.storage as unknown as typeof chrome.storage);
      expect(state.tabContexts.size).toBe(0);
    });
  });

  describe('handleDomSnapshot', () => {
    it('stores snapshot in tab context', () => {
      const sender = createMockSender(10);
      state.tabContexts.set(10, { url: 'https://example.com', title: 'Test', timestamp: Date.now() });

      const snapshot = {
        html: '<html><body>Hello</body></html>',
        interactiveElements: [{ id: 'btn1', tag: 'button', text: 'Click me' }],
        ariaMap: {},
      };

      handleDomSnapshot(snapshot, sender, state);

      const ctx = state.tabContexts.get(10);
      expect(ctx!.snapshot).toEqual(snapshot);
    });

    it('creates tab context if it does not exist', () => {
      const sender = createMockSender(99);
      const snapshot = {
        html: '<html></html>',
        interactiveElements: [],
        ariaMap: {},
      };

      handleDomSnapshot(snapshot, sender, state);

      const ctx = state.tabContexts.get(99);
      expect(ctx).toBeDefined();
      expect(ctx!.snapshot).toEqual(snapshot);
    });
  });

  describe('handleExecuteTool', () => {
    it('returns ok result on successful API call', async () => {
      const payload = { toolName: 'create_todo', inputs: { title: 'Buy milk' } };
      const sendResponse = vi.fn();

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, outputs: { id: '123' } }),
      });

      await handleExecuteTool(payload, createMockSender(), sendResponse, state, mockFetch);

      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        data: { success: true, outputs: { id: '123' } },
      });
    });

    it('returns error on API failure', async () => {
      const payload = { toolName: 'create_todo', inputs: { title: 'Buy milk' } };
      const sendResponse = vi.fn();

      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

      await handleExecuteTool(payload, createMockSender(), sendResponse, state, mockFetch);

      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        error: 'Network error',
      });
    });

    it('returns error when API returns non-ok response', async () => {
      const payload = { toolName: 'create_todo', inputs: {} };
      const sendResponse = vi.fn();

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ error: 'Server error' }),
      });

      await handleExecuteTool(payload, createMockSender(), sendResponse, state, mockFetch);

      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        error: expect.stringContaining('500'),
      });
    });
  });

  describe('handleGetTools', () => {
    it('returns all tool definitions', () => {
      const sendResponse = vi.fn();

      handleGetTools(sendResponse, state);

      expect(sendResponse).toHaveBeenCalledWith({
        tools: [
          expect.objectContaining({
            name: 'create_todo',
            description: 'Create a todo item',
          }),
        ],
      });
    });

    it('returns empty array when no tools are loaded', () => {
      state.toolDefinitions = [];
      const sendResponse = vi.fn();

      handleGetTools(sendResponse, state);

      expect(sendResponse).toHaveBeenCalledWith({ tools: [] });
    });
  });

  describe('handleGetConfig', () => {
    it('returns current config', () => {
      const sendResponse = vi.fn();

      handleGetConfig(sendResponse, state);

      expect(sendResponse).toHaveBeenCalledWith({
        config: { bridgeApiUrl: 'http://localhost:3000' },
      });
    });
  });

  describe('createServiceWorkerMessageRouter', () => {
    it('returns a message listener function', () => {
      const router = createServiceWorkerMessageRouter(state, mockChrome as unknown as typeof chrome);
      expect(typeof router).toBe('function');
    });

    it('routes PAGE_DETECTED messages', () => {
      const router = createServiceWorkerMessageRouter(state, mockChrome as unknown as typeof chrome);
      const sender = createMockSender(1);
      const sendResponse = vi.fn();

      router({ type: 'PAGE_DETECTED', payload: { url: 'https://test.com', title: 'Test', timestamp: Date.now() } }, sender, sendResponse);

      expect(state.tabContexts.get(1)).toBeDefined();
    });

    it('routes GET_TOOLS messages', () => {
      const router = createServiceWorkerMessageRouter(state, mockChrome as unknown as typeof chrome);
      const sender = createMockSender(1);
      const sendResponse = vi.fn();

      router({ type: 'GET_TOOLS', payload: {} }, sender, sendResponse);

      expect(sendResponse).toHaveBeenCalledWith({ tools: expect.any(Array) });
    });

    it('routes EXECUTE_TOOL messages and returns true for async response', () => {
      const router = createServiceWorkerMessageRouter(state, mockChrome as unknown as typeof chrome);
      const sender = createMockSender(1);
      const sendResponse = vi.fn();

      const result = router(
        { type: 'EXECUTE_TOOL', payload: { toolName: 'create_todo', inputs: { title: 'test' } } },
        sender,
        sendResponse,
      );

      // Should return true to keep sendResponse channel open for async
      expect(result).toBe(true);
    });

    it('routes GET_CONFIG messages', () => {
      const router = createServiceWorkerMessageRouter(state, mockChrome as unknown as typeof chrome);
      const sender = createMockSender(1);
      const sendResponse = vi.fn();

      router({ type: 'GET_CONFIG', payload: {} }, sender, sendResponse);

      expect(sendResponse).toHaveBeenCalledWith({
        config: expect.objectContaining({ bridgeApiUrl: 'http://localhost:3000' }),
      });
    });

    it('ignores unknown message types', () => {
      const router = createServiceWorkerMessageRouter(state, mockChrome as unknown as typeof chrome);
      const sender = createMockSender(1);
      const sendResponse = vi.fn();

      router({ type: 'UNKNOWN_TYPE', payload: {} }, sender, sendResponse);
      expect(sendResponse).not.toHaveBeenCalled();
    });
  });
});
