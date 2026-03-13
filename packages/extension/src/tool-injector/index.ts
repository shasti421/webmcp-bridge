/**
 * Tool Injector — navigator.modelContext polyfill.
 *
 * Injects a polyfill for the W3C WebMCP API (navigator.modelContext)
 * that maps to bridge tool definitions. When a native WebMCP agent
 * calls navigator.modelContext.tools, it gets bridge-generated tools.
 *
 * Also handles graceful handoff: if the page already has native
 * WebMCP tools, bridge defers to native for matching tool names.
 */

// ─── Types ──────────────────────────────────────────────

export interface ModelContextTool {
  name: string;
  description: string;
  inputSchema: { type: string; properties?: Record<string, unknown>; required?: string[] };
}

export interface ModelContext {
  tools: ModelContextTool[];
  execute: (toolName: string, inputs: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolInjectorDeps {
  chrome: typeof chrome;
  navigator: Navigator;
  document: Document;
}

interface ExecuteResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}

// ─── Model Context creation ────────────────────────────

export function createModelContext(
  tools: ModelContextTool[],
  chromeApi: typeof chrome,
): ModelContext {
  return {
    tools,
    execute: (toolName: string, inputs: Record<string, unknown>): Promise<unknown> => {
      return new Promise((resolve, reject) => {
        chromeApi.runtime.sendMessage(
          {
            type: 'EXECUTE_TOOL',
            payload: { toolName, inputs },
          },
          (response: ExecuteResponse) => {
            if (response.ok) {
              resolve(response.data);
            } else {
              reject(new Error(response.error ?? 'Unknown error'));
            }
          },
        );
      });
    },
  };
}

// ─── Tool injection ────────────────────────────────────

export function injectToolContext(deps: ToolInjectorDeps): void {
  deps.chrome.runtime.sendMessage(
    { type: 'GET_TOOLS' },
    (response: { tools: ModelContextTool[] }) => {
      const bridgeTools = response.tools ?? [];

      // Check for existing native modelContext
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existing = (deps.navigator as any).modelContext as ModelContext | undefined;

      if (existing && existing.tools) {
        // Merge: native tools take priority, bridge fills in the rest
        const nativeNames = new Set(existing.tools.map((t) => t.name));
        const newTools = bridgeTools.filter((t) => !nativeNames.has(t.name));
        const mergedTools = [...existing.tools, ...newTools];

        const mergedContext = createModelContext(mergedTools, deps.chrome);

        Object.defineProperty(deps.navigator, 'modelContext', {
          value: mergedContext,
          writable: true,
          configurable: true,
        });
      } else {
        // No existing context — inject bridge tools
        const context = createModelContext(bridgeTools, deps.chrome);

        Object.defineProperty(deps.navigator, 'modelContext', {
          value: context,
          writable: true,
          configurable: true,
        });
      }
    },
  );
}

// ─── Auto-inject on page load ──────────────────────────

export function setupToolInjection(deps: ToolInjectorDeps): void {
  if (deps.document.readyState === 'loading') {
    deps.document.addEventListener('DOMContentLoaded', () => {
      injectToolContext(deps);
    });
  } else {
    injectToolContext(deps);
  }
}
