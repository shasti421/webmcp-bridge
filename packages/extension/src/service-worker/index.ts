/**
 * Extension Service Worker — background orchestrator.
 *
 * Responsibilities:
 * - Listen for content script messages (page detected, DOM snapshot)
 * - Manage tab context state
 * - Route tool execution to the bridge API
 * - Handle side panel communication (capture mode, execute mode)
 * - Provide tool definitions and config to consumers
 *
 * Implementation notes:
 * - NO DOM access — all DOM operations go through content script messaging
 * - Use chrome.runtime.onMessage for content script <-> service worker
 * - Use chrome.sidePanel API for panel management
 */

import type { ToolDefinition } from '@webmcp-bridge/core';

// ─── Types ──────────────────────────────────────────────

export interface DomSnapshot {
  html: string;
  interactiveElements: Array<{
    id: string;
    tag: string;
    ariaLabel?: string;
    text?: string;
    xPath?: string;
  }>;
  ariaMap: Record<string, unknown>;
}

export interface TabContext {
  url: string;
  title: string;
  timestamp: number;
  snapshot?: DomSnapshot;
}

export interface ServiceWorkerConfig {
  bridgeApiUrl: string;
}

export interface ServiceWorkerState {
  tabContexts: Map<number, TabContext>;
  toolDefinitions: ToolDefinition[];
  config: ServiceWorkerConfig;
}

export interface ExtensionMessage {
  type: string;
  payload: Record<string, unknown>;
}

// ─── Message payload types ──────────────────────────────

type MessageType = 'PAGE_DETECTED' | 'DOM_SNAPSHOT' | 'EXECUTE_TOOL' | 'GET_TOOLS' | 'GET_CONFIG';

interface PageDetectedPayload {
  url: string;
  title: string;
  timestamp: number;
}

interface ExecuteToolPayload {
  toolName: string;
  inputs: Record<string, unknown>;
}

// ─── Handlers ───────────────────────────────────────────

export function handlePageDetected(
  payload: PageDetectedPayload,
  sender: chrome.runtime.MessageSender,
  state: ServiceWorkerState,
  storage: typeof chrome.storage,
): void {
  const tabId = sender.tab?.id;
  if (tabId === undefined || tabId === null) {
    return;
  }

  const context: TabContext = {
    url: payload.url,
    title: payload.title,
    timestamp: payload.timestamp ?? Date.now(),
  };

  state.tabContexts.set(tabId, context);

  // Persist to session storage
  storage.session.set({
    [`tab_${tabId}`]: { url: payload.url, title: payload.title, timestamp: context.timestamp },
  });
}

export function handleDomSnapshot(
  snapshot: DomSnapshot,
  sender: chrome.runtime.MessageSender,
  state: ServiceWorkerState,
): void {
  const tabId = sender.tab?.id;
  if (tabId === undefined || tabId === null) {
    return;
  }

  let context = state.tabContexts.get(tabId);
  if (!context) {
    context = {
      url: sender.tab?.url ?? '',
      title: '',
      timestamp: Date.now(),
    };
    state.tabContexts.set(tabId, context);
  }

  context.snapshot = snapshot;
}

export async function handleExecuteTool(
  payload: ExecuteToolPayload,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
  state: ServiceWorkerState,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<void> {
  const { toolName, inputs } = payload;

  try {
    const response = await fetchFn(`${state.config.bridgeApiUrl}/tools/${toolName}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inputs),
    });

    if (!response.ok) {
      sendResponse({
        ok: false,
        error: `API error: ${response.status} ${response.statusText}`,
      });
      return;
    }

    const data: unknown = await response.json();
    sendResponse({ ok: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    sendResponse({ ok: false, error: message });
  }
}

export function handleGetTools(
  sendResponse: (response: unknown) => void,
  state: ServiceWorkerState,
): void {
  sendResponse({
    tools: state.toolDefinitions.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  });
}

export function handleGetConfig(
  sendResponse: (response: unknown) => void,
  state: ServiceWorkerState,
): void {
  sendResponse({ config: state.config });
}

// ─── Message Router ─────────────────────────────────────

export function createServiceWorkerMessageRouter(
  state: ServiceWorkerState,
  chromeApi: typeof chrome,
): (message: ExtensionMessage, sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void) => boolean | void {
  return (
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (r: unknown) => void,
  ): boolean | void => {
    const messageType = message.type as MessageType;

    switch (messageType) {
      case 'PAGE_DETECTED': {
        const detected = message.payload as unknown as PageDetectedPayload;
        handlePageDetected(detected, sender, state, chromeApi.storage);
        // Also notify side panel
        chromeApi.runtime.sendMessage({
          type: 'PAGE_UPDATED',
          payload: { url: detected.url, title: detected.title },
        }).catch(() => {
          // Side panel might not be open — ignore
        });
        break;
      }

      case 'DOM_SNAPSHOT':
        handleDomSnapshot(message.payload as unknown as DomSnapshot, sender, state);
        break;

      case 'EXECUTE_TOOL':
        void handleExecuteTool(
          message.payload as unknown as ExecuteToolPayload,
          sender,
          sendResponse,
          state,
        );
        return true; // Keep sendResponse channel open for async

      case 'GET_TOOLS':
        handleGetTools(sendResponse, state);
        break;

      case 'GET_CONFIG':
        handleGetConfig(sendResponse, state);
        break;

      default:
        // Unknown message type — ignore
        break;
    }
  };
}

// ─── Bootstrap (runs when loaded as service worker) ─────

export function initServiceWorker(chromeApi: typeof chrome): ServiceWorkerState {
  const state: ServiceWorkerState = {
    tabContexts: new Map(),
    toolDefinitions: [],
    config: {
      bridgeApiUrl: 'http://localhost:3000',
    },
  };

  const router = createServiceWorkerMessageRouter(state, chromeApi);
  chromeApi.runtime.onMessage.addListener(router);

  // Load config from local storage
  chromeApi.storage.local.get(['bridge_api_url']).then((result: Record<string, unknown>) => {
    if (typeof result['bridge_api_url'] === 'string') {
      state.config.bridgeApiUrl = result['bridge_api_url'];
    }
  }).catch(() => {
    // Use default config
  });

  return state;
}
