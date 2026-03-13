# Chrome Extension Architecture Specification

## Purpose

The WebMCP Bridge Chrome extension enables in-browser tool discovery, UI interaction, and execution. It detects page navigation, captures DOM state, communicates with content scripts, and provides a React-based side panel UI for tool execution.

**Key components:**
- Service Worker: background message dispatcher
- Content Script: DOM observer, event listener
- Side Panel: React UI with capture/execute modes
- Tool Injector: navigator.modelContext polyfill
- NLP Router: LLM-powered tool selection

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│ Chrome Extension (WebMCP Bridge)                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌────────────────┐      ┌─────────────┐              │
│  │ Service Worker │◄─────┤   Storage   │              │
│  │  (background)  │      │ (bridge cfg)│              │
│  └────────┬───────┘      └─────────────┘              │
│           │                                            │
│           ├──message──┬──────────────┬────────────┐   │
│           │           │              │            │   │
│  ┌────────▼──────┐    │     ┌────────▼──────┐    │   │
│  │ Content Script│    │     │  Side Panel   │    │   │
│  │  (per tab)    │    │     │  (React UI)   │    │   │
│  │               │    │     │               │    │   │
│  │ - MutObserver │    │     │ - Capture Tab │    │   │
│  │ - Page Detect │    │     │ - Execute Tab │    │   │
│  │ - Tool Call   │    │     │ - Tool List   │    │   │
│  └───┬───────────┘    │     └───────────────┘    │   │
│      │                │                          │   │
│  ┌───▼────────────────▼──────┐                  │   │
│  │ NLP Router                 │                  │   │
│  │ (parse user intent, call   │                  │   │
│  │  LLM to select tool)       │                  │   │
│  └────────────────────────────┘                  │   │
│                                                 │   │
│  ┌─────────────────────────────────────────┐   │   │
│  │ Tool Injector                           │   │   │
│  │ window.navigator.modelContext = {       │   │   │
│  │   tools: [...],                        │   │   │
│  │   execute: (toolName, inputs) => ...  │   │   │
│  │ }                                       │   │   │
│  └─────────────────────────────────────────┘   │   │
│                                                 │   │
└─────────────────────────────────────────────────────┘
     │
     └──── communicate with bridge backend API
```

## Service Worker

**File:** `packages/extension/src/service-worker/index.ts`

### Message Handlers

```typescript
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'PAGE_DETECTED':
      handlePageDetected(request.payload, sender);
      break;

    case 'DOM_SNAPSHOT':
      handleDomSnapshot(request.payload, sender);
      break;

    case 'EXECUTE_TOOL':
      handleExecuteTool(request.payload, sender, sendResponse);
      break;

    case 'GET_TOOLS':
      handleGetTools(request.payload, sender, sendResponse);
      break;

    case 'GET_CONFIG':
      handleGetConfig(request.payload, sender, sendResponse);
      break;
  }
});

// Handlers
function handlePageDetected(payload, sender) {
  const { url, title } = payload;
  const tabId = sender.tab.id;

  // Store page context
  chrome.storage.session.set({
    [`tab_${tabId}`]: { url, title, timestamp: Date.now() }
  });

  // Notify side panel
  chrome.runtime.sendMessage({
    type: 'PAGE_UPDATED',
    payload: { url, title }
  });
}

async function handleExecuteTool(payload, sender, sendResponse) {
  const { toolName, inputs } = payload;

  try {
    // Call backend bridge API
    const result = await fetch(`${BRIDGE_API}/tools/${toolName}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inputs)
    });

    const json = await result.json();
    sendResponse({ ok: true, data: json });
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }
}
```

## Content Script

**File:** `packages/extension/src/content-script/index.ts`

### Page Detection

```typescript
// Detect page load/navigation
function detectPageNavigation() {
  // Track URL changes via popstate/pushState
  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;

  window.history.pushState = function(...args) {
    originalPushState.apply(this, args);
    notifyPageChange();
  };

  window.history.replaceState = function(...args) {
    originalReplaceState.apply(this, args);
    notifyPageChange();
  };

  // Track traditional navigation
  window.addEventListener('load', notifyPageChange);
  window.addEventListener('popstate', notifyPageChange);
}

function notifyPageChange() {
  chrome.runtime.sendMessage({
    type: 'PAGE_DETECTED',
    payload: {
      url: window.location.href,
      title: document.title,
      timestamp: Date.now()
    }
  });
}
```

### DOM Observation

```typescript
// Debounced DOM observer
let domSnapshotTimeout: NodeJS.Timeout | null = null;

const observer = new MutationObserver(() => {
  if (domSnapshotTimeout) clearTimeout(domSnapshotTimeout);

  domSnapshotTimeout = setTimeout(() => {
    const snapshot = captureDomSnapshot();
    chrome.runtime.sendMessage({
      type: 'DOM_SNAPSHOT',
      payload: snapshot
    });
  }, 500);  // Debounce 500ms
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  characterData: false,
  attributeFilter: ['class', 'id', 'data-*']
});

function captureDomSnapshot() {
  return {
    html: document.documentElement.outerHTML.substring(0, 50000),  // Limit size
    interactiveElements: captureInteractiveElements(),
    ariaMap: buildAriaMap()
  };
}

function captureInteractiveElements() {
  const elements = document.querySelectorAll('button, input, select, a, [role]');
  return Array.from(elements).map(el => ({
    id: generateElementId(el),
    tag: el.tagName.toLowerCase(),
    ariaLabel: el.getAttribute('aria-label'),
    text: el.textContent?.substring(0, 100),
    xPath: generateXPath(el)
  })).slice(0, 500);
}
```

### Tool Injection

```typescript
// Inject navigator.modelContext global
function injectToolContext() {
  // Fetch available tools from service worker
  chrome.runtime.sendMessage({ type: 'GET_TOOLS' }, (response) => {
    const tools = response.tools || [];

    // Inject into window
    window.navigator.modelContext = {
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema
      })),

      execute: async (toolName, inputs) => {
        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { type: 'EXECUTE_TOOL', payload: { toolName, inputs } },
            (response) => {
              if (response.ok) {
                resolve(response.data);
              } else {
                reject(new Error(response.error));
              }
            }
          );
        });
      }
    };
  });
}

// Call on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectToolContext);
} else {
  injectToolContext();
}
```

## Side Panel UI

**File:** `packages/extension/src/side-panel/App.tsx`

### React Component Structure

```typescript
interface SidePanelState {
  mode: 'capture' | 'execute';
  tools: ToolDefinition[];
  currentPageUrl: string;
  selectedTool: ToolDefinition | null;
  toolInputs: Record<string, unknown>;
  executionResult: ExecutionResult | null;
  loading: boolean;
  error: string | null;
}

function App() {
  const [state, dispatch] = useReducer(sidePanelReducer, initialState);

  useEffect(() => {
    // Load tools
    chrome.runtime.sendMessage({ type: 'GET_TOOLS' }, (response) => {
      dispatch({ type: 'SET_TOOLS', payload: response.tools });
    });

    // Monitor page changes
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'PAGE_UPDATED') {
        dispatch({ type: 'UPDATE_PAGE', payload: message.payload });
      }
    });
  }, []);

  return (
    <div className="side-panel">
      <header>
        <h1>WebMCP Bridge</h1>
        <nav>
          <button onClick={() => dispatch({ type: 'SWITCH_MODE', mode: 'capture' })}>
            Capture
          </button>
          <button onClick={() => dispatch({ type: 'SWITCH_MODE', mode: 'execute' })}>
            Execute
          </button>
        </nav>
      </header>

      <main>
        {state.mode === 'capture' ? (
          <CapturePanel state={state} dispatch={dispatch} />
        ) : (
          <ExecutePanel state={state} dispatch={dispatch} />
        )}
      </main>

      {state.error && <ErrorBanner error={state.error} />}
    </div>
  );
}
```

### Capture Panel

```typescript
function CapturePanel({ state, dispatch }) {
  const [capturing, setCapturing] = useState(false);

  const handleCapture = async () => {
    setCapturing(true);

    // Tell content script to send DOM snapshot
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_DOM' }, (response) => {
      if (response.ok) {
        // Process snapshot, suggest tools
        const suggestedTools = suggestTools(response.snapshot, state.tools);
        dispatch({ type: 'SET_SUGGESTED_TOOLS', payload: suggestedTools });
      }
      setCapturing(false);
    });
  };

  return (
    <div className="capture-panel">
      <button onClick={handleCapture} disabled={capturing}>
        {capturing ? 'Capturing...' : 'Capture Page'}
      </button>

      <div className="suggested-tools">
        {state.suggestedTools?.map(tool => (
          <div key={tool.name} className="tool-card">
            <h3>{tool.name}</h3>
            <p>{tool.description}</p>
            <button onClick={() => dispatch({ type: 'SELECT_TOOL', payload: tool })}>
              Use This Tool
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Execute Panel

```typescript
function ExecutePanel({ state, dispatch }) {
  const handleToolSelect = (tool) => {
    dispatch({ type: 'SELECT_TOOL', payload: tool });
  };

  const handleInputChange = (field, value) => {
    dispatch({
      type: 'SET_INPUT',
      payload: { field, value }
    });
  };

  const handleExecute = async () => {
    dispatch({ type: 'SET_LOADING', payload: true });

    try {
      const result = await chrome.runtime.sendMessage({
        type: 'EXECUTE_TOOL',
        payload: {
          toolName: state.selectedTool.name,
          inputs: state.toolInputs
        }
      });

      dispatch({ type: 'SET_RESULT', payload: result });
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: error.message });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  return (
    <div className="execute-panel">
      <select onChange={(e) => handleToolSelect(state.tools.find(t => t.name === e.target.value))}>
        <option>Select a tool...</option>
        {state.tools.map(tool => (
          <option key={tool.name} value={tool.name}>
            {tool.name}
          </option>
        ))}
      </select>

      {state.selectedTool && (
        <form onSubmit={handleExecute}>
          {Object.entries(state.selectedTool.inputSchema.properties || {}).map(([field, schema]) => (
            <div key={field} className="input-field">
              <label>{field}</label>
              <input
                type={mapSchemaTypeToInput(schema.type)}
                value={state.toolInputs[field] || ''}
                onChange={(e) => handleInputChange(field, e.target.value)}
                required={state.selectedTool.inputSchema.required?.includes(field)}
              />
              {schema.description && <small>{schema.description}</small>}
            </div>
          ))}

          <button type="submit" disabled={state.loading}>
            {state.loading ? 'Executing...' : 'Execute'}
          </button>
        </form>
      )}

      {state.executionResult && (
        <div className="result">
          <h3>Result</h3>
          <pre>{JSON.stringify(state.executionResult, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
```

## NLP Router

**File:** `packages/extension/src/nlp-router/index.ts`

### Tool Selection via LLM

```typescript
async function routeUserCommand(
  userCommand: string,
  tools: ToolDefinition[]
): Promise<{ toolName: string; inputs: Record<string, unknown> }> {
  // Build prompt for LLM
  const toolSummary = tools.map(t => `- ${t.name}: ${t.description}`).join('\n');

  const prompt = `
You are a web automation assistant. The user has asked:

"${userCommand}"

Available tools:
${toolSummary}

Analyze the user's request and determine which tool to use. Respond with:
{
  "toolName": "exact_tool_name",
  "inputs": {
    "param1": "value1",
    ...
  }
}

Only respond with valid JSON.
`;

  // Call LLM (via bridge backend)
  const response = await fetch(`${BRIDGE_API}/nlp/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, tools })
  });

  return await response.json();
}
```

## Storage

Extension uses Chrome Storage API:

```typescript
// Session storage for current tab state
chrome.storage.session.set({
  'tab_123': { url, title, tools, lastUpdated }
});

// Local storage for configuration
chrome.storage.local.set({
  'bridge_api_url': 'http://localhost:3000',
  'auto_capture': true
});

// Sync storage for user preferences
chrome.storage.sync.set({
  'preferred_model': 'gpt-4'
});
```

## Manifest

**File:** `packages/extension/manifest.json`

```json
{
  "manifest_version": 3,
  "name": "WebMCP Bridge",
  "version": "1.0.0",
  "permissions": [
    "activeTab",
    "scripting",
    "tabs",
    "storage",
    "webRequest",
    "scripting",
    "sidePanel"
  ],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "src/service-worker/index.ts"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["src/content-script/index.ts"],
      "run_at": "document_start"
    }
  ],
  "side_panel": {
    "default_path": "src/side-panel/index.html"
  },
  "action": {
    "default_popup": "src/popup/index.html",
    "default_title": "WebMCP Bridge"
  }
}
```

## Communication Protocol

### Message Types

| Type | Sender | Receiver | Payload |
|------|--------|----------|---------|
| `PAGE_DETECTED` | Content Script | Service Worker | `{ url, title, timestamp }` |
| `DOM_SNAPSHOT` | Content Script | Service Worker | `{ html, elements, ariaMap }` |
| `EXECUTE_TOOL` | Side Panel | Service Worker | `{ toolName, inputs }` |
| `GET_TOOLS` | Side Panel | Service Worker | — |
| `PAGE_UPDATED` | Service Worker | Side Panel | `{ url, title }` |
| `TOOL_RESULT` | Service Worker | Content Script | `{ success, result, error }` |

## Test Scenarios

### 1. Page detection on navigation

**Setup:** Extension installed, user navigates to new URL

**Expected:** Content script detects navigation, sends PAGE_DETECTED message, service worker receives it

### 2. DOM snapshot on mutation

**Setup:** Page with MutationObserver enabled

**Test:** Add element to DOM

**Expected:** Mutation observed, debounce timer set, DOM_SNAPSHOT sent after 500ms

### 3. Tool execution from side panel

**Setup:** Side panel with tool selected and inputs filled

**Test:** Click Execute button

**Expected:** Message sent to service worker, API call made, result returned to side panel

### 4. Tool injection into window

**Setup:** Content script loaded on page

**Test:** Check `window.navigator.modelContext`

**Expected:** Object exists, contains tools array, execute function callable

### 5. NLP routing of user command

**Setup:** User types command in side panel

**Test:** Submit command

**Expected:** Router calls LLM, receives tool name and inputs, tool executed

### 6. Multi-tab state isolation

**Setup:** Two tabs with extension open

**Test:** Execute different tools in each tab

**Expected:** Tool inputs and results isolated per tab

### 7. Error handling in tool execution

**Setup:** Tool execution fails in backend

**Test:** Execute tool

**Expected:** Error message displayed in side panel, user notified
