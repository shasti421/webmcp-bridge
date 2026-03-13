# Agent Kickoff Instructions

> Step-by-step instructions to go from this repo scaffold to a fully implemented,
> tested product using Claude Code (or any coding agent).

---

## Prerequisites

1. **GitHub repo created** — push this scaffold to a new GitHub repo
2. **Claude Code** installed and authenticated
3. **Node.js 20+** and **Python 3.10+** available
4. **GitHub CLI (`gh`)** installed and authenticated

---

## Step 0: Push Scaffold to GitHub

```bash
cd webmcp-bridge
git init
git add -A
git commit -m "feat: initial project scaffold with harness engineering setup"
gh repo create webmcp-bridge --public --source=. --push
```

## Step 1: Create All GitHub Issues

Run this script to create all 31 issues from the plan. The agent can then pick them up:

```bash
# Create issues from the plan (run from repo root)
# Phase 1
gh issue create --title "feat(core): Core types and Result monad" --body "See docs/GITHUB-ISSUES.md Issue #1. Spec: types defined in scaffold. Dependencies: None" --label enhancement
gh issue create --title "feat(core): YAML Schema Validator" --body "See docs/GITHUB-ISSUES.md Issue #2. Spec: docs/specs/yaml-schema-spec.md. Dependencies: #1" --label enhancement
gh issue create --title "feat(core): Template Renderer" --body "See docs/GITHUB-ISSUES.md Issue #3. Spec: docs/specs/template-renderer-spec.md. Dependencies: #1" --label enhancement
gh issue create --title "feat(core): Semantic Store - YAML Loading" --body "See docs/GITHUB-ISSUES.md Issue #4. Spec: docs/specs/semantic-store-spec.md. Dependencies: #1, #2" --label enhancement
gh issue create --title "feat(core): Semantic Store - Resolution and Matching" --body "See docs/GITHUB-ISSUES.md Issue #5. Spec: docs/specs/semantic-store-spec.md. Dependencies: #4" --label enhancement
gh issue create --title "feat(core): Mock Driver" --body "See docs/GITHUB-ISSUES.md Issue #6. Spec: docs/specs/testing-spec.md. Dependencies: #1" --label enhancement
gh issue create --title "feat(core): Selector Resolver" --body "See docs/GITHUB-ISSUES.md Issue #7. Spec: docs/specs/selector-resolver-spec.md. Dependencies: #1, #6" --label enhancement
gh issue create --title "feat(core): Result Capturer" --body "See docs/GITHUB-ISSUES.md Issue #8. Spec: docs/specs/result-capturer-spec.md. Dependencies: #7" --label enhancement
gh issue create --title "feat(core): Healing Pipeline" --body "See docs/GITHUB-ISSUES.md Issue #9. Spec: docs/specs/healing-pipeline-spec.md. Dependencies: #7" --label enhancement
gh issue create --title "feat(core): Execution Engine - Tool Execution" --body "See docs/GITHUB-ISSUES.md Issue #10. Spec: docs/specs/execution-engine-spec.md. Dependencies: #3, #5, #7, #8, #9" --label enhancement
gh issue create --title "feat(core): Execution Engine - Workflow Execution" --body "See docs/GITHUB-ISSUES.md Issue #11. Spec: docs/specs/execution-engine-spec.md. Dependencies: #10" --label enhancement
gh issue create --title "feat(core): Execution Engine - getToolSchemas" --body "See docs/GITHUB-ISSUES.md Issue #12. Spec: docs/specs/execution-engine-spec.md. Dependencies: #10" --label enhancement

# Phase 2
gh issue create --title "feat(playwright): PlaywrightDriver TypeScript" --body "See docs/GITHUB-ISSUES.md Issue #13. Spec: docs/specs/playwright-driver-spec.md. Dependencies: #1" --label enhancement
gh issue create --title "feat(tests): E2E Test Fixture Server" --body "See docs/GITHUB-ISSUES.md Issue #14. Spec: docs/specs/testing-spec.md. Dependencies: None" --label enhancement
gh issue create --title "feat(tests): E2E Tool Execution via Playwright" --body "See docs/GITHUB-ISSUES.md Issue #15. Spec: docs/specs/testing-spec.md. Dependencies: #10, #13, #14" --label enhancement
gh issue create --title "feat(extension): Service Worker" --body "See docs/GITHUB-ISSUES.md Issue #16. Spec: docs/specs/extension-spec.md. Dependencies: #10" --label enhancement
gh issue create --title "feat(extension): Content Script" --body "See docs/GITHUB-ISSUES.md Issue #17. Spec: docs/specs/extension-spec.md. Dependencies: #16" --label enhancement
gh issue create --title "feat(extension): Tool Injector (WebMCP Polyfill)" --body "See docs/GITHUB-ISSUES.md Issue #18. Spec: docs/specs/extension-spec.md. Dependencies: #16, #17" --label enhancement
gh issue create --title "feat(extension): Side Panel UI" --body "See docs/GITHUB-ISSUES.md Issue #19. Spec: docs/specs/extension-spec.md. Dependencies: #16, #17" --label enhancement

# Phase 3
gh issue create --title "feat(python-sdk): Python PlaywrightDriver" --body "See docs/GITHUB-ISSUES.md Issue #20. Spec: docs/specs/playwright-driver-spec.md. Dependencies: #14" --label enhancement
gh issue create --title "feat(python-sdk): Python Bridge Core" --body "See docs/GITHUB-ISSUES.md Issue #21. Spec: docs/specs/strands-integration-spec.md. Dependencies: #20" --label enhancement
gh issue create --title "feat(python-sdk): Strands Tools Generation" --body "See docs/GITHUB-ISSUES.md Issue #22. Spec: docs/specs/strands-integration-spec.md. Dependencies: #21" --label enhancement
gh issue create --title "feat(python-sdk): Strands Agent Creation" --body "See docs/GITHUB-ISSUES.md Issue #23. Spec: docs/specs/strands-integration-spec.md. Dependencies: #22" --label enhancement
gh issue create --title "feat(extension): NLP Router" --body "See docs/GITHUB-ISSUES.md Issue #24. Spec: docs/specs/extension-spec.md. Dependencies: #12, #19" --label enhancement

# Phase 4
gh issue create --title "feat(registry): Local Registry" --body "See docs/GITHUB-ISSUES.md Issue #25. Spec: docs/specs/registry-spec.md. Dependencies: #2" --label enhancement
gh issue create --title "feat(registry): Remote Registry Client" --body "See docs/GITHUB-ISSUES.md Issue #26. Spec: docs/specs/registry-spec.md. Dependencies: #25" --label enhancement
gh issue create --title "feat(core): Semantic Store - Registry Loading" --body "See docs/GITHUB-ISSUES.md Issue #27. Spec: docs/specs/semantic-store-spec.md. Dependencies: #4, #25" --label enhancement
gh issue create --title "feat(cli): validate command" --body "See docs/GITHUB-ISSUES.md Issue #28. Spec: docs/specs/cli-spec.md. Dependencies: #2, #4" --label enhancement
gh issue create --title "feat(cli): init command" --body "See docs/GITHUB-ISSUES.md Issue #29. Spec: docs/specs/cli-spec.md. Dependencies: None" --label enhancement
gh issue create --title "feat(cli): publish and pull commands" --body "See docs/GITHUB-ISSUES.md Issue #30. Spec: docs/specs/cli-spec.md. Dependencies: #25, #26, #28" --label enhancement
gh issue create --title "feat(scripts): Dependency Layer Enforcement" --body "See docs/GITHUB-ISSUES.md Issue #31. Spec: AGENTS.md. Dependencies: None" --label enhancement
```

---

## Step 2: Kick Off Claude Code

### Option A: Sequential (Single Agent)

Give Claude this prompt to start working through issues in order:

```
You are working on the webmcp-bridge repository. Read AGENTS.md and CLAUDE.md first.

Your workflow:
1. Run `npm install` to bootstrap
2. Look at GitHub issues with `gh issue list`
3. Pick the lowest-numbered issue whose dependencies are all closed
4. Read the issue, then read the spec file referenced in the issue
5. Create a feature branch: git checkout -b feat/<issue-number>-<short-name>
6. Write tests FIRST (TDD) based on the spec's test scenarios
7. Implement the code to make tests pass
8. Run: npm run lint && npm run typecheck && npm test
9. Commit, push, create PR: gh pr create --title "<issue title>" --body "Closes #<number>"
10. Move to the next issue

Start with Issue #1 (Core types and Result monad).
Work through all Phase 1 issues before moving to Phase 2.
For each issue, read the corresponding spec in docs/specs/ BEFORE writing any code.
```

### Option B: Parallel (Multiple Agents)

Launch multiple Claude Code sessions targeting independent issue groups:

**Agent 1 — Core Pipeline (critical path):**
```
Work on issues #1 → #2 → #4 → #5 → #10 → #11 → #12 sequentially.
Read AGENTS.md first. Each issue has a spec in docs/specs/.
```

**Agent 2 — Selector + Capture + Healing:**
```
Wait for issue #1 to be merged, then work on #6 → #7 → #8 → #9 sequentially.
Read AGENTS.md first. Each issue has a spec in docs/specs/.
```

**Agent 3 — Template + Independent items:**
```
Work on #3 (after #1 merged), #14, #29, #31. These are independent.
Read AGENTS.md first. Each issue has a spec in docs/specs/.
```

**Agent 4 — Playwright + Python (after Phase 1):**
```
Wait for Phase 1 issues to be merged, then work on #13 → #15 → #20 → #21 → #22 → #23.
Read AGENTS.md first. Each issue has a spec in docs/specs/.
```

**Agent 5 — Extension (after Phase 1):**
```
Wait for #10 to be merged, then work on #16 → #17 → #18 → #19 → #24.
Read AGENTS.md first. Each issue has a spec in docs/specs/.
```

**Agent 6 — Registry + CLI (after #2 and #4):**
```
Wait for #2 and #4 to be merged, then work on #25 → #26 → #27 → #28 → #30.
Read AGENTS.md first. Each issue has a spec in docs/specs/.
```

---

## Step 3: Monitor Progress

```bash
# Check issue status
gh issue list --state all

# Check PRs
gh pr list --state all

# Check CI status
gh run list --limit 10

# View a specific PR
gh pr view <number>
```

---

## Step 4: After All Issues Merged

1. Run full test suite: `npm test && npm run test:e2e`
2. Run Python tests: `cd packages/python-sdk && pytest`
3. Build everything: `npm run build`
4. Load extension in Chrome: chrome://extensions → Load unpacked → `packages/extension/dist/`
5. Test with demo-todo-app fixture server
6. Try creating semantic definitions for a real app

---

## Key Decisions Pre-Made (Agents Should NOT Ask About These)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript (core, playwright, extension, cli) + Python (SDK) | TS for browser; Python for LLM/data ecosystem |
| LLM Framework | Strands Agents (Python) | Model-agnostic, @tool decorator, AWS native |
| Test Framework | vitest (TS), pytest (Python) | Fast, modern, good DX |
| YAML Validation | Ajv (JSON Schema) | Industry standard, fast, detailed errors |
| YAML Parsing | js-yaml (TS), pyyaml (Python) | Standard libraries |
| Extension | Manifest V3 + Side Panel | Chrome Web Store requirement |
| UI Framework | React 18 (extension panel) | Ecosystem, developer familiarity |
| Build Tool | vite (extension), tsc (packages) | Fast, standard |
| CLI Framework | commander.js | Standard Node CLI library |
| Monorepo | npm workspaces | Built-in, no extra tooling |
| Error Pattern | Result<T, BridgeError> monad | No thrown exceptions in core |
| Selector Priority | ARIA → Label → Text → CSS → JS → AI healing | Accessibility-first, resilient |
| Registry Storage | Filesystem (~/.webmcp-bridge/registry/) | Simple, no DB needed |
| Default Model | Claude via Bedrock | Best tool use; configurable to any Strands provider |
| Coverage Target | 80% minimum | Practical threshold |
| Git Strategy | Feature branches, squash merge, conventional commits | Clean history |
