# Testing Strategy Specification

## Purpose

Comprehensive testing strategy covering unit tests, integration tests, and end-to-end tests for the WebMCP Bridge project. Tests are organized by package and component, with mocking strategies for each layer.

**Goals:**
- Minimum 80% code coverage per package
- Fast unit tests (< 100ms each)
- Real Playwright tests for driver layer
- E2E tests against demo app
- Test fixtures for common scenarios

## Testing Stack

| Framework | Language | Purpose |
|-----------|----------|---------|
| Vitest | TypeScript | Unit tests, fast test runner |
| Pytest | Python | Python package tests |
| Playwright | TypeScript/Python | Browser automation testing |
| Docker | All | Test fixture services (todo server, etc.) |

## Unit Testing Strategy

### Mock Driver (TypeScript)

All components that use BridgeDriver should use a mock implementation for unit tests.

**File:** `packages/core/src/drivers/mock-driver.ts`

```typescript
export class MockDriver implements BridgeDriver {
  // Every method is a vi.fn() mock
  readonly goto = vi.fn<[string], Promise<void>>();
  readonly click = vi.fn<[ElementHandle], Promise<void>>();
  readonly type = vi.fn<[ElementHandle, string, TypeOpts?], Promise<void>>();
  readonly findElement = vi.fn<[SelectorChain], Promise<ElementHandle>>();
  readonly readText = vi.fn<[SelectorChain], Promise<string>>();
  readonly readPattern = vi.fn<[SelectorChain, string], Promise<string | null>>();
  readonly screenshot = vi.fn<[], Promise<Buffer>>();
  readonly evaluate = vi.fn<[string], Promise<unknown>>();
  readonly waitFor = vi.fn<[WaitCondition], Promise<void>>();
  readonly getPageContext = vi.fn<[], Promise<PageContext>>();
  // ... all other methods

  constructor() {
    // Setup default mock responses
    this.findElement.mockResolvedValue({} as ElementHandle);
    this.readText.mockResolvedValue('');
    this.screenshot.mockResolvedValue(Buffer.alloc(0));
  }
}
```

### Unit Test Pattern

```typescript
// Example: semantic-store.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticStore } from './semantic-store';
import { YamlSchemaValidator } from './yaml-schema-validator';
import { BridgeError } from '../types/errors';

describe('SemanticStore', () => {
  let store: SemanticStore;
  let validator: YamlSchemaValidator;

  beforeEach(() => {
    validator = new YamlSchemaValidator();
    store = new SemanticStore(validator);
  });

  describe('loadDirectory', () => {
    it('should load valid YAML files', async () => {
      const result = await store.loadDirectory('./tests/fixtures/valid-app');
      expect(result.ok).toBe(true);
    });

    it('should return YAML_PARSE_ERROR on invalid YAML', async () => {
      const result = await store.loadDirectory('./tests/fixtures/invalid-yaml');
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('YAML_PARSE_ERROR');
    });

    it('should index loaded definitions', async () => {
      await store.loadDirectory('./tests/fixtures/valid-app');
      const appResult = store.getApp('demo-app');
      expect(appResult.ok).toBe(true);
      expect(appResult.value.id).toBe('demo-app');
    });
  });

  describe('resolveFieldRef', () => {
    beforeEach(async () => {
      await store.loadDirectory('./tests/fixtures/valid-app');
    });

    it('should resolve valid field reference', () => {
      const result = store.resolveFieldRef('detail.fields.name');
      expect(result.ok).toBe(true);
      expect(result.value.id).toBe('name');
    });

    it('should return PAGE_NOT_FOUND for nonexistent page', () => {
      const result = store.resolveFieldRef('nonexistent.fields.name');
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('PAGE_NOT_FOUND');
    });

    it('should return error for invalid format', () => {
      const result = store.resolveFieldRef('invalid.format');
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('SCHEMA_VALIDATION_ERROR');
    });
  });

  describe('matchPage', () => {
    beforeEach(async () => {
      await store.loadDirectory('./tests/fixtures/valid-app');
    });

    it('should match URL to page definition', () => {
      const result = store.matchPage('https://example.com/items/123');
      expect(result.ok).toBe(true);
    });

    it('should return PAGE_NOT_FOUND for non-matching URL', () => {
      const result = store.matchPage('https://example.com/nonexistent');
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('PAGE_NOT_FOUND');
    });
  });
});
```

### Test Coverage Goals

Per package:
- **core**: 85% (critical, high complexity)
- **cli**: 75% (many paths, less critical)
- **extension**: 70% (browser-dependent, harder to test)

## Integration Testing Strategy

### Test Fixtures

Real YAML files for common scenarios:

```
tests/fixtures/
├── valid-app/                  # Minimal valid app
│   ├── app.yaml
│   ├── pages/
│   │   ├── detail.yaml
│   │   └── list.yaml
│   ├── tools/
│   │   └── create.yaml
│   └── workflows/
├── invalid-yaml/               # Parsing errors
│   ├── bad-indent.yaml
│   └── unclosed-quote.yaml
├── invalid-schema/             # Schema validation errors
│   ├── missing-fields.yaml
│   └── wrong-types.yaml
└── complex-app/                # Full-featured app
    ├── multiple-pages/
    ├── tool-with-healing/
    └── workflow-with-loops/
```

### Integration Test Example

```typescript
// Example: execution-engine.integration.test.ts

import { describe, it, expect } from 'vitest';
import { ExecutionEngine } from './execution-engine';
import { SemanticStore } from './semantic-store';
import { PlaywrightDriver } from '../drivers/playwright-driver';
import { SelectorResolver } from './selector-resolver';
import { ResultCapturer } from './result-capturer';
import { HealingPipeline } from './healing-pipeline';
import { TemplateRenderer } from './template-renderer';

describe('ExecutionEngine Integration', () => {
  let engine: ExecutionEngine;
  let store: SemanticStore;

  beforeEach(async () => {
    store = new SemanticStore(new YamlSchemaValidator());
    await store.loadDirectory('./tests/fixtures/valid-app');

    // Create driver and other components
    const driver = new MockDriver();
    const resolver = new SelectorResolver(driver);
    const capturer = new ResultCapturer(resolver);
    const healer = new HealingPipeline(driver);
    const renderer = new TemplateRenderer();

    engine = new ExecutionEngine(store, driver, resolver, capturer, healer, renderer);
  });

  it('should execute tool with all steps', async () => {
    const result = await engine.executeTool('create_item', {
      title: 'Test Item',
      description: 'A test'
    });

    expect(result.ok).toBe(true);
    expect(result.value.success).toBe(true);
    expect(result.value.outputs).toHaveProperty('itemId');
  });

  it('should handle missing page gracefully', async () => {
    const result = await engine.executeTool('nonexistent_tool', {});

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('TOOL_NOT_FOUND');
  });

  it('should execute workflow with for_each loop', async () => {
    const result = await engine.executeWorkflow('bulk_create', {
      items: ['Item 1', 'Item 2', 'Item 3']
    });

    expect(result.ok).toBe(true);
    expect(result.value.aggregatedOutputs.created_count).toBe(3);
  });
});
```

## E2E Testing Strategy

### Demo Todo App

Simple Express server for E2E testing:

**File:** `tests/e2e/fixtures/todo-server.ts`

```typescript
import express from 'express';
import path from 'path';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let todos = [
  { id: 1, title: 'Buy milk', completed: false },
  { id: 2, title: 'Walk dog', completed: true }
];

app.get('/api/todos', (req, res) => {
  res.json(todos);
});

app.post('/api/todos', (req, res) => {
  const todo = { id: Date.now(), title: req.body.title, completed: false };
  todos.push(todo);
  res.json(todo);
});

app.put('/api/todos/:id', (req, res) => {
  const todo = todos.find(t => t.id == req.params.id);
  if (todo) {
    todo.title = req.body.title || todo.title;
    todo.completed = req.body.completed ?? todo.completed;
  }
  res.json(todo);
});

app.delete('/api/todos/:id', (req, res) => {
  todos = todos.filter(t => t.id != req.params.id);
  res.json({ ok: true });
});

export default app;
```

**HTML:** `tests/e2e/fixtures/public/index.html`

```html
<!DOCTYPE html>
<html>
<head>
  <title>Todo App</title>
</head>
<body>
  <h1>My Todos</h1>

  <input id="new-todo" type="text" placeholder="What to do?" />
  <button id="add-button" aria-label="Add todo">Add</button>

  <ul id="todo-list"></ul>

  <script src="app.js"></script>
</body>
</html>
```

### E2E Test

```typescript
// tests/e2e/todo-app.e2e.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightDriver } from '../../packages/core/src/drivers/playwright-driver';
import { ExecutionEngine } from '../../packages/core/src/engine/execution-engine';
import { SemanticStore } from '../../packages/core/src/semantic/semantic-store';
import { chromium, Browser, Page, BrowserContext } from 'playwright';
import express from 'express';
import todoApp from './fixtures/todo-server';
import { Server } from 'http';

describe('E2E: Todo App Automation', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let driver: PlaywrightDriver;
  let engine: ExecutionEngine;
  let server: Server;
  let store: SemanticStore;

  beforeAll(async () => {
    // Start test server
    server = todoApp.listen(3000);

    // Launch browser
    browser = await chromium.launch({ headless: true });
    context = await browser.createBrowserContext();
    page = await context.newPage();

    // Initialize components
    driver = new PlaywrightDriver(page, browser, context);
    store = new SemanticStore(new YamlSchemaValidator());
    await store.loadDirectory('./tests/fixtures/todo-app');

    // Create engine
    engine = new ExecutionEngine(
      store,
      driver,
      new SelectorResolver(driver),
      new ResultCapturer(new SelectorResolver(driver)),
      new HealingPipeline(driver),
      new TemplateRenderer()
    );
  });

  afterAll(async () => {
    await browser.close();
    server.close();
  });

  it('should create a new todo', async () => {
    await driver.goto('http://localhost:3000');

    const result = await engine.executeTool('create_todo', {
      title: 'Buy groceries'
    });

    expect(result.ok).toBe(true);
    expect(result.value.outputs.todoId).toBeDefined();
  });

  it('should update a todo', async () => {
    const result = await engine.executeTool('update_todo', {
      id: '1',
      title: 'Buy milk (1L)'
    });

    expect(result.ok).toBe(true);
  });

  it('should complete a todo', async () => {
    const result = await engine.executeTool('complete_todo', {
      id: '1'
    });

    expect(result.ok).toBe(true);
  });

  it('should list all todos', async () => {
    const result = await engine.executeTool('list_todos', {});

    expect(result.ok).toBe(true);
    expect(Array.isArray(result.value.outputs.todos)).toBe(true);
  });

  it('should delete a todo', async () => {
    const result = await engine.executeTool('delete_todo', {
      id: '2'
    });

    expect(result.ok).toBe(true);
  });

  it('should handle healing for changed selectors', async () => {
    // Modify page structure to require healing
    await page.evaluate(() => {
      document.getElementById('add-button').setAttribute('aria-label', 'Create Todo');
    });

    // Tool should still work (healing finds new selector)
    const result = await engine.executeTool('create_todo', {
      title: 'Another todo'
    });

    expect(result.ok).toBe(true);
  });
});
```

## Python Testing (Pytest)

### Mock Driver (Python)

```python
# tests/mocks.py

from unittest.mock import MagicMock, AsyncMock
from typing import Dict, Any

class MockBridgeDriver:
    def __init__(self):
        self.goto = AsyncMock()
        self.click = AsyncMock()
        self.type = AsyncMock()
        self.find_element = AsyncMock()
        self.read_text = AsyncMock(return_value='')
        self.read_pattern = AsyncMock(return_value=None)
        self.screenshot = AsyncMock(return_value=b'')
        self.evaluate = AsyncMock(return_value=None)
        self.wait_for = AsyncMock()
        self.get_page_context = AsyncMock(return_value={
            'url': 'http://example.com',
            'title': 'Example',
            'readyState': 'complete'
        })
```

### Python Unit Test Example

```python
# tests/test_template_renderer.py

import pytest
from webmcp_bridge.template_renderer import TemplateRenderer

@pytest.fixture
def renderer():
    return TemplateRenderer()

class TestTemplateRenderer:
    def test_simple_substitution(self, renderer):
        result = renderer.render('Hello {{name}}', {'name': 'Alice'})
        assert result == 'Hello Alice'

    def test_nested_property_access(self, renderer):
        context = {'user': {'profile': {'name': 'Alice'}}}
        result = renderer.render('User: {{user.profile.name}}', context)
        assert result == 'User: Alice'

    def test_array_index_access(self, renderer):
        context = {'items': ['first', 'second', 'third']}
        result = renderer.render('First: {{items[0]}}', context)
        assert result == 'First: first'

    def test_missing_variable(self, renderer):
        result = renderer.render('User: {{user}}', {})
        assert result == 'User: '

    def test_evaluate_condition_true(self, renderer):
        result = renderer.evaluate_condition('{{isActive}}', {'isActive': True})
        assert result is True

    def test_evaluate_condition_false(self, renderer):
        result = renderer.evaluate_condition('{{isActive}}', {'isActive': False})
        assert result is False

    def test_render_object(self, renderer):
        obj = {'url': '/api/{{version}}/users/{{id}}', 'page': 1}
        context = {'version': 'v1', 'id': '123'}
        result = renderer.render_object(obj, context)
        assert result['url'] == '/api/v1/users/123'
        assert result['page'] == 1
```

## Coverage Targets

| Package | Target | Current | Notes |
|---------|--------|---------|-------|
| core/semantic | 85% | TBD | Schema validation critical |
| core/selector | 85% | TBD | Complex strategy logic |
| core/healing | 80% | TBD | Multiple fallback paths |
| core/execution | 85% | TBD | Core orchestration |
| cli | 75% | TBD | Many CLI commands |
| extension | 65% | TBD | Browser-dependent |

## Test Organization

```
tests/
├── fixtures/
│   ├── valid-app/
│   ├── invalid-yaml/
│   ├── invalid-schema/
│   ├── complex-app/
│   └── todo-app/
├── mocks.ts                    # Mock driver, helpers
├── unit/
│   ├── semantic-store.test.ts
│   ├── selector-resolver.test.ts
│   ├── result-capturer.test.ts
│   ├── healing-pipeline.test.ts
│   ├── execution-engine.test.ts
│   ├── template-renderer.test.ts
│   └── playwright-driver.test.ts
├── integration/
│   ├── execution-engine.integration.test.ts
│   ├── semantic-store.integration.test.ts
│   └── workflow.integration.test.ts
└── e2e/
    ├── todo-app.e2e.test.ts
    ├── fixtures/
    │   ├── todo-server.ts
    │   └── public/
    └── healing.e2e.test.ts
```

## Continuous Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/test.yml

name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20]
        python-version: ['3.10', '3.11']

    steps:
      - uses: actions/checkout@v3

      - uses: actions/setup-node@v3
        with:
          node-version: ${{ matrix.node-version }}

      - uses: actions/setup-python@v4
        with:
          python-version: ${{ matrix.python-version }}

      - name: Install dependencies
        run: |
          npm install
          pip install -e .

      - name: Run unit tests
        run: npm run test:unit

      - name: Run integration tests
        run: npm run test:integration

      - name: Run E2E tests
        run: npm run test:e2e

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info

      - name: Check coverage threshold
        run: npm run check:coverage
```

## Test Scenarios by Component

### SelectorResolver
- All selector strategies (aria, label, text, css, js)
- Fallback chain (first fails, second succeeds)
- All fail
- Timeout handling
- Edge cases (empty chain, null elements)

### ResultCapturer
- All capture strategies (text, pattern, attribute, table)
- Transient output polling
- Retry with backoff
- Multiple outputs
- Edge cases (null attribute, empty table)

### HealingPipeline
- All 4 stages (fuzzy match, JS anchor walk, LLM, human)
- CSS selector relaxation rules
- DOM walking heuristics
- LLM integration (mocked)
- Stage timeouts
- Healing failure

### ExecutionEngine
- Tool execution with all step types
- Variable context accumulation
- Conditional step skipping
- Workflow execution
- for_each loops
- Error handling and recovery

### TemplateRenderer
- Simple variable substitution
- Nested property access
- Array indexing
- Missing variables
- Condition evaluation
- Recursive object rendering
