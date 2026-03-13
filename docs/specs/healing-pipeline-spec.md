# HealingPipeline Specification

## Purpose

The HealingPipeline is a multi-stage fallback system that attempts to recover from selector failures. When a selector cannot find an element, the healing pipeline progressively tries more sophisticated recovery techniques: fuzzy CSS relaxation, DOM anchor-walking, AI-based analysis, and (in extensions) human assistance.

**Key responsibilities:**
- Run 4 progressive healing stages on selector failure
- Apply CSS selector relaxation rules
- Navigate DOM by adjacent labels and structure
- Call LLM for intelligent selector suggestions
- Track success and new selector
- Return recovered element or HEALING_EXHAUSTED error

## Data Structures

```typescript
// ─── HealingPipeline Class ─────────────────────────────

class HealingPipeline {
  private driver: BridgeDriver;
  private llmCallback?: (domSnapshot: DomSnapshot, screenshot: Buffer) => Promise<string>;
  private userCallback?: (pageUrl: string, screenshot: Buffer) => Promise<string>;

  constructor(
    driver: BridgeDriver,
    llmCallback?: LLMCallback,
    userCallback?: UserCallback
  )

  async heal(
    originalSelectors: SelectorChain,
    failedAttempts: ResolutionAttempt[],
    pageContext: PageContext
  ): Promise<Result<HealResult, BridgeError>>

  // Stages
  private async stage1_fuzzyMatch(): Promise<Result<HealResult, BridgeError>>
  private async stage2_jsAnchorWalk(): Promise<Result<HealResult, BridgeError>>
  private async stage3_aiDomAnalysis(): Promise<Result<HealResult, BridgeError>>
  private async stage4_humanInLoop(): Promise<Result<HealResult, BridgeError>>
}

// ─── Healing Result ─────────────────────────────────

interface HealResult {
  element: ElementHandle;
  newSelector: SelectorChain;
  newSelectorString: string;  // Human-readable representation
  stage: 'fuzzy_match' | 'js_anchor_walk' | 'ai_dom_analysis' | 'human_in_loop';
  confidence: number;  // 0–1, higher = more confident
  durationMs: number;
}

// ─── DOM Snapshot ─────────────────────────────────

interface DomSnapshot {
  html: string;
  xpaths: Record<string, string>;  // element id → xpath for reference
  ariaLabels: Record<string, string>;  // element id → aria label
  textContent: Record<string, string>;  // element id → text content
}

// ─── LLM Callback ─────────────────────────────────

type LLMCallback = (
  domSnapshot: DomSnapshot,
  screenshot: Buffer,
  failureContext: string
) => Promise<string>;  // Returns new selector string or JS expression

// ─── User Callback ────────────────────────────────

type UserCallback = (
  pageUrl: string,
  screenshot: Buffer,
  failureContext: string
) => Promise<string>;  // Returns new selector string (user clicked element)
```

## Algorithm: heal(originalSelectors, failedAttempts, pageContext)

**Inputs:**
- `originalSelectors: SelectorChain` — selector chain that failed
- `failedAttempts: ResolutionAttempt[]` — array of failed strategies with error messages
- `pageContext: PageContext` — current page URL, title, readyState

**Outputs:**
- `Result<HealResult, BridgeError>` — ok(HealResult) on any stage success, err(HEALING_EXHAUSTED) if all fail

**Pseudocode:**

```
function heal(originalSelectors, failedAttempts, pageContext):
  context = {
    originalSelectors: originalSelectors,
    failedAttempts: failedAttempts,
    pageContext: pageContext
  }

  // Stage 1: Fuzzy CSS relaxation (fast, 500ms)
  stage1Result = stage1_fuzzyMatch(context)
  if isOk(stage1Result):
    return ok(stage1Result.value with stage='fuzzy_match')

  // Stage 2: JS anchor walk (medium, 1s)
  stage2Result = stage2_jsAnchorWalk(context)
  if isOk(stage2Result):
    return ok(stage2Result.value with stage='js_anchor_walk')

  // Stage 3: AI DOM analysis (slow, 5s)
  if llmCallback is set:
    stage3Result = stage3_aiDomAnalysis(context)
    if isOk(stage3Result):
      return ok(stage3Result.value with stage='ai_dom_analysis')

  // Stage 4: Human in loop (extension only, no timeout)
  if userCallback is set:
    stage4Result = stage4_humanInLoop(context)
    if isOk(stage4Result):
      return ok(stage4Result.value with stage='human_in_loop')

  // All stages exhausted
  return err(BridgeError{
    code: 'HEALING_EXHAUSTED',
    message: 'All healing stages failed',
    source: 'healing',
    cause: {
      originalSelectors: originalSelectors,
      allAttempts: failedAttempts
    }
  })
```

## Stage 1: Fuzzy CSS Matching (500ms timeout)

**Goal:** Relax CSS selectors by removing overly specific conditions.

**Algorithm:**

```
function stage1_fuzzyMatch(context):
  originalSelectors = context.originalSelectors

  // Extract any CSS selectors from the chain
  cssStrategies = originalSelectors.filter(s => s.strategy == 'css')

  if cssStrategies.length == 0:
    return err(HEALING_EXHAUSTED, "No CSS selectors to relax")

  // For each CSS selector, try progressively relaxed versions
  for each cssStrategy in cssStrategies:
    relaxedSelectors = relaxCssSelector(cssStrategy.selector)

    for each relaxedSelector in relaxedSelectors:
      elementResult = driver.findElement([{ strategy: 'css', selector: relaxedSelector }])

      if isOk(elementResult):
        return ok(HealResult{
          element: elementResult.value,
          newSelector: [{ strategy: 'css', selector: relaxedSelector }],
          newSelectorString: relaxedSelector,
          confidence: 0.7,  // Medium confidence
          durationMs: elapsed
        })

  return err(HEALING_EXHAUSTED)

function relaxCssSelector(selector):
  // Return relaxed versions in order of strictness (least strict first)
  relaxedVersions = []

  // Version 1: Remove nth-child() constraints
  // E.g., "div.item:nth-child(2)" → "div.item"
  relaxed1 = selector.replace(/:(nth-child|nth-of-type|first|last|only)\([^)]*\)/g, '')
  relaxedVersions.push(relaxed1)

  // Version 2: Remove attribute value exact matches, use substring match
  // E.g., "[data-id='42']" → "[data-id*='42']"
  relaxed2 = relaxed1.replace(/\[([^\]]+)='([^']+)'\]/g, '[$1*=$2]')
  relaxedVersions.push(relaxed2)

  // Version 3: Remove class/attribute selectors, keep tag
  // E.g., "button.primary[type='button']" → "button"
  relaxed3 = selector.replace(/\.[\w-]+/g, '').replace(/\[[^\]]*\]/g, '')
  relaxedVersions.push(relaxed3)

  // Version 4: Match by tag name only
  // E.g., "div.item" → "div"
  const tagMatch = selector.match(/^([a-z0-9]+)/i)
  if tagMatch:
    relaxedVersions.push(tagMatch[1])

  return relaxedVersions
```

**Examples:**
- "button.primary:nth-child(2)" → relax to "button.primary" → "button"
- "input[type='text'][name='email']" → relax to "input[type*='text']" → "input"

## Stage 2: JS Anchor Walk (1s timeout)

**Goal:** Find element by nearby text labels, walk DOM structure from known anchors.

**Algorithm:**

```
function stage2_jsAnchorWalk(context):
  originalSelectors = context.originalSelectors
  failureContext = buildFailureDescription(originalSelectors)

  // Attempt 1: Find by nearby label text
  if originalSelectors contains label or text strategy:
    labelText = extractLabelFromStrategies(originalSelectors)
    if labelText:
      elementResult = findByNearbyLabel(labelText)
      if isOk(elementResult):
        newSelectorString = `[label-based on "${labelText}"]`
        return ok(HealResult{
          element: elementResult.value,
          newSelector: [{ strategy: 'js', expression: generateJsForLabel(labelText) }],
          newSelectorString: newSelectorString,
          confidence: 0.6,
          durationMs: elapsed
        })

  // Attempt 2: Walk DOM structure
  // E.g., if looking for submit button in a form, find form first, then button inside
  domWalkResult = walkDomForElement(failureContext)
  if isOk(domWalkResult):
    return ok(domWalkResult.value with confidence: 0.55)

  return err(HEALING_EXHAUSTED)

function findByNearbyLabel(labelText):
  // Execute JS to:
  // 1. Find element with this label text
  // 2. Walk up to parent form/fieldset
  // 3. Find input/select/button inside
  jsExpr = `
    (function() {
      const labels = Array.from(document.querySelectorAll('label'));
      const label = labels.find(l => l.textContent.includes('${labelText}'));
      if (!label) return null;
      const input = label.htmlFor ? document.getElementById(label.htmlFor) : label.querySelector('input, select, button, textarea');
      return input;
    })()
  `
  return driver.evaluate(jsExpr)

function walkDomForElement(failureContext):
  // Use heuristics to navigate DOM
  // E.g., if looking for a button in a modal, find modal first
  jsExpr = `
    (function() {
      // Generic heuristic: find by aria-label or title attribute
      const ariaMatch = document.querySelector('[aria-label*="${extractKey(failureContext)}"]');
      if (ariaMatch) return ariaMatch;

      // Fallback: find by visible text
      const allElements = document.querySelectorAll('*');
      for (let el of allElements) {
        if (el.textContent.toLowerCase().includes('${extractKey(failureContext)}')) {
          return el;
        }
      }
      return null;
    })()
  `
  return driver.evaluate(jsExpr)
```

**Confidence:** 0.55–0.6 (moderate, text-based heuristics may be fragile)

## Stage 3: AI DOM Analysis (5s timeout)

**Goal:** Send DOM snapshot and screenshot to LLM callback for intelligent selector suggestion.

**Algorithm:**

```
function stage3_aiDomAnalysis(context):
  if not llmCallback:
    return err(HEALING_EXHAUSTED, "LLM callback not configured")

  // Step 1: Take screenshot
  screenshot = driver.screenshot()

  // Step 2: Capture DOM snapshot
  domSnapshot = capturedomSnapshot(context.originalSelectors)

  // Step 3: Build failure description
  failureContext = buildFailureDescription(context.originalSelectors, context.failedAttempts)

  // Step 4: Call LLM
  try:
    newSelectorString = await llmCallback(domSnapshot, screenshot, failureContext)
  catch (e):
    return err(HEALING_EXHAUSTED, "LLM callback failed: " + e.message)

  // Step 5: Parse response and try selector
  // Response could be: CSS selector, JS expression, or "not found"
  if newSelectorString.contains("not found") or isEmpty(newSelectorString):
    return err(HEALING_EXHAUSTED, "LLM suggests element not on page")

  // Try as JS expression first
  if newSelectorString.contains("document.") or newSelectorString.contains("querySelector"):
    elementResult = driver.evaluate(newSelectorString)
  else:
    // Try as CSS selector
    elementResult = driver.findElement([{ strategy: 'css', selector: newSelectorString }])

  if isOk(elementResult):
    return ok(HealResult{
      element: elementResult.value,
      newSelector: [{ strategy: 'js', expression: newSelectorString }],
      newSelectorString: newSelectorString,
      confidence: 0.8,  // High confidence from LLM
      durationMs: elapsed
    })

  return err(HEALING_EXHAUSTED)

function capturedomSnapshot(originalSelectors):
  // Execute JS to capture DOM structure
  html = driver.evaluate(`document.documentElement.outerHTML`)

  xpaths = {}
  ariaLabels = {}
  textContent = {}

  // Identify elements that might be relevant
  relevantElements = driver.evaluate(`
    Array.from(document.querySelectorAll('[aria-label], [title], button, input, select, label'))
      .map((el, i) => ({
        id: i,
        xpath: getXPath(el),
        ariaLabel: el.getAttribute('aria-label') || el.title || '',
        text: el.textContent.substring(0, 100)
      }))
  `)

  for each elem in relevantElements:
    xpaths[elem.id] = elem.xpath
    ariaLabels[elem.id] = elem.ariaLabel
    textContent[elem.id] = elem.text

  return DomSnapshot{
    html: html,
    xpaths: xpaths,
    ariaLabels: ariaLabels,
    textContent: textContent
  }
```

**LLM Prompt (sent to llmCallback):**
```
You are an expert web automation assistant. A selector failed to find an element.

Original selectors that failed:
[JSON of originalSelectors]

Failed strategies:
[list of failedAttempts with error messages]

DOM snapshot (simplified):
[HTML of relevant elements]

ARIA labels and text content:
[key-value pairs]

Please suggest a new selector that would find the element. You can respond with:
1. A CSS selector (e.g., "button.submit-btn")
2. A JavaScript expression (e.g., "document.querySelector('button').parentElement.querySelector('input')")
3. "not found" if you don't think the element exists

Your response:
```

**Confidence:** 0.8 (high, LLM is sophisticated but may hallucinate)

## Stage 4: Human in Loop (Extension only, no timeout)

**Goal:** Ask user to click the element directly (extension feature only).

**Algorithm:**

```
function stage4_humanInLoop(context):
  if not userCallback:
    return err(HEALING_EXHAUSTED, "User callback not configured")

  // Step 1: Take screenshot
  screenshot = driver.screenshot()

  // Step 2: Call user callback
  try:
    userResponse = await userCallback(
      pageContext.url,
      screenshot,
      "Could not find element. Please click it on the page."
    )
  catch (e):
    return err(HEALING_EXHAUSTED, "User callback failed: " + e.message)

  // userResponse is a selector string (e.g., CSS or JS) that the user's click was mapped to

  // Step 3: Verify the element still exists
  elementResult = driver.findElement([{ strategy: 'css', selector: userResponse }])

  if isOk(elementResult):
    return ok(HealResult{
      element: elementResult.value,
      newSelector: [{ strategy: 'css', selector: userResponse }],
      newSelectorString: userResponse,
      confidence: 0.95,  // Very high confidence (user confirmed)
      durationMs: elapsed
    })

  return err(HEALING_EXHAUSTED)
```

**Confidence:** 0.95 (very high, user explicitly clicked)

## Error Handling

**Error code:** `HEALING_EXHAUSTED`

**Error context:**
- `source: 'healing'`
- `message: "All healing stages failed"`
- `cause.originalSelectors` — selector chain that failed
- `cause.allAttempts` — array of ResolutionAttempt from original failure

**When to escalate to healing:**
- From SelectorResolver when err(SELECTOR_NOT_FOUND)
- From FieldDefinition interaction or OutputDefinition capture
- Do NOT call healing recursively (healing itself should not call heal() again)

## Edge Cases

1. **No CSS selectors to relax:** If SelectorChain contains only aria/label/text (no CSS), skip stage 1.

2. **Selector changes after healing:** If page updates between original failure and healing attempt, new selector may also fail. Healing should accept this and return HEALING_EXHAUSTED.

3. **Multiple matching elements:** Healing may find multiple elements matching relaxed CSS. Return the first one found.

4. **LLM hallucination:** LLM may suggest a selector that doesn't exist. Driver will fail; healing returns HEALING_EXHAUSTED.

5. **Screenshot timing:** Screenshot is taken at healing time, not at original failure time. Page may have changed.

6. **Frame/iframe elements:** If element is in an iframe, healing within the iframe's context only. Cross-origin iframe elements cannot be accessed.

7. **Disabled callbacks:** If llmCallback is null, skip stage 3. If userCallback is null, skip stage 4.

8. **Timeout enforcement:** Each stage has a max timeout (500ms, 1s, 5s). If a stage exceeds timeout, treat as failed and move to next.

9. **Transient elements:** If element disappeared by the time healing is called, all stages will fail. This is correct behavior.

10. **Healing on healing failure:** Do NOT recursively call heal() from within healing. Once HEALING_EXHAUSTED, stop.

## Test Scenarios

### 1. Stage 1: Relax nth-child

**Setup:**
- Original selector: `button.submit:nth-child(2)`
- Button exists but not at nth-child(2)

**Expected:** heal() succeeds at stage 1, returns newSelector: "button.submit"

### 2. Stage 1: Relax attribute matching

**Setup:**
- Original selector: `input[data-id='exact-value']`
- Input exists with `data-id="exact-value-suffix"`

**Expected:** heal() succeeds at stage 1, returns relaxed: `input[data-id*='exact-value']`

### 3. Stage 2: Find by nearby label

**Setup:**
- Original selectors fail
- Page has `<label>Email</label><input id="email" />`
- Original selectors had text: "Email"

**Expected:** heal() succeeds at stage 2, returns JS expression that finds input by label

### 4. Stage 3: LLM suggests CSS selector

**Setup:**
- Stages 1–2 fail
- LLM callback returns: "button.action-button"
- Such button exists on page

**Expected:** heal() succeeds at stage 3, element found, confidence: 0.8

### 5. Stage 3: LLM suggests not found

**Setup:**
- Stages 1–2 fail
- LLM callback returns: "not found"

**Expected:** heal() moves to stage 4 (if enabled) or returns HEALING_EXHAUSTED

### 6. Stage 4: Human clicks element

**Setup:**
- Stages 1–3 fail or not enabled
- User callback invoked
- User clicks on element, returns CSS selector

**Expected:** heal() succeeds at stage 4, confidence: 0.95

### 7. All stages fail

**Setup:**
- All four stages unable to find element
- Element truly not on page

**Expected:** err(HEALING_EXHAUSTED)

### 8. Stage 1 takes too long

**Setup:**
- Relaxing CSS selectors takes >500ms
- Later stages may still succeed

**Expected:** Stage 1 returns timeout, proceed to stage 2

### 9. LLM callback throws

**Setup:**
- Stage 3 invoked, LLM callback throws exception

**Expected:** heal() catches, returns HEALING_EXHAUSTED (does not escalate exception)

### 10. Healing recovers element, but element disappears before return

**Setup:**
- Healing finds element successfully
- Page reloads immediately after
- HealResult.element handle becomes invalid

**Expected:** heal() still returns ok(HealResult). ExecutionEngine will detect stale handle on next use.

### 11. Selective stage execution

**Setup:**
- HealingPipeline created with llmCallback=null, userCallback=null
- All selectors fail

**Expected:** Only stages 1–2 run. Stage 3–4 skipped. Returns HEALING_EXHAUSTED.

### 12. Stage 2: DOM walk heuristic

**Setup:**
- Original selector fails
- Page has a form with label and input
- Original selectors had aria: "Email"

**Expected:** Stage 2 walks DOM from form context, finds input, returns ok(HealResult)
