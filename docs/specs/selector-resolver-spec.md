# SelectorResolver Specification

## Purpose

The SelectorResolver translates abstract selector strategies into concrete element handles. Given a SelectorChain (array of selector strategies sorted by priority), it attempts each strategy in order until one succeeds. It is the primary interface between high-level selectors (e.g., "find by ARIA role") and low-level driver methods (e.g., `findElement`, `readText`, `readPattern`).

**Key responsibilities:**
- Implement priority-based fallback: try strategies in order
- Map selector strategies to driver methods
- Provide `resolveText()` and `resolvePattern()` convenience methods
- Return detailed error context on all-fail
- Support all selector types: aria, label, text, css, js

## Data Structures

```typescript
// ─── SelectorResolver Class ──────────────────────────────

class SelectorResolver {
  private driver: BridgeDriver;
  private currentPageContext: PageContext; // For context-aware resolution

  constructor(driver: BridgeDriver, pageContext: PageContext)

  // Core resolution
  resolve(selectors: SelectorChain): Promise<Result<ElementHandle, BridgeError>>

  // Convenience methods
  resolveText(selectors: SelectorChain): Promise<Result<string, BridgeError>>
  resolvePattern(selectors: SelectorChain, regex: RegExp): Promise<Result<string | null, BridgeError>>
}

// ─── Internal attempt tracking (for error reporting) ─────

interface ResolutionAttempt {
  strategy: SelectorStrategy;
  error?: string;
  durationMs: number;
}
```

## Algorithm: resolve(selectors)

**Inputs:**
- `selectors: SelectorChain` — array of selector strategies, sorted by priority (highest priority first)

**Outputs:**
- `Result<ElementHandle, BridgeError>` — ok(element) on first success, err(SELECTOR_NOT_FOUND) if all fail

**Pseudocode:**

```
function resolve(selectors):
  attempts = []

  // Try each selector strategy in order
  for i = 0; i < selectors.length; i++:
    strategy = selectors[i]
    startTime = now()

    // Dispatch to strategy-specific handler
    result = switch(strategy.strategy):
      case 'aria':
        resolveAria(strategy)
      case 'label':
        resolveLabel(strategy)
      case 'text':
        resolveText(strategy)
      case 'css':
        resolveCss(strategy)
      case 'js':
        resolveJs(strategy)
      default:
        err(SELECTOR_NOT_FOUND, "Unknown strategy: " + strategy.strategy)

    durationMs = now() - startTime

    // Success: return immediately
    if isOk(result):
      return ok(result.value)

    // Failure: record and continue
    attempts.push({
      strategy: strategy,
      error: result.error.message,
      durationMs: durationMs
    })

  // All strategies failed
  attemptDetails = attempts
    .map(a => `[${a.strategy.strategy}] ${a.error} (${a.durationMs}ms)`)
    .join('; ')

  return err(BridgeError{
    code: 'SELECTOR_NOT_FOUND',
    message: `Failed to resolve selectors (${selectors.length} strategies tried): ${attemptDetails}`,
    source: 'selector',
    cause: {
      attempts: attempts,
      selectorChain: selectors
    }
  })
```

## Strategy Handlers

### resolveAria(strategy: AriaStrategy)

**Inputs:**
- `strategy.role: string` — ARIA role (e.g., "button", "textbox", "dialog")
- `strategy.name?: string` — ARIA accessible name (optional, e.g., "Submit", "First Name")
- `strategy.confidence?: number` — confidence threshold (0–1, unused here but logged)

**Outputs:**
- `Result<ElementHandle, BridgeError>`

**Implementation:**

```
function resolveAria(strategy):
  // Build driver call
  if strategy.name is set:
    // Find by role AND name
    return driver.findElement([{
      strategy: 'aria',
      role: strategy.role,
      name: strategy.name
    }])
  else:
    // Find by role only
    return driver.findElement([{
      strategy: 'aria',
      role: strategy.role
    }])
```

**Driver mapping (PlaywrightDriver):**
```typescript
// For aria strategy with name:
page.getByRole(strategy.role, { name: new RegExp(strategy.name, 'i') })

// For aria strategy without name:
page.getByRole(strategy.role)
```

### resolveLabel(strategy: LabelStrategy)

**Inputs:**
- `strategy.text: string` — label text to match (case-insensitive substring match)
- `strategy.scope?: string` — CSS selector for scoping (optional)

**Outputs:**
- `Result<ElementHandle, BridgeError>`

**Implementation:**

```
function resolveLabel(strategy):
  scopeElement = null
  if strategy.scope is set:
    scopeResult = driver.findElement([{ strategy: 'css', selector: strategy.scope }])
    if isErr(scopeResult):
      return err(SELECTOR_NOT_FOUND, "Label scope not found: " + strategy.scope)
    scopeElement = scopeResult.value

  // Call driver's label strategy
  return driver.findElement([{
    strategy: 'label',
    text: strategy.text,
    scope: scopeElement
  }])
```

**Driver mapping (PlaywrightDriver):**
```typescript
// For label strategy:
if (scope provided) {
  scope.locator('label').filter({ hasText: strategy.text }).first()
} else {
  page.getByLabel(new RegExp(strategy.text, 'i'))
}
```

### resolveText(strategy: TextStrategy)

**Inputs:**
- `strategy.text: string` — text content to match
- `strategy.exact?: boolean` — if true, exact match; if false, substring match (default: false)

**Outputs:**
- `Result<ElementHandle, BridgeError>`

**Implementation:**

```
function resolveText(strategy):
  return driver.findElement([{
    strategy: 'text',
    text: strategy.text,
    exact: strategy.exact or false
  }])
```

**Driver mapping (PlaywrightDriver):**
```typescript
// For text strategy with exact=true:
page.getByText(strategy.text, { exact: true })

// For text strategy with exact=false (substring):
page.getByText(new RegExp(escapeRegex(strategy.text)))
```

### resolveCss(strategy: CssStrategy)

**Inputs:**
- `strategy.selector: string` — CSS selector

**Outputs:**
- `Result<ElementHandle, BridgeError>`

**Implementation:**

```
function resolveCss(strategy):
  return driver.findElement([{
    strategy: 'css',
    selector: strategy.selector
  }])
```

**Driver mapping (PlaywrightDriver):**
```typescript
page.locator(strategy.selector).first()
```

### resolveJs(strategy: JsStrategy)

**Inputs:**
- `strategy.expression: string` — JavaScript expression that returns an Element or null

**Outputs:**
- `Result<ElementHandle, BridgeError>`

**Implementation:**

```
function resolveJs(strategy):
  return driver.findElement([{
    strategy: 'js',
    expression: strategy.expression
  }])
```

**Driver mapping (PlaywrightDriver):**
```typescript
// Evaluate the expression and wrap result
const element = await page.evaluate(strategy.expression)
if (element) {
  return ElementHandle wrapping element
} else {
  return null
}
```

## Algorithm: resolveText(selectors)

**Inputs:**
- `selectors: SelectorChain`

**Outputs:**
- `Result<string, BridgeError>` — ok(text) on success, err(SELECTOR_NOT_FOUND) if element not found

**Pseudocode:**

```
function resolveText(selectors):
  elementResult = resolve(selectors)

  if isErr(elementResult):
    return err(elementResult.error)

  element = elementResult.value

  // Call driver's readText method
  textResult = driver.readText([element])

  if isErr(textResult):
    return err(BridgeError{
      code: 'CAPTURE_FAILED',
      message: 'Failed to read text from element',
      source: 'selector',
      cause: textResult.error
    })

  return ok(textResult.value)
```

## Algorithm: resolvePattern(selectors, regex)

**Inputs:**
- `selectors: SelectorChain`
- `regex: RegExp` — pattern to match against text content

**Outputs:**
- `Result<string | null, BridgeError>` — ok(captured_group or full_match) on success

**Pseudocode:**

```
function resolvePattern(selectors, regex):
  textResult = resolveText(selectors)

  if isErr(textResult):
    return err(textResult.error)

  text = textResult.value
  match = regex.exec(text)

  if not match:
    return ok(null)  // No match, but element exists

  // Return first capture group if present, else full match
  if match.length > 1 and match[1] is not null:
    return ok(match[1])
  else:
    return ok(match[0])
```

## Error Handling

**Error code:** `SELECTOR_NOT_FOUND`

**Error context:**
- `message`: Human-readable summary with strategy count
- `cause.attempts`: Array of ResolutionAttempt with errors and timing
- `cause.selectorChain`: Full SelectorChain that failed

**Example error message:**
```
Failed to resolve selectors (3 strategies tried):
  [aria] No element found with role "button" and name "Submit" (45ms);
  [css] Selector "button.submit-btn" did not match any element (23ms);
  [text] No element with text "Submit" found (18ms)
```

**When to escalate to HealingPipeline:**
- Selector resolution fails (err(SELECTOR_NOT_FOUND))
- In FieldDefinition interaction or OutputDefinition capture
- Do NOT escalate for SelectorResolver.resolve() calls within the healing pipeline itself

## Edge Cases

1. **Empty SelectorChain:** If `selectors.length == 0`, immediately return err(SELECTOR_NOT_FOUND, "Empty selector chain").

2. **Scope not found:** In `resolveLabel()`, if scope selector fails, do not treat as fallback; escalate error immediately.

3. **Text matching:** Text strategies are case-insensitive substring matches by default. Set `exact: true` for exact case-sensitive matching.

4. **ARIA attributes:** If role exists but name doesn't match, the strategy fails. Don't fall back to role-only match; let next strategy try.

5. **JS expression error:** If the JS expression throws, return err(SELECTOR_NOT_FOUND, "JS evaluation failed: ...").

6. **Timing:** Each strategy handler should timeout after a reasonable duration (e.g., 10 seconds). Return err(SELECTOR_NOT_FOUND, "Strategy timeout") on exceed.

7. **Multiple elements match:** Always return the first element found (use `.first()` or similar in driver).

8. **Dynamic content:** If content changes while resolving, the strategy may fail. This is not special-cased; healing pipeline will retry.

9. **Invisible elements:** By default, find invisible elements (e.g., hidden in CSS). Driver implementation should expose this as an option if needed.

10. **Cross-origin iframes:** If selector tries to access cross-origin iframe, driver will fail. Not handled specially; escalate to healing.

## Test Scenarios

### 1. Resolve with single aria strategy — success

**Setup:**
- SelectorChain: `[{ strategy: 'aria', role: 'button', name: 'Submit' }]`
- Page contains `<button aria-label="Submit">`

**Expected:** ok(ElementHandle)

### 2. Resolve with single aria strategy — not found

**Setup:**
- SelectorChain: `[{ strategy: 'aria', role: 'button', name: 'Cancel' }]`
- Page contains no such button

**Expected:** err(SELECTOR_NOT_FOUND) with message mentioning aria strategy

### 3. Resolve with fallback — first fails, second succeeds

**Setup:**
- SelectorChain: `[{ strategy: 'aria', role: 'button' }, { strategy: 'css', selector: 'button.submit' }]`
- Page contains no generic button, but `<button class="submit">`

**Expected:** ok(ElementHandle) from css strategy

### 4. Resolve with fallback — all fail

**Setup:**
- SelectorChain: `[{ strategy: 'aria', role: 'button' }, { strategy: 'css', selector: '.no-such-class' }]`
- Page has no buttons, no matching CSS class

**Expected:** err(SELECTOR_NOT_FOUND) with details of all 2 attempts

### 5. Resolve text — success

**Setup:**
- SelectorChain: `[{ strategy: 'text', text: 'Hello' }]`
- Page contains `<p>Hello World</p>`

**Expected:** ok("Hello World")

### 6. Resolve text — element not found

**Setup:**
- SelectorChain: `[{ strategy: 'text', text: 'Goodbye' }]`
- Page has no such text

**Expected:** err(SELECTOR_NOT_FOUND)

### 7. Resolve text with exact match

**Setup:**
- SelectorChain: `[{ strategy: 'text', text: 'Hello', exact: true }]`
- Page contains `<p>Hello</p>` and `<p>Hello World</p>`

**Expected:** ok("Hello") from exact match, not "Hello World"

### 8. Resolve pattern — match found

**Setup:**
- SelectorChain: `[{ strategy: 'text', text: 'Price: $99.99' }]`
- Regex: `/\$([0-9.]+)/`

**Expected:** ok("99.99") (capture group 1)

### 9. Resolve pattern — no match

**Setup:**
- SelectorChain: `[{ strategy: 'text', text: 'Price: $99.99' }]`
- Regex: `/€([0-9.]+)/`

**Expected:** ok(null)

### 10. Resolve with label strategy and scope

**Setup:**
- SelectorChain: `[{ strategy: 'label', text: 'Email', scope: '.form-section' }]`
- Page contains `<div class="form-section"><label>Email</label><input /></div>`

**Expected:** ok(ElementHandle) for input

### 11. Resolve with label strategy — scope not found

**Setup:**
- SelectorChain: `[{ strategy: 'label', text: 'Email', scope: '.nonexistent' }]`

**Expected:** err(SELECTOR_NOT_FOUND) mentioning scope failure

### 12. Resolve with JS strategy — valid expression

**Setup:**
- SelectorChain: `[{ strategy: 'js', expression: 'document.querySelector("button")' }]`
- Page contains `<button>Click me</button>`

**Expected:** ok(ElementHandle)

### 13. Resolve with JS strategy — expression returns null

**Setup:**
- SelectorChain: `[{ strategy: 'js', expression: 'document.querySelector(".no-such-class")' }]`

**Expected:** err(SELECTOR_NOT_FOUND)

### 14. Resolve with JS strategy — expression throws

**Setup:**
- SelectorChain: `[{ strategy: 'js', expression: 'throw new Error("oops")' }]`

**Expected:** err(SELECTOR_NOT_FOUND) with message mentioning "JS evaluation failed"

### 15. Empty selector chain

**Setup:**
- SelectorChain: `[]`

**Expected:** err(SELECTOR_NOT_FOUND) with message "Empty selector chain"

### 16. Complex SelectorChain with 5 strategies

**Setup:**
- Each strategy has different errors (aria role not found, css selector no match, etc.)

**Expected:** err(SELECTOR_NOT_FOUND) with all 5 attempts listed in details
