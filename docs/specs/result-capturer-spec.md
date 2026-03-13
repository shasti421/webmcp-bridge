# ResultCapturer Specification

## Purpose

The ResultCapturer extracts output values from page elements after tool execution. Given an OutputDefinition (which specifies selectors and capture strategies), it attempts each strategy in order to extract the value. It handles transient outputs (polling until value appears), retries on failure, and supports multiple capture methods (text, pattern, attribute, table).

**Key responsibilities:**
- Try capture strategies in priority order
- Extract text content from elements
- Match and extract via regex patterns
- Extract attribute values
- Collect table data
- Poll for transient/dynamic outputs
- Retry with exponential backoff
- Return captured value or detailed error

## Data Structures

```typescript
// ─── ResultCapturer Class ─────────────────────────────

class ResultCapturer {
  private selectorResolver: SelectorResolver;
  private driver: BridgeDriver;

  constructor(resolver: SelectorResolver, driver: BridgeDriver)

  // Main capture methods
  capture(output: OutputDefinition, context: VariableContext): Promise<Result<unknown, BridgeError>>
  captureAll(outputs: OutputDefinition[], context: VariableContext): Promise<Result<Record<string, unknown>, BridgeError>>

  // Strategy implementations
  private captureText(selectors: SelectorChain, context: VariableContext): Promise<Result<string, BridgeError>>
  private capturePattern(strategy: CaptureStrategy, context: VariableContext): Promise<Result<string | null, BridgeError>>
  private captureAttribute(strategy: CaptureStrategy, context: VariableContext): Promise<Result<string | null, BridgeError>>
  private captureTable(strategy: CaptureStrategy, context: VariableContext): Promise<Result<string[], BridgeError>>

  // Transient + retry handling
  private pollForValue(fn: () => Promise<Result<T, BridgeError>>, timeout: number): Promise<Result<T, BridgeError>>
  private retryWithBackoff(fn: () => Promise<Result<T, BridgeError>>, attempts: number): Promise<Result<T, BridgeError>>
}

// ─── Capture Context ─────────────────────────────────

interface CaptureContext {
  pageUrl: string;
  pageTitle: string;
  variables: VariableContext; // For template rendering
}

// ─── Captured Value ─────────────────────────────────

type CapturedValue = string | string[] | Record<string, unknown> | null;
```

## Algorithm: capture(output, context)

**Inputs:**
- `output: OutputDefinition` — defines selectors, strategies, transient, retry, capture_on
- `context: VariableContext` — map of variable name → value (for template rendering)

**Outputs:**
- `Result<CapturedValue, BridgeError>` — ok(value) on success, err(CAPTURE_FAILED | CAPTURE_TIMEOUT) on failure

**Pseudocode:**

```
function capture(output, context):
  // Step 1: Determine if should capture based on capture_on condition
  captureOn = output.capture_on or 'success'
  // (capture_on is checked by caller; this function assumes capture should happen)

  // Step 2: Handle transient outputs (poll until value appears or timeout)
  if output.transient:
    pollTimeout = parseDuration(output.wait_timeout or '5s') in ms
    return pollForValue(
      fn: () => captureStrategies(output, context),
      timeout: pollTimeout
    )

  // Step 3: Handle retries (if output.retry > 0)
  if output.retry and output.retry > 0:
    return retryWithBackoff(
      fn: () => captureStrategies(output, context),
      attempts: output.retry + 1  // +1 for initial attempt
    )

  // Step 4: Simple capture (no polling, no retry)
  return captureStrategies(output, context)

function captureStrategies(output, context):
  strategies = output.capture_strategies or [{ type: 'text_content', selectors: output.selectors }]

  for i = 0; i < strategies.length; i++:
    strategy = strategies[i]

    result = switch(strategy.type):
      case 'text_content':
        captureText(strategy.selectors, context)
      case 'pattern_match':
        capturePattern(strategy, context)
      case 'attribute':
        captureAttribute(strategy, context)
      case 'table':
        captureTable(strategy, context)
      default:
        err(CAPTURE_FAILED, "Unknown strategy: " + strategy.type)

    if isOk(result):
      return ok(result.value)

  // All strategies failed
  return err(BridgeError{
    code: 'CAPTURE_FAILED',
    message: `All ${strategies.length} capture strategies failed for output "${output.id}"`,
    source: 'capture'
  })
```

## Strategy: captureText(selectors, context)

**Inputs:**
- `selectors: SelectorChain` — where to find the text
- `context: VariableContext` — for template rendering (unused for text extraction)

**Outputs:**
- `Result<string, BridgeError>` — ok(text_content) or err(SELECTOR_NOT_FOUND | CAPTURE_FAILED)

**Implementation:**

```
function captureText(selectors, context):
  // Use SelectorResolver.resolveText()
  return selectorResolver.resolveText(selectors)
```

**Examples:**
- Select a `<span>` and extract its `.textContent`
- Select an `<input>` and extract its `.value` (via readText driver method)
- Returns full trimmed text

## Strategy: capturePattern(strategy, context)

**Inputs:**
- `strategy.selectors: SelectorChain` — where to find the element
- `strategy.pattern: string` — regex to match (required)
- `strategy.group?: number` — capture group index (default: 0 for full match)
- `context: VariableContext` — for template rendering

**Outputs:**
- `Result<string | null, BridgeError>` — ok(matched_group) or err(SELECTOR_NOT_FOUND)

**Implementation:**

```
function capturePattern(strategy, context):
  pattern = strategy.pattern
  groupIndex = strategy.group or 0

  // Compile regex
  try:
    regex = new RegExp(pattern)
  catch (e):
    return err(BridgeError{
      code: 'CAPTURE_FAILED',
      message: `Invalid regex pattern: ${pattern}`,
      source: 'capture',
      cause: e
    })

  // Use SelectorResolver.resolvePattern()
  resultText = selectorResolver.resolvePattern(strategy.selectors, regex)

  if isErr(resultText):
    return err(resultText.error)

  text = resultText.value

  // text is null if no match
  return ok(text)
```

**Examples:**
- Pattern: `\$([0-9.]+)` to extract price from "Price: $99.99"
- Pattern: `(?<price>[0-9.]+)` with named groups (if regex supports it)
- Returns capture group 1 if present, else full match, else null

## Strategy: captureAttribute(strategy, context)

**Inputs:**
- `strategy.selectors: SelectorChain` — where to find the element
- `strategy.attribute: string` — attribute name (required)
- `context: VariableContext` — for template rendering

**Outputs:**
- `Result<string | null, BridgeError>` — ok(attr_value) or err(SELECTOR_NOT_FOUND)

**Implementation:**

```
function captureAttribute(strategy, context):
  attributeName = strategy.attribute

  // Step 1: Find element
  elementResult = selectorResolver.resolve(strategy.selectors)

  if isErr(elementResult):
    return err(elementResult.error)

  element = elementResult.value

  // Step 2: Read attribute via driver
  // Driver will execute JS: element.getAttribute(attributeName)
  attrResult = driver.evaluate(
    js: `arguments[0].getAttribute('${attributeName}')`
    element: element
  )

  if isErr(attrResult):
    return err(BridgeError{
      code: 'CAPTURE_FAILED',
      message: `Failed to read attribute "${attributeName}"`,
      source: 'capture',
      cause: attrResult.error
    })

  value = attrResult.value
  return ok(value)  // null if attribute not present
```

**Examples:**
- Attribute: `href` on `<a>` tag
- Attribute: `data-id` on custom element
- Returns null if attribute missing

## Strategy: captureTable(strategy, context)

**Inputs:**
- `strategy.selectors: SelectorChain` — where to find table rows
- `context: VariableContext` — for template rendering

**Outputs:**
- `Result<string[], BridgeError>` — ok(array_of_rows) or err(SELECTOR_NOT_FOUND)

**Implementation:**

```
function captureTable(strategy, context):
  rowSelector = strategy.selectors

  // Step 1: Find all matching elements (rows)
  allElementsResult = driver.findAllElements(rowSelector)

  if isErr(allElementsResult):
    return err(allElementsResult.error)

  elements = allElementsResult.value

  // Step 2: Extract text from each row
  rowTexts = []
  for each element in elements:
    textResult = driver.readText([element])
    if isOk(textResult):
      rowTexts.push(textResult.value)

  return ok(rowTexts)
```

**Examples:**
- Selector: `tr` to capture all table rows
- Selector: `.list-item` to capture all list items
- Returns array of strings, one per element

## Algorithm: pollForValue(fn, timeout)

**Inputs:**
- `fn: () => Promise<Result<T, BridgeError>>` — async function to call repeatedly
- `timeout: number` — max milliseconds to poll

**Outputs:**
- `Result<T, BridgeError>` — ok(value) on success, err(CAPTURE_TIMEOUT) if timeout exceeded

**Pseudocode:**

```
function pollForValue(fn, timeout):
  startTime = now()
  pollIntervalMs = 500  // Fixed interval

  while (now() - startTime) < timeout:
    result = await fn()

    if isOk(result):
      // Value found
      return ok(result.value)

    // Value not ready; wait and retry
    await sleep(pollIntervalMs)

  // Timeout exceeded
  return err(BridgeError{
    code: 'CAPTURE_TIMEOUT',
    message: `Timeout waiting for output (${timeout}ms)`,
    source: 'capture'
  })
```

**Example scenario:**
- Output is marked transient: true, wait_timeout: "5s"
- pollForValue is called with timeout=5000ms
- Every 500ms, captureStrategies() is retried
- If value appears after 2 seconds, return ok immediately
- If still not found after 5 seconds, return err(CAPTURE_TIMEOUT)

## Algorithm: retryWithBackoff(fn, attempts)

**Inputs:**
- `fn: () => Promise<Result<T, BridgeError>>` — async function to call
- `attempts: number` — max number of attempts (e.g., 3)

**Outputs:**
- `Result<T, BridgeError>` — ok(value) on success, err(last_error) if all attempts fail

**Pseudocode:**

```
function retryWithBackoff(fn, attempts):
  lastError = null

  for attempt = 1; attempt <= attempts; attempt++:
    result = await fn()

    if isOk(result):
      return ok(result.value)

    lastError = result.error

    if attempt < attempts:
      // Exponential backoff: 1s, 2s, 4s, etc.
      backoffMs = 1000 * (2 ** (attempt - 1))
      await sleep(backoffMs)

  // All attempts exhausted
  return err(lastError)
```

**Example scenario:**
- Output has retry: 2 (total 3 attempts)
- Attempt 1 fails; wait 1s
- Attempt 2 fails; wait 2s
- Attempt 3 fails; return err

## Algorithm: captureAll(outputs, context)

**Inputs:**
- `outputs: OutputDefinition[]` — array of outputs to capture
- `context: VariableContext` — shared variable context

**Outputs:**
- `Result<Record<string, unknown>, BridgeError>` — ok(map of id→value) or err(first failure)

**Pseudocode:**

```
function captureAll(outputs, context):
  results = {}

  for each output in outputs:
    captureResult = capture(output, context)

    if isErr(captureResult):
      // On first failure, return immediately
      return err(captureResult.error)

    results[output.id] = captureResult.value

  return ok(results)
```

**Behavior:**
- Captures outputs in order
- Fails on first error (fail-fast)
- Returns a map of output.id → captured value

## Error Handling

**Error codes:**
- `SELECTOR_NOT_FOUND` — element matching selectors not found (from SelectorResolver)
- `CAPTURE_FAILED` — capture strategy failed (invalid regex, JS eval failed, etc.)
- `CAPTURE_TIMEOUT` — transient output polling exceeded timeout

**Error context:**
- `source: 'capture'`
- `message` — human-readable with output id and strategy type
- `cause` — underlying error from selector resolution or strategy

**Examples:**
```
CAPTURE_FAILED: All 2 capture strategies failed for output "user_id"

CAPTURE_TIMEOUT: Timeout waiting for output (5000ms)

SELECTOR_NOT_FOUND: Failed to resolve selectors (1 strategies tried): ...
```

## Edge Cases

1. **Null attribute:** If element exists but attribute is missing, return ok(null), not err.

2. **Empty text:** If element exists but has no text content, return ok(""), not err.

3. **Regex with no groups:** If pattern has no capture groups, return the full match (group 0).

4. **Table with no rows:** If selector doesn't match any elements, return ok([]) (empty array).

5. **Transient + retry:** If output has both transient and retry, apply retry inside the poll loop:
   - Outer loop: poll with 500ms interval for wait_timeout
   - Inner loop: retry with exponential backoff for each poll iteration

6. **Zero retry:** If output.retry is 0 or not set, attempt once (no retries).

7. **Zero timeout:** If output.wait_timeout is "0s", use a sensible default like "5s".

8. **Timing parse:** Parse "5s" → 5000ms, "500ms" → 500ms. If invalid format, use default.

9. **Disabled strategies:** If capture_strategies is empty or not set, default to text_content strategy.

10. **Template rendering:** Output strategies don't typically need template rendering, but context is passed for future use.

## Test Scenarios

### 1. Capture text — success

**Setup:**
- Output with selectors for `<span id="name">Alice</span>`
- Default strategy (text_content)

**Test:** capture(output)

**Expected:** ok("Alice")

### 2. Capture pattern — group extracted

**Setup:**
- Output with selectors for `<p>Price: $99.99</p>`
- Strategy: pattern_match, pattern: `\$([0-9.]+)`

**Test:** capture(output)

**Expected:** ok("99.99")

### 3. Capture attribute — success

**Setup:**
- Output with selectors for `<a href="/page/42">Link</a>`
- Strategy: attribute, attribute: "href"

**Test:** capture(output)

**Expected:** ok("/page/42")

### 4. Capture attribute — missing

**Setup:**
- Output with selectors for `<div>No data attr</div>`
- Strategy: attribute, attribute: "data-id"

**Test:** capture(output)

**Expected:** ok(null)

### 5. Capture table — multiple rows

**Setup:**
- Output with selectors for `tr` in a table
- 3 rows with text "Row 1", "Row 2", "Row 3"

**Test:** capture(output)

**Expected:** ok(["Row 1", "Row 2", "Row 3"])

### 6. Capture table — no rows

**Setup:**
- Output with selectors for `tr`
- Table is empty

**Test:** capture(output)

**Expected:** ok([])

### 7. Capture with transient — value appears after 1 second

**Setup:**
- Output with transient: true, wait_timeout: "3s"
- Element not found initially, appears after 1 second

**Test:** capture(output)

**Expected:** ok(value), completes in ~1s (not 3s)

### 8. Capture with transient — timeout exceeded

**Setup:**
- Output with transient: true, wait_timeout: "1s"
- Element never appears

**Test:** capture(output)

**Expected:** err(CAPTURE_TIMEOUT)

### 9. Capture with retry — succeeds on 2nd attempt

**Setup:**
- Output with retry: 2
- Strategy fails first time, succeeds on retry

**Test:** capture(output)

**Expected:** ok(value), with delays 1s between attempts

### 10. Capture with retry — all fail

**Setup:**
- Output with retry: 2
- All 3 attempts fail

**Test:** capture(output)

**Expected:** err(last_error)

### 11. Multiple strategies — first fails, second succeeds

**Setup:**
- Output with 2 strategies: [pattern_match, text_content]
- Pattern doesn't match, but text is available

**Test:** capture(output)

**Expected:** ok(text) from text_content strategy

### 12. Multiple strategies — all fail

**Setup:**
- Output with 2 strategies: [pattern_match (bad regex), attribute (missing)]

**Test:** capture(output)

**Expected:** err(CAPTURE_FAILED)

### 13. Capture all — all succeed

**Setup:**
- 3 outputs, all successfully captured

**Test:** captureAll(outputs)

**Expected:** ok({ output1_id: value1, output2_id: value2, output3_id: value3 })

### 14. Capture all — 2nd fails

**Setup:**
- 3 outputs, 1st succeeds, 2nd fails

**Test:** captureAll(outputs)

**Expected:** err(error_from_2nd)

### 15. Invalid regex pattern

**Setup:**
- Strategy: pattern_match, pattern: "[invalid(" (unclosed bracket)

**Test:** capture(output)

**Expected:** err(CAPTURE_FAILED) with message "Invalid regex pattern"

### 16. Pattern with no match

**Setup:**
- Output with selectors for `<p>Hello World</p>`
- Strategy: pattern_match, pattern: `/\d+/` (digits)

**Test:** capture(output)

**Expected:** ok(null)
