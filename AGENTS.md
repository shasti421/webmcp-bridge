# AGENTS.md — WebMCP Bridge

> Read this FIRST before any task. Update this file when you discover new constraints.

## What This Project Is

WebMCP Bridge is a **generic platform** that makes any web application behave as if it had
native WebMCP (W3C Draft) tools — without modifying the application. It works by:

1. **Capturing** page semantics (fields, outputs, selectors) as YAML definitions
2. **Exposing** those definitions through three runtimes: Chrome Extension, Playwright+LLM, Native WebMCP injection
3. **Healing** selectors automatically when applications update their UI
4. **Registering** semantic definitions in a local or public registry so communities can share them

This is NOT tied to any specific application. Salesforce, SAP, Gmail, Jira, your internal
admin panel — all are potential targets. The `semantic-examples/` folder has demo data only.

## Repository Layout

```
webmcp-bridge/
├── AGENTS.md                    # THIS FILE
├── CLAUDE.md                    # Claude Code agent instructions
├── package.json                 # Monorepo root (npm workspaces)
├── tsconfig.base.json           # Shared TS config
├── pyproject.toml               # Python workspace config
│
├── packages/
│   ├── core/                    # @webmcp-bridge/core — shared engine (TypeScript)
│   │   └── src/
│   │       ├── types/           # All interfaces + error types (ZERO internal imports)
│   │       ├── semantic/        # SemanticStore — loads + resolves YAML definitions
│   │       ├── selector/        # SelectorResolver — multi-strategy element finding
│   │       ├── capture/         # ResultCapturer — extracts outputs from pages
│   │       ├── healing/         # HealingPipeline — self-healing selector recovery
│   │       ├── engine/          # ExecutionEngine — orchestrates tool step execution
│   │       ├── drivers/         # BridgeDriver interface only (no implementations)
│   │       └── utils/           # Shared helpers (template rendering, etc.)
│   │
│   ├── playwright/              # @webmcp-bridge/playwright — PlaywrightDriver
│   ├── extension/               # Chrome Extension (Manifest V3, side panel)
│   ├── python-sdk/              # Python SDK with Strands Agents for LLM
│   ├── registry/                # @webmcp-bridge/registry — local + remote registry
│   └── cli/                     # CLI: validate, capture, test, publish
│
├── semantic-examples/           # EXAMPLE semantic definitions (not production)
│   └── demo-todo-app/           # Simple todo app for e2e testing & demos
│
├── tests/
│   ├── e2e/                     # Playwright e2e against test fixtures
│   └── integration/             # Cross-package integration tests
│
├── docs/
│   ├── specs/                   # Component specifications (agents read these)
│   └── decisions/               # Architecture Decision Records
│
└── scripts/                     # Build, CI, validation scripts
```

## Dependency Layers (ENFORCED by CI)

```
Types → Semantic → Selector → Capture → Healing → Engine → Drivers
                                                         ↓
                                              ┌──────────┼──────────┐
                                              ▼          ▼          ▼
                                         Playwright  Extension  Python-SDK
                                              │          │          │
                                              └──────────┼──────────┘
                                                         ▼
                                                     Registry
                                                         ▼
                                                        CLI
```

- `types/` has ZERO imports from other internal modules
- `semantic/` depends only on `types/`
- Each layer may only import from layers above it
- Violations caught by `scripts/check-deps.js` in CI

## Coding Standards

### TypeScript
- `"strict": true` — no `any` (use `unknown` + type guards)
- All public functions return `Result<T, BridgeError>` — no thrown exceptions in core
- Every public function has a unit test (vitest). Min 80% coverage.
- PascalCase types, camelCase functions, UPPER_SNAKE constants

### Python (packages/python-sdk)
- Python 3.10+, fully typed
- **Strands Agents SDK** for all LLM orchestration — `@tool` decorator for bridge tools
- pytest, ruff format, ruff check. Min 80% coverage.

### YAML (semantic definitions)
- Validated against JSON Schema on every commit
- Every page: `id`, `app`, `url_pattern`, `wait_for` required
- Every field/output: minimum 2 selector strategies
- IDs: snake_case, unique within an app scope

## Git Workflow

1. Feature branches: `feat/<issue-number>-<short-desc>`
2. PR title: `feat(package): description` or `fix(package): description`
3. Every PR references a GitHub issue: `Closes #<number>`
4. All CI checks pass → squash merge to `main`

## Commands

```bash
npm install                          # Bootstrap monorepo
npm test                             # All TypeScript tests
npm run lint                         # Lint
npm run typecheck                    # Type check
npm run build                        # Build all packages
npm run validate:semantic            # Validate YAML schemas
npm run test:e2e                     # End-to-end tests

cd packages/python-sdk
pip install -e ".[dev]"              # Python dev install
pytest                               # Python tests
```

## Key Design Decisions

1. **Page = primary capture unit.** Fields + outputs belong to pages. Tools reference pages.
2. **YAML = semantic format.** Runtime-agnostic, Git-friendly, human-readable.
3. **Result capture is first-class.** Every tool step can capture outputs → flow to next step.
4. **One engine, multiple drivers.** ContentScriptDriver + PlaywrightDriver share ExecutionEngine.
5. **Strands Agents for Python LLM.** NLP routing, healing, and orchestration via Strands.
6. **Registry for sharing.** Local registry for private definitions; public registry for community.
7. **Platform-agnostic.** No hardcoded app knowledge. All app specifics live in YAML.

## Common Pitfalls

- Do NOT put app-specific knowledge in TypeScript. All app knowledge is in YAML.
- Do NOT put driver implementations in `packages/core`. Core defines interfaces only.
- YAML tool steps execute sequentially — do not parallelize.
- Extension service worker has NO DOM access — all DOM goes through content script.
- Use `createMockDriver()` from test helpers for unit tests — never real browsers.
- Registry publish operations require authentication — never auto-publish without user consent.
