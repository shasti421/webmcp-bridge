# WebMCP Bridge Specification Documents

This directory contains comprehensive specification documents for all components of the WebMCP Bridge project. Each spec is detailed enough for a coding agent to implement the component without asking questions.

## Document Organization

### Core Components

1. **semantic-store-spec.md** (13 KB)
   - Runtime in-memory index of all app definitions
   - Loading YAML files and validation
   - Field/output reference resolution
   - URL pattern matching
   - 16 test scenarios

2. **yaml-schema-spec.md** (29 KB)
   - JSON Schema definitions for all YAML types
   - AppDefinition, PageDefinition, ToolDefinition, WorkflowDefinition
   - Field validation with AJV
   - 16 test scenarios

3. **selector-resolver-spec.md** (14 KB)
   - Priority-based selector strategy resolution
   - Strategy mapping: aria, label, text, css, js
   - Text and pattern extraction
   - 16 test scenarios

4. **result-capturer-spec.md** (17 KB)
   - Output extraction from page elements
   - Capture strategies: text_content, pattern_match, attribute, table
   - Transient output polling
   - Retry with exponential backoff
   - 16 test scenarios

5. **healing-pipeline-spec.md** (19 KB)
   - 4-stage fallback system for selector recovery
   - Fuzzy CSS matching
   - JS anchor walking
   - LLM-based DOM analysis
   - Human-in-loop (extension only)
   - 12 test scenarios

6. **execution-engine-spec.md** (23 KB)
   - Tool and workflow orchestration
   - Step handlers: navigate, interact, capture, wait, tab, auth, evaluate
   - Variable context accumulation
   - Template rendering and conditionals
   - Healing pipeline integration
   - 16 test scenarios

7. **template-renderer-spec.md** (13 KB)
   - Template expression parsing: {{variable.path[0].field}}
   - Nested property resolution
   - Array indexing
   - Condition evaluation
   - Recursive object rendering
   - 20 test scenarios

### Driver Implementation

8. **playwright-driver-spec.md** (19 KB)
   - BridgeDriver implementation for Playwright (TS + Python)
   - Strategy-to-locator mapping
   - All interaction methods: click, type, select, readText, etc.
   - Multi-tab management
   - 16 test scenarios

### Integration & Distribution

9. **strands-integration-spec.md** (11 KB)
   - Convert bridge tools to Strands @tool decorators
   - Create Strands agents with model providers
   - Model mapping: bedrock, anthropic, openai
   - System prompt generation
   - 10 test scenarios

10. **extension-spec.md** (18 KB)
    - Chrome extension architecture
    - Service worker message handling
    - Content script DOM observation
    - React side panel UI
    - Tool injection via navigator.modelContext
    - NLP router for LLM-based tool selection
    - 7 test scenarios

11. **registry-spec.md** (13 KB)
    - Local filesystem-based app registry (~/.webmcp-bridge/registry/)
    - Installation, publishing, searching
    - Remote API integration
    - Version management
    - 10 test scenarios

### Developer Tools

12. **cli-spec.md** (11 KB)
    - Command-line interface for local development
    - Commands: validate, init, test, publish, pull, list, search
    - Configuration management
    - Exit codes and error messages
    - 8 test scenarios

13. **testing-spec.md** (18 KB)
    - Unit testing strategy with vitest + pytest
    - Mock driver pattern
    - Integration test fixtures
    - E2E testing with demo todo app
    - Coverage targets (80%+ per package)
    - GitHub Actions CI/CD workflow

## Quick Reference

### By Layer

**Semantic Layer:**
- semantic-store-spec.md
- yaml-schema-spec.md

**Selector & Capture Layer:**
- selector-resolver-spec.md
- result-capturer-spec.md
- healing-pipeline-spec.md

**Execution Layer:**
- execution-engine-spec.md
- template-renderer-spec.md
- playwright-driver-spec.md

**Integration Layer:**
- strands-integration-spec.md
- extension-spec.md
- registry-spec.md

**Developer Tools:**
- cli-spec.md
- testing-spec.md

### By Technology

**TypeScript (Packages: core, cli, extension):**
- All specs with TypeScript algorithms and patterns
- Vitest for unit tests
- Playwright for browser automation

**Python (Package: python-bridge):**
- playwright-driver-spec.md (Python version)
- strands-integration-spec.md (Python SDK integration)
- Pytest for tests

**Chrome Extension:**
- extension-spec.md (Service worker, content script, UI)

## Spec Format

Each specification document includes:

1. **Purpose** — What does this component do?
2. **Data Structures** — Class definitions and interfaces
3. **Algorithms** — Detailed pseudocode with inputs/outputs
4. **Error Handling** — Error codes, messages, recovery
5. **Edge Cases** — Special scenarios and constraints
6. **Test Scenarios** — 8-20 concrete test cases per spec

### Algorithm Sections

Each algorithm includes:
- **Inputs:** Parameters and their types
- **Outputs:** Return value or error
- **Pseudocode:** Step-by-step logic
- **Examples:** Real-world usage patterns

### Test Scenarios

Each scenario includes:
- **Setup:** Initial state
- **Test:** What is being tested
- **Expected:** Expected result or error

## Statistics

- **Total Lines of Specification:** 7,689
- **Number of Documents:** 13
- **Average Length:** 592 lines per spec
- **Total Test Scenarios:** 161
- **Coverage Areas:** Unit, Integration, E2E, CLI, Extension

## Implementation Guide

### Phase 1: Foundation (Core Layer)
1. Implement YamlSchemaValidator
2. Implement SemanticStore
3. Implement TemplateRenderer
4. Implement SelectorResolver

### Phase 2: Automation (Execution Layer)
5. Implement ResultCapturer
6. Implement HealingPipeline
7. Implement ExecutionEngine
8. Implement PlaywrightDriver

### Phase 3: Integration (SDK & Tools)
9. Implement Strands Integration
10. Implement Registry system
11. Implement CLI
12. Implement Chrome Extension

### Phase 4: Quality (Testing)
13. Unit tests (all components)
14. Integration tests
15. E2E tests
16. CI/CD setup

## No App-Specific Examples

All specifications use **only the demo-todo-app** for examples. No Salesforce, CCRZ, or other proprietary application details are included. This ensures the specifications are generic and applicable to any web application.

## Updated: 2026-03-13

All specifications finalized and ready for implementation. Each spec is self-contained and includes everything needed to build the component without ambiguity or external questions.
