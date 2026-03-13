# CLAUDE.md — Claude Code Agent Instructions

> Read AGENTS.md first for project context. This file has operational instructions.

## Session Startup

```bash
npm install                                           # Bootstrap workspaces
cd packages/python-sdk && pip install -e ".[dev]"     # Python SDK
npm run typecheck                                     # Verify compilation
npm test                                              # Verify all tests pass
```

## Working on an Issue

1. Read issue description fully. Check `docs/specs/` for related specs.
2. `git checkout -b feat/<issue-number>-<short-name>`
3. Write tests FIRST (TDD) — tests define the expected interface.
4. Implement code to make tests pass.
5. `npm run lint && npm run typecheck && npm test`
6. Commit: `feat(core): add selector resolver` (conventional commits)
7. Push → PR referencing issue: `Closes #<number>`

## Package Notes

### packages/core
- Foundation layer. Changes here affect everything downstream.
- Export all public APIs from `src/index.ts`.
- Use `Result<T, BridgeError>` for fallible operations — never throw in core.
- Unit tests use mock drivers only — never real browsers.

### packages/playwright
- Thin driver implementing `BridgeDriver` via Playwright APIs.
- Test fixtures (HTML pages) in `tests/fixtures/`.
- Integration tests launch real Chromium against fixtures.

### packages/extension
- Build: `npm run build --workspace=packages/extension` → `dist/`
- React 18 side panel. Service worker ↔ content script via `chrome.runtime.sendMessage`.
- Content script observes DOM mutations for page change detection.

### packages/python-sdk
- Strands Agents SDK (`strands-agents`) for LLM orchestration.
- Bridge tools exposed as `@tool` decorated functions.
- Default model provider: Bedrock (Claude), configurable to any Strands-supported provider.
- Tests require `AWS_DEFAULT_REGION` or `ANTHROPIC_API_KEY` for LLM integration tests.

### packages/registry
- Local registry: file-system based, `~/.webmcp-bridge/registry/`
- Remote registry: HTTP API client for public registry server
- Schema validation on publish — reject malformed YAML

### packages/cli
- Entry: `bin/webmcp-bridge`
- Commands: `validate`, `capture`, `test`, `publish`, `pull`
- Uses commander.js

### semantic-examples/
- EXAMPLE definitions only — for testing and demos
- `demo-todo-app/` is a simple test target app with known DOM structure

## Environment Variables

```bash
AWS_DEFAULT_REGION=us-east-1         # Strands + Bedrock
ANTHROPIC_API_KEY=sk-...             # Direct Anthropic (alternative)
WEBMCP_REGISTRY_URL=https://...      # Public registry URL (optional)
WEBMCP_REGISTRY_TOKEN=...            # Registry auth token (optional)
```

## File Naming Patterns

| What | Where |
|------|-------|
| New type | `packages/core/src/types/<name>.ts` → export from `types/index.ts` |
| New engine feature | `packages/core/src/engine/<name>.ts` + `engine/__tests__/<name>.test.ts` |
| New page YAML | `semantic-examples/<app>/pages/<page_id>.yaml` |
| New tool YAML | `semantic-examples/<app>/tools/<tool_name>.yaml` |
| New Python tool | `packages/python-sdk/src/webmcp_bridge/tools/<name>.py` |
| New spec | `docs/specs/<component>-spec.md` |
| New ADR | `docs/decisions/ADR-<NNN>-<title>.md` |
