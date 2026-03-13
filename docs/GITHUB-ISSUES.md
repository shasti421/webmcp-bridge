# GitHub Issues — WebMCP Bridge Implementation Plan

> This document defines every issue needed to implement the full platform.
> Issues are organized into phases with explicit dependencies.
> Each issue maps to a feature branch and a single PR.

---

## Phase 1: Foundation (Issues #1–#12)
*Core types, semantic store, and the execution pipeline. No browser interaction yet.*

### Issue #1 — Core types and Result monad
**Package:** core | **Branch:** `feat/1-core-types`
**Description:** Finalize and export all types from `packages/core/src/types/`. Implement the `Result<T,E>` monad functions (`ok`, `err`, `isOk`, `isErr`, `unwrap`, `mapResult`). Export `BridgeError`, `BridgeErrorCode`, `createBridgeError`. Export all semantic model types, config types, and BridgeDriver interface.
**Acceptance:**
- [ ] All type files compile with strict mode
- [ ] Result functions have 100% test coverage
- [ ] `createBridgeError` generates valid errors with timestamps
- [ ] `npm run typecheck` passes
**Spec:** types are defined in scaffold files; Result spec in `docs/specs/template-renderer-spec.md` (Result section)
**Dependencies:** None

### Issue #2 — YAML Schema Validator
**Package:** core | **Branch:** `feat/2-yaml-schema-validator`
**Description:** Implement `YamlSchemaValidator` using Ajv. Define JSON Schemas for app, page, tool, and workflow YAML. Validate parsed objects, return structured `ValidationError[]`.
**Acceptance:**
- [ ] Valid YAML passes validation
- [ ] Invalid YAML returns errors with field path and message
- [ ] Page schema enforces min 2 selectors per field
- [ ] All required fields enforced
- [ ] 80%+ coverage
**Spec:** `docs/specs/yaml-schema-spec.md`
**Dependencies:** #1

### Issue #3 — Template Renderer
**Package:** core | **Branch:** `feat/3-template-renderer`
**Description:** Implement `TemplateRenderer` — `{{variable}}` substitution engine. Support simple variables, nested paths (`{{result.field}}`), array access (`{{items[0]}}`), `renderObject()` for deep rendering, and `evaluateCondition()` for step conditions.
**Acceptance:**
- [ ] Simple, nested, array templates render correctly
- [ ] renderObject handles nested objects recursively
- [ ] evaluateCondition returns true/false for truthy/falsy values
- [ ] Missing variables render as empty string (not crash)
- [ ] 80%+ coverage
**Spec:** `docs/specs/template-renderer-spec.md`
**Dependencies:** #1

### Issue #4 — Semantic Store: YAML Loading
**Package:** core | **Branch:** `feat/4-semantic-store-loading`
**Description:** Implement `SemanticStore.loadFromDirectory()`. Scan directory for `app.yaml`, `pages/*.yaml`, `tools/*.yaml`, `workflows/*.yaml`. Parse with js-yaml, validate with YamlSchemaValidator, index into Maps.
**Acceptance:**
- [ ] Loads demo-todo-app semantic directory successfully
- [ ] Invalid YAML returns YAML_PARSE_ERROR
- [ ] Invalid schema returns SCHEMA_VALIDATION_ERROR
- [ ] Index built: getApp(), getPage(), getTool(), getWorkflow() all work
- [ ] listApps(), listPages() return correct results
- [ ] 80%+ coverage
**Spec:** `docs/specs/semantic-store-spec.md`
**Dependencies:** #1, #2

### Issue #5 — Semantic Store: Resolution and Matching
**Package:** core | **Branch:** `feat/5-semantic-store-resolution`
**Description:** Implement `resolveFieldRef()`, `resolveOutputRef()`, `matchPage()`, `getToolsForPage()`. Field refs are dotted: `"page_id.fields.field_id"`. URL matching converts `url_pattern` with `{param}` placeholders to regex.
**Acceptance:**
- [ ] resolveFieldRef("todo_list.fields.new_todo_input") returns FieldDefinition
- [ ] resolveOutputRef("todo_list.outputs.todo_count") returns OutputDefinition
- [ ] matchPage("http://localhost:3000/") returns todo_list page
- [ ] matchPage with params: "/items/{id}" matches "/items/123"
- [ ] getToolsForPage("todo_list") returns tools referencing that page
- [ ] 80%+ coverage
**Spec:** `docs/specs/semantic-store-spec.md`
**Dependencies:** #4

### Issue #6 — Mock Driver
**Package:** core | **Branch:** `feat/6-mock-driver`
**Description:** Implement `createMockDriver()` in `drivers/mock-driver.ts`. Every BridgeDriver method is a vitest spy (vi.fn()). Support configurable responses via chained API: `mockDriver.findElement = vi.fn().mockResolvedValue(element)`.
**Acceptance:**
- [ ] Returns a full BridgeDriver with all methods as mocks
- [ ] All methods return rejected promises by default (must be configured)
- [ ] Works in all unit test suites across core
- [ ] Type-safe — TypeScript catches wrong mock configurations
**Spec:** `docs/specs/testing-spec.md`
**Dependencies:** #1

### Issue #7 — Selector Resolver
**Package:** core | **Branch:** `feat/7-selector-resolver`
**Description:** Implement `SelectorResolver.resolve()`, `resolveText()`, `resolvePattern()`. Try each strategy in SelectorChain order via BridgeDriver. Return first success with strategy metadata.
**Acceptance:**
- [ ] Returns first successful element with strategyIndex
- [ ] Falls back through strategies on failure
- [ ] Returns SELECTOR_NOT_FOUND with all attempted strategies on total failure
- [ ] resolveText and resolvePattern work end-to-end
- [ ] 80%+ coverage using MockDriver
**Spec:** `docs/specs/selector-resolver-spec.md`
**Dependencies:** #1, #6

### Issue #8 — Result Capturer
**Package:** core | **Branch:** `feat/8-result-capturer`
**Description:** Implement `ResultCapturer.capture()` and `captureAll()`. Try capture strategies in order (text_content, pattern_match, attribute, table). Handle transient outputs with polling. Handle retry with backoff.
**Acceptance:**
- [ ] text_content capture via SelectorResolver
- [ ] pattern_match with regex group extraction
- [ ] attribute capture via driver.evaluate()
- [ ] table capture returns string array
- [ ] Transient polling with configurable timeout
- [ ] Retry with backoff
- [ ] captureAll collects all outputs into Record
- [ ] 80%+ coverage
**Spec:** `docs/specs/result-capturer-spec.md`
**Dependencies:** #7

### Issue #9 — Healing Pipeline
**Package:** core | **Branch:** `feat/9-healing-pipeline`
**Description:** Implement the 4-stage healing pipeline: fuzzy_match, js_anchor_walk, ai_dom_analysis, human_in_loop. Each stage has a timeout. On success, return HealResult. On total failure, return HEALING_EXHAUSTED.
**Acceptance:**
- [ ] Fuzzy match relaxes CSS selectors (remove nth-child, etc.)
- [ ] JS anchor walk finds by nearby labels
- [ ] AI healing calls callback with DOM + screenshot
- [ ] Human-in-loop calls callback (extension only)
- [ ] Each stage respects its timeout
- [ ] Stages are skipped based on config (aiHealing, humanInLoop)
- [ ] 80%+ coverage
**Spec:** `docs/specs/healing-pipeline-spec.md`
**Dependencies:** #7

### Issue #10 — Execution Engine: Tool Execution
**Package:** core | **Branch:** `feat/10-execution-engine-tools`
**Description:** Implement `ExecutionEngine.executeTool()`. Load tool from store, validate inputs, iterate steps. Handle navigate, interact, capture, wait, evaluate_js steps. Manage variable context with TemplateRenderer. Invoke healing on selector failure.
**Acceptance:**
- [ ] Executes demo-todo-app add_todo tool with mock driver
- [ ] Navigate step renders URL template and calls driver.goto()
- [ ] Interact step resolves field selector and calls appropriate driver method
- [ ] Capture step uses ResultCapturer and stores result in context
- [ ] Wait step pauses execution
- [ ] Condition evaluation skips steps when falsy
- [ ] Returns ToolExecutionResult with outputs, success, duration
- [ ] 80%+ coverage
**Spec:** `docs/specs/execution-engine-spec.md`
**Dependencies:** #3, #5, #7, #8, #9

### Issue #11 — Execution Engine: Workflow Execution
**Package:** core | **Branch:** `feat/11-execution-engine-workflows`
**Description:** Implement `ExecutionEngine.executeWorkflow()`. Handle WorkflowToolStep, WorkflowForEachStep, WorkflowAggregateStep. Loop over arrays, accumulate results, handle on_error and on_empty.
**Acceptance:**
- [ ] Executes batch_add_todos workflow with mock driver
- [ ] for_each iterates over array, passes item as variable
- [ ] on_error: continue skips failed iterations
- [ ] on_empty: stop halts workflow with message
- [ ] aggregate collects loop results
- [ ] Returns WorkflowExecutionResult
- [ ] 80%+ coverage
**Spec:** `docs/specs/execution-engine-spec.md`
**Dependencies:** #10

### Issue #12 — Execution Engine: getToolSchemas
**Package:** core | **Branch:** `feat/12-tool-schemas`
**Description:** Implement `ExecutionEngine.getToolSchemas()`. Iterate all loaded tools, return array of `{name, description, inputSchema, outputSchema}` suitable for LLM function calling.
**Acceptance:**
- [ ] Returns all tool schemas from loaded semantic store
- [ ] Schema format matches LLM function calling conventions
- [ ] Works with demo-todo-app tools
**Spec:** `docs/specs/execution-engine-spec.md`
**Dependencies:** #10

---

## Phase 2: Browser Automation (Issues #13–#19)
*Real browser interaction via Playwright and the Chrome extension.*

### Issue #13 — PlaywrightDriver (TypeScript)
**Package:** playwright | **Branch:** `feat/13-playwright-driver-ts`
**Description:** Implement `PlaywrightDriver` — full BridgeDriver implementation using Playwright's Node.js API. Map each strategy to Playwright locators.
**Acceptance:**
- [ ] All BridgeDriver methods implemented
- [ ] ARIA → page.getByRole(), Label → page.getByLabel(), etc.
- [ ] Integration test against HTML fixture (simple form page)
- [ ] Multi-tab support via browser context pages
- [ ] screenshot() returns PNG buffer
- [ ] 80%+ coverage
**Spec:** `docs/specs/playwright-driver-spec.md`
**Dependencies:** #1

### Issue #14 — E2E Test Fixture Server
**Package:** tests | **Branch:** `feat/14-e2e-fixtures`
**Description:** Create a simple Express/Node HTTP server (`tests/e2e/fixtures/todo-server.ts`) that serves the demo todo app HTML. This is the target for e2e tests.
**Acceptance:**
- [ ] Serves HTML at localhost:3000
- [ ] Has input field, add button, todo list, item count
- [ ] DOM structure matches demo-todo-app semantic definitions
- [ ] Can be started/stopped programmatically for tests
**Spec:** `docs/specs/testing-spec.md`
**Dependencies:** None

### Issue #15 — E2E: Tool Execution via Playwright
**Package:** tests | **Branch:** `feat/15-e2e-tool-execution`
**Description:** Write e2e tests that load demo-todo-app semantics, launch Playwright against fixture server, and execute the `add_todo` tool. Verify captured outputs.
**Acceptance:**
- [ ] add_todo tool executes successfully
- [ ] Captured item_count matches expected value
- [ ] batch_add_todos workflow executes successfully
- [ ] Tests run in CI (uses fixture server)
**Spec:** `docs/specs/testing-spec.md`
**Dependencies:** #10, #13, #14

### Issue #16 — Extension: Service Worker
**Package:** extension | **Branch:** `feat/16-extension-service-worker`
**Description:** Implement extension service worker. Handle messages from content script (page_detected, dom_snapshot). Initialize SemanticStore. Route tool execution requests.
**Acceptance:**
- [ ] Responds to content script page_detected messages
- [ ] Loads semantic store from extension storage
- [ ] Routes execute_tool requests to ExecutionEngine
- [ ] Handles errors gracefully
**Spec:** `docs/specs/extension-spec.md`
**Dependencies:** #10

### Issue #17 — Extension: Content Script
**Package:** extension | **Branch:** `feat/17-extension-content-script`
**Description:** Implement content script with MutationObserver, URL change detection, DOM snapshot capture, and element interaction execution on behalf of service worker.
**Acceptance:**
- [ ] Detects page changes (URL + DOM mutations with 500ms debounce)
- [ ] Sends page_detected messages to service worker
- [ ] Executes DOM interactions (click, type, read) on command
- [ ] Takes DOM snapshots for healing
**Spec:** `docs/specs/extension-spec.md`
**Dependencies:** #16

### Issue #18 — Extension: Tool Injector (WebMCP Polyfill)
**Package:** extension | **Branch:** `feat/18-tool-injector`
**Description:** Implement navigator.modelContext polyfill. Register bridge tools as WebMCP-compatible tools. Handle native WebMCP graceful handoff.
**Acceptance:**
- [ ] navigator.modelContext.tools returns bridge tools
- [ ] Native WebMCP tools take precedence over bridge tools
- [ ] Tools are callable and route to bridge execution
**Spec:** `docs/specs/extension-spec.md`
**Dependencies:** #16, #17

### Issue #19 — Extension: Side Panel UI (Capture + Execute)
**Package:** extension | **Branch:** `feat/19-extension-panel`
**Description:** Build React side panel with CaptureMode and ExecuteMode components. Capture mode shows detected fields/outputs and allows saving. Execute mode provides NLP chat + tool cards.
**Acceptance:**
- [ ] Panel renders in Chrome side panel
- [ ] Capture mode shows detected page elements
- [ ] Execute mode shows tool cards for current page
- [ ] Chat input sends commands to NLP router
- [ ] Results displayed inline
**Spec:** `docs/specs/extension-spec.md`
**Dependencies:** #16, #17

---

## Phase 3: LLM Integration (Issues #20–#24)
*Connect the system to LLMs via Strands Agents.*

### Issue #20 — Python PlaywrightDriver
**Package:** python-sdk | **Branch:** `feat/20-python-playwright-driver`
**Description:** Implement `PlaywrightDriver` in Python. Same logic as TS version but using Playwright's sync_playwright API.
**Acceptance:**
- [ ] All driver methods implemented
- [ ] Strategy mapping: aria→get_by_role, label→get_by_label, css→locator
- [ ] Integration test against fixture server
- [ ] 80%+ coverage
**Spec:** `docs/specs/playwright-driver-spec.md`
**Dependencies:** #14

### Issue #21 — Python Bridge Core
**Package:** python-sdk | **Branch:** `feat/21-python-bridge-core`
**Description:** Implement `Bridge` class — load YAML (pyyaml), validate (pydantic), execute tools, capture results. Port core engine logic to Python.
**Acceptance:**
- [ ] Bridge(config, driver) initializes and loads semantic YAML
- [ ] bridge.execute("add_todo", {"text": "test"}) works with mock driver
- [ ] bridge.get_tool_schemas() returns LLM-compatible schemas
- [ ] 80%+ coverage
**Spec:** `docs/specs/python-sdk-spec.md` (embedded in strands-integration-spec)
**Dependencies:** #20

### Issue #22 — Strands Tools Generation
**Package:** python-sdk | **Branch:** `feat/22-strands-tools`
**Description:** Implement `create_bridge_tools(bridge)` — dynamically generate `@tool` decorated functions from bridge tool schemas. Each tool calls `bridge.execute()` internally.
**Acceptance:**
- [ ] Generated tools have correct name, description, parameters
- [ ] Calling a generated tool executes bridge.execute() and returns outputs
- [ ] Tools are compatible with Strands Agent
- [ ] 80%+ coverage
**Spec:** `docs/specs/strands-integration-spec.md`
**Dependencies:** #21

### Issue #23 — Strands Agent Creation
**Package:** python-sdk | **Branch:** `feat/23-strands-agent`
**Description:** Implement `create_bridge_agent()` — creates a Strands Agent with bridge tools and configurable model provider. Agent receives NLP commands and routes to tools.
**Acceptance:**
- [ ] Agent created with Bedrock model by default
- [ ] Agent has all bridge tools loaded
- [ ] Agent("add a todo item called test") routes to add_todo tool
- [ ] Supports provider switching (anthropic, openai, ollama)
- [ ] 80%+ coverage
**Spec:** `docs/specs/strands-integration-spec.md`
**Dependencies:** #22

### Issue #24 — Extension NLP Router
**Package:** extension | **Branch:** `feat/24-nlp-router`
**Description:** Implement NLP router for the extension. Send user command + tool schemas to LLM API, receive structured tool call back. Connect to Execute mode UI.
**Acceptance:**
- [ ] User command parsed into tool call
- [ ] Supports configurable LLM endpoint
- [ ] Tool call validated against schema before execution
- [ ] Error messages displayed in chat
**Spec:** `docs/specs/extension-spec.md`
**Dependencies:** #12, #19

---

## Phase 4: Registry & CLI (Issues #25–#31)
*Publishing, sharing, and developer tooling.*

### Issue #25 — Local Registry
**Package:** registry | **Branch:** `feat/25-local-registry`
**Description:** Implement `LocalRegistry` — file-system based storage at `~/.webmcp-bridge/registry/`. Install, uninstall, list, resolve, search operations.
**Acceptance:**
- [ ] install() copies validated YAML to registry directory
- [ ] uninstall() removes app version
- [ ] list() returns all installed apps + versions
- [ ] resolve() returns path to semantic directory
- [ ] search() matches by name, tags, description
- [ ] 80%+ coverage
**Spec:** `docs/specs/registry-spec.md`
**Dependencies:** #2

### Issue #26 — Remote Registry Client
**Package:** registry | **Branch:** `feat/26-remote-registry`
**Description:** Implement `RemoteRegistry` — HTTP client for public registry API. Search, pull, publish operations. Auth via token.
**Acceptance:**
- [ ] search() queries remote API
- [ ] pull() downloads and extracts bundle to local registry
- [ ] publish() validates, bundles, and uploads with auth
- [ ] Error handling for network failures, auth errors
- [ ] 80%+ coverage
**Spec:** `docs/specs/registry-spec.md`
**Dependencies:** #25

### Issue #27 — Semantic Store: Registry Loading
**Package:** core | **Branch:** `feat/27-store-registry-loading`
**Description:** Implement `SemanticStore.loadFromRegistry()` — load semantic definitions from local or remote registry instead of a directory.
**Acceptance:**
- [ ] Loads from local registry by app ID
- [ ] Falls back to remote if not found locally
- [ ] Version resolution (latest if not specified)
**Spec:** `docs/specs/semantic-store-spec.md`
**Dependencies:** #4, #25

### Issue #28 — CLI: validate command
**Package:** cli | **Branch:** `feat/28-cli-validate`
**Description:** Implement `webmcp-bridge validate --path <dir>`. Scan directory, validate all YAML, report errors with file path and line numbers.
**Acceptance:**
- [ ] Validates demo-todo-app successfully
- [ ] Reports specific errors for invalid YAML
- [ ] Exit code 0 on success, 1 on failure
- [ ] Colored output with chalk
**Spec:** `docs/specs/cli-spec.md`
**Dependencies:** #2, #4

### Issue #29 — CLI: init command
**Package:** cli | **Branch:** `feat/29-cli-init`
**Description:** Implement `webmcp-bridge init <app-id> --base-url <url>`. Scaffold a new semantic directory with app.yaml template and empty subdirectories.
**Acceptance:**
- [ ] Creates directory with app.yaml, pages/, tools/, workflows/
- [ ] app.yaml pre-filled with id, name, base_url
- [ ] Does not overwrite existing directory
**Spec:** `docs/specs/cli-spec.md`
**Dependencies:** None

### Issue #30 — CLI: publish and pull commands
**Package:** cli | **Branch:** `feat/30-cli-publish-pull`
**Description:** Implement `webmcp-bridge publish <path>` and `webmcp-bridge pull <app-id>`. Publish validates and pushes to remote. Pull downloads to local registry.
**Acceptance:**
- [ ] publish validates YAML before uploading
- [ ] pull installs to local registry
- [ ] Auth token from env var or config file
**Spec:** `docs/specs/cli-spec.md`
**Dependencies:** #25, #26, #28

### Issue #31 — CI: Dependency Layer Enforcement
**Package:** scripts | **Branch:** `feat/31-dep-enforcement`
**Description:** Finalize and test `scripts/check-deps.js`. Ensure it catches import violations across all core modules. Add to CI pipeline.
**Acceptance:**
- [ ] Catches violations (e.g., types/ importing from engine/)
- [ ] Passes when dependencies are correct
- [ ] Runs in CI as part of lint-and-typecheck job
**Spec:** AGENTS.md dependency layer section
**Dependencies:** None

---

## Issue Dependency Graph

```
Phase 1 (Foundation):
#1 ──→ #2 ──→ #4 ──→ #5
 │      │              │
 │      └──→ #25       │
 ├──→ #3               │
 ├──→ #6 ──→ #7 ──→ #8
 │           │      │
 │           └──→ #9│
 │                  │
 └──→ #10 ←────────┘ (depends on #3,#5,#7,#8,#9)
       │
       ├──→ #11
       └──→ #12

Phase 2 (Browser):
#1 ──→ #13
       #14 (independent)
#10,#13,#14 ──→ #15
#10 ──→ #16 ──→ #17 ──→ #18
              └──→ #19

Phase 3 (LLM):
#14 ──→ #20 ──→ #21 ──→ #22 ──→ #23
#12,#19 ──→ #24

Phase 4 (Registry & CLI):
#2 ──→ #25 ──→ #26
#4,#25 ──→ #27
#2,#4 ──→ #28 ──→ #30 (also depends on #25,#26)
#29 (independent)
#31 (independent)
```

## Parallelization Opportunities

These groups can run in parallel if multiple agents are available:

- **Group A:** #1 → #2 → #4 → #5 → #10 → #11 → #12
- **Group B:** #1 → #6 → #7 → #8 → #9 (merges into #10)
- **Group C:** #1 → #3 (merges into #10)
- **Group D:** #14 (independent fixture server)
- **Group E:** #29, #31 (independent)
- **Group F:** #1 → #13 (Playwright driver)
