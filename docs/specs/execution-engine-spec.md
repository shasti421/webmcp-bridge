# ExecutionEngine Specification

## Purpose

The ExecutionEngine orchestrates the execution of Tools and Workflows. It loads definitions from SemanticStore, validates inputs against JSON schemas, iterates through steps, resolves templates, invokes driver methods, and captures outputs. It is the core orchestrator that coordinates all other components.

**Key responsibilities:**
- Load and validate tool/workflow definitions
- Validate tool inputs against inputSchema
- Maintain variable context across steps
- Handle conditionals and branching
- Invoke selector resolution and result capture
- Call healing pipeline on selector failures
- Execute workflows with for_each loops
- Return structured ToolExecutionResult with outputs and diagnostics

## Data Structures

```typescript
// ─── ExecutionEngine Class ──────────────────────────────

class ExecutionEngine {
  private semanticStore: SemanticStore;
  private driver: BridgeDriver;
  private selectorResolver: SelectorResolver;
  private resultCapturer: ResultCapturer;
  private healingPipeline: HealingPipeline;
  private templateRenderer: TemplateRenderer;

  constructor(
    store: SemanticStore,
    driver: BridgeDriver,
    resolver: SelectorResolver,
    capturer: ResultCapturer,
    healer: HealingPipeline,
    renderer: TemplateRenderer
  )

  // Main execution
  executeTool(toolName: string, inputs: Record<string, unknown>): Promise<Result<ToolExecutionResult, BridgeError>>
  executeWorkflow(workflowName: string, inputs: Record<string, unknown>): Promise<Result<WorkflowExecutionResult, BridgeError>>

  // Step execution (internal)
  private executeToolStep(step: ToolStep, context: ExecutionContext): Promise<Result<StepResult, BridgeError>>
  private executeWorkflowStep(step: WorkflowStep, context: ExecutionContext): Promise<Result<StepResult, BridgeError>>
}

// ─── Execution Context ───────────────────────────────

interface ExecutionContext {
  toolName?: string;
  workflowName?: string;
  variables: Map<string, unknown>;  // Accumulated variables
  currentPage: PageDefinition;
  stepIndex: number;
  startTime: Date;
}

// ─── Execution Result ────────────────────────────────

interface ToolExecutionResult {
  success: boolean;
  outputs: Record<string, unknown>;
  stepsExecuted: number;
  durationMs: number;
  errors: BridgeError[];  // Warnings and non-fatal errors
}

interface WorkflowExecutionResult {
  success: boolean;
  aggregatedOutputs: Record<string, unknown>;
  stepsExecuted: number;
  durationMs: number;
  errors: BridgeError[];
}

interface StepResult {
  stepIndex: number;
  success: boolean;
  capturedValue?: unknown;
  error?: BridgeError;
}
```

## Algorithm: executeTool(toolName, inputs)

**Inputs:**
- `toolName: string` — name of tool to execute
- `inputs: Record<string, unknown>` — user-provided input values

**Outputs:**
- `Result<ToolExecutionResult, BridgeError>` — ok(result) with outputs and success status

**Pseudocode:**

```
function executeTool(toolName, inputs):
  startTime = now()

  // Step 1: Load tool definition
  toolResult = semanticStore.getTool(toolName)
  if isErr(toolResult):
    return err(toolResult.error with toolName)

  tool = toolResult.value

  // Step 2: Validate inputs against inputSchema
  validationResult = validateInputs(inputs, tool.inputSchema)
  if isErr(validationResult):
    return err(validationResult.error)

  // Step 3: Load initial page
  pageResult = semanticStore.getPage(tool.bridge.page)
  if isErr(pageResult):
    return err(pageResult.error)

  page = pageResult.value

  // Step 4: Navigate to page
  url = renderTemplate(page.url_template, inputs)
  navigateResult = driver.goto(url)
  if isErr(navigateResult):
    return err(createBridgeError('NAVIGATION_FAILED', ...))

  // Wait for page ready
  waitResult = driver.waitFor({ type: 'selector', value: page.wait_for, timeout: 30000 })
  if isErr(waitResult):
    return err(createBridgeError('NAVIGATION_TIMEOUT', ...))

  // Step 5: Initialize execution context
  context = ExecutionContext{
    toolName: toolName,
    variables: Map(inputs),
    currentPage: page,
    stepIndex: 0,
    startTime: startTime
  }

  // Step 6: Execute each step in tool.bridge.steps
  outputs = {}
  stepsExecuted = 0

  for each step in tool.bridge.steps:
    stepResult = executeToolStep(step, context)

    stepsExecuted++
    context.stepIndex++

    if isErr(stepResult):
      return err(BridgeError{
        code: stepResult.error.code,
        message: `Step ${context.stepIndex} failed: ${stepResult.error.message}`,
        source: 'engine',
        stepIndex: context.stepIndex,
        cause: stepResult.error
      })

    // Capture value if step produced one
    if stepResult.capturedValue:
      outputs[stepResult.stepIndex] = stepResult.capturedValue

  // Step 7: Apply returns mapping if present
  finalOutputs = {}
  if tool.bridge.returns:
    for (key, valueRef) in tool.bridge.returns:
      // valueRef is a template string like "{{variable_name}}"
      renderedValue = renderTemplate(valueRef, context.variables)
      finalOutputs[key] = renderedValue
  else:
    finalOutputs = outputs

  durationMs = now() - startTime

  return ok(ToolExecutionResult{
    success: true,
    outputs: finalOutputs,
    stepsExecuted: stepsExecuted,
    durationMs: durationMs,
    errors: []
  })
```

## Algorithm: executeToolStep(step, context)

**Inputs:**
- `step: ToolStep` — one step from tool.bridge.steps
- `context: ExecutionContext` — shared variables, current page, step index

**Outputs:**
- `Result<StepResult, BridgeError>`

**Pseudocode:**

```
function executeToolStep(step, context):
  // Check condition
  if step has condition field:
    conditionResult = templateRenderer.evaluateCondition(step.condition, context.variables)
    if not conditionResult:
      // Skip this step
      return ok(StepResult{ stepIndex: context.stepIndex, success: true })

  // Dispatch based on step type
  if step has 'navigate' field:
    return executeNavigateStep(step.navigate, context)

  else if step has 'interact' field:
    return executeInteractStep(step.interact, context)

  else if step has 'capture' field:
    return executeCaptureStep(step.capture, context)

  else if step has 'wait' field:
    return executeWaitStep(step.wait, context)

  else if step has 'tab' field:
    return executeTabStep(step.tab, context)

  else if step has 'auth' field:
    return executeAuthStep(step.auth, context)

  else if step has 'evaluate_js' field:
    return executeEvaluateStep(step.evaluate_js, context)

  else:
    return err(BridgeError{ code: 'DRIVER_ERROR', message: 'Unknown step type' })
```

## Step Handlers

### executeNavigateStep(navigate, context)

**Inputs:**
- `navigate.page: string` — page ID to navigate to
- `navigate.params?: Record<string, string>` — optional URL parameters

**Implementation:**

```
function executeNavigateStep(navigate, context):
  pageId = navigate.page
  params = navigate.params or {}

  // Load page definition
  pageResult = semanticStore.getPage(pageId)
  if isErr(pageResult):
    return err(createBridgeError('PAGE_NOT_FOUND', "Page not found: " + pageId, 'engine'))

  page = pageResult.value
  context.currentPage = page

  // Render URL with params
  urlTemplate = page.url_template or page.url_pattern
  renderedUrl = templateRenderer.renderObject(urlTemplate, { ...context.variables, ...params })

  // Navigate
  navigateResult = driver.goto(renderedUrl)
  if isErr(navigateResult):
    return err(createBridgeError('NAVIGATION_FAILED', "Failed to navigate to " + renderedUrl, 'engine'))

  // Wait for page ready
  waitResult = driver.waitFor({ type: 'selector', value: page.wait_for, timeout: 30000 })
  if isErr(waitResult):
    return err(createBridgeError('NAVIGATION_TIMEOUT', "Timeout waiting for page ready", 'engine'))

  return ok(StepResult{ stepIndex: context.stepIndex, success: true })
```

### executeInteractStep(interact, context)

**Inputs:**
- `interact.field: string` — field ID to interact with
- `interact.action?: string` — action override (e.g., "click", "type")
- `interact.value?: string` — value to fill (for text fields)
- `interact.target?: string` — target element (for interactions like drag)
- `interact.dispatch?: DispatchEvent[]` — events to dispatch
- `interact.retry?: RetryConfig` — retry configuration

**Implementation:**

```
function executeInteractStep(interact, context):
  fieldId = interact.field

  // Load field definition
  fieldResult = semanticStore.resolveFieldRef(context.currentPage.id + '.fields.' + fieldId)
  if isErr(fieldResult):
    return err(fieldResult.error with fieldId)

  field = fieldResult.value

  // Resolve selectors to element
  resolverResult = selectorResolver.resolve(field.selectors)

  if isErr(resolverResult):
    // Attempt healing
    healingResult = healingPipeline.heal(field.selectors, [resolverResult.error], driver.getPageContext())

    if isErr(healingResult):
      return err(createBridgeError(
        'SELECTOR_NOT_FOUND',
        "Could not find field " + fieldId + " and healing failed",
        'engine',
        { fieldId: fieldId, stepIndex: context.stepIndex }
      ))

    element = healingResult.value.element
  else:
    element = resolverResult.value

  // Execute interaction
  action = interact.action or field.interaction.type
  value = interact.value or null

  actionResult = switch(action):
    case 'click':
      driver.click(element)
    case 'type':
      driver.type(element, value)
    case 'select':
      driver.select(element, value)
    case 'check':
      driver.check(element, true)
    case 'uncheck':
      driver.check(element, false)
    case 'clear':
      driver.clear(element)
    case 'hover':
      driver.hover(element)
    default:
      err(DRIVER_ERROR, "Unknown action: " + action)

  if isErr(actionResult):
    return err(actionResult.error with fieldId)

  // Dispatch events if specified
  if interact.dispatch:
    for each evt in interact.dispatch:
      dispatchResult = driver.dispatchEvent(element, evt.event, { bubbles: evt.bubbles })
      if isErr(dispatchResult):
        return err(dispatchResult.error)

  return ok(StepResult{ stepIndex: context.stepIndex, success: true })
```

### executeCaptureStep(capture, context)

**Inputs:**
- `capture.from: string` — output ID to capture from
- `capture.store_as: string` — variable name to store captured value
- `capture.wait?: boolean` — if true, wait for output before capturing
- `capture.on_failure?: boolean` — if true, capture even if previous steps failed

**Implementation:**

```
function executeCaptureStep(capture, context):
  outputId = capture.from
  varName = capture.store_as

  // Load output definition
  outputResult = semanticStore.resolveOutputRef(context.currentPage.id + '.outputs.' + outputId)
  if isErr(outputResult):
    return err(outputResult.error)

  output = outputResult.value

  // Capture the output
  captureResult = resultCapturer.capture(output, context.variables)

  if isErr(captureResult):
    return err(createBridgeError(
      captureResult.error.code,
      "Failed to capture output " + outputId,
      'engine'
    ))

  value = captureResult.value

  // Store in context
  context.variables.set(varName, value)

  return ok(StepResult{
    stepIndex: context.stepIndex,
    success: true,
    capturedValue: value
  })
```

### executeWaitStep(wait, context)

**Inputs:**
- `wait: number | string` — duration in ms, or duration string "5s", "500ms"

**Implementation:**

```
function executeWaitStep(wait, context):
  durationMs = parseDuration(wait)  // "5s" → 5000

  driver.waitFor({ type: 'timeout', value: durationMs })

  return ok(StepResult{ stepIndex: context.stepIndex, success: true })
```

### executeTabStep(tab, context)

**Inputs:**
- `tab: string` — named tab identifier

**Implementation:**

```
function executeTabStep(tab, context):
  tabName = tab

  // Get or create named page/tab
  tabResult = driver.getNamedPage(tabName)

  if isErr(tabResult):
    // Create new tab if not exists
    createResult = driver.createPage(tabName)
    if isErr(createResult):
      return err(createResult.error)
    tabHandle = createResult.value
  else:
    tabHandle = tabResult.value

  // Bring to front
  driver.bringToFront(tabHandle)

  return ok(StepResult{ stepIndex: context.stepIndex, success: true })
```

### executeAuthStep(auth, context)

**Inputs:**
- `auth: string` — authentication method reference

**Implementation:**

```
function executeAuthStep(auth, context):
  // This is a placeholder for auth handling
  // In practice, would load auth config from app definition
  // and execute login flow if not authenticated

  // For now: no-op or validation
  return ok(StepResult{ stepIndex: context.stepIndex, success: true })
```

### executeEvaluateStep(evaluateJs, context)

**Inputs:**
- `evaluateJs: string` — JavaScript expression to evaluate

**Implementation:**

```
function executeEvaluateStep(evaluateJs, context):
  renderedJs = templateRenderer.render(evaluateJs, context.variables)

  evalResult = driver.evaluate(renderedJs)

  if isErr(evalResult):
    return err(createBridgeError('DRIVER_ERROR', "JS evaluation failed: " + evalResult.error.message, 'engine'))

  return ok(StepResult{ stepIndex: context.stepIndex, success: true })
```

## Algorithm: executeWorkflow(workflowName, inputs)

**Inputs:**
- `workflowName: string` — workflow to execute
- `inputs: Record<string, unknown>` — input parameters

**Outputs:**
- `Result<WorkflowExecutionResult, BridgeError>`

**Pseudocode:**

```
function executeWorkflow(workflowName, inputs):
  startTime = now()

  // Step 1: Load workflow definition
  workflowResult = semanticStore.getWorkflow(workflowName)
  if isErr(workflowResult):
    return err(workflowResult.error)

  workflow = workflowResult.value

  // Step 2: Validate inputs
  validationResult = validateWorkflowInputs(inputs, workflow.input)
  if isErr(validationResult):
    return err(validationResult.error)

  // Step 3: Initialize context
  context = ExecutionContext{
    workflowName: workflowName,
    variables: Map(inputs),
    stepIndex: 0,
    startTime: startTime
  }

  // Step 4: Execute workflow steps
  stepsExecuted = 0

  for each step in workflow.steps:
    stepResult = executeWorkflowStep(step, context)

    stepsExecuted++
    context.stepIndex++

    if isErr(stepResult):
      return err(BridgeError{
        code: stepResult.error.code,
        message: "Workflow step failed: " + stepResult.error.message,
        source: 'engine',
        stepIndex: context.stepIndex
      })

  // Step 5: Aggregate outputs
  aggregatedOutputs = context.variables

  durationMs = now() - startTime

  return ok(WorkflowExecutionResult{
    success: true,
    aggregatedOutputs: aggregatedOutputs,
    stepsExecuted: stepsExecuted,
    durationMs: durationMs,
    errors: []
  })
```

## Algorithm: executeWorkflowStep(step, context)

**Inputs:**
- `step: WorkflowStep` — tool, for_each, or aggregate step
- `context: ExecutionContext`

**Outputs:**
- `Result<StepResult, BridgeError>`

**Pseudocode:**

```
function executeWorkflowStep(step, context):
  if step has 'tool' field:
    return executeWorkflowToolStep(step.tool, context)

  else if step has 'for_each' field:
    return executeWorkflowForEachStep(step.for_each, context)

  else if step has 'aggregate' field:
    return executeWorkflowAggregateStep(step.aggregate, context)

  else:
    return err(BridgeError{ code: 'DRIVER_ERROR', message: 'Unknown workflow step type' })
```

### executeWorkflowToolStep(toolStep, context)

**Inputs:**
- `toolStep.tool: string` — tool name
- `toolStep.params: Record<string, string>` — parameters (templates)
- `toolStep.capture?: Record<string, string>` — output mapping
- `toolStep.on_error?: 'skip' | WorkflowToolStep` — error handling

**Implementation:**

```
function executeWorkflowToolStep(toolStep, context):
  // Render params using context
  renderedParams = templateRenderer.renderObject(toolStep.params, context.variables)

  // Execute tool
  toolResult = executeTool(toolStep.tool, renderedParams)

  if isErr(toolResult):
    // Handle error
    if toolStep.on_error == 'skip':
      return ok(StepResult{ stepIndex: context.stepIndex, success: true })
    else if toolStep.on_error is a step:
      return executeWorkflowToolStep(toolStep.on_error, context)
    else:
      return err(toolResult.error)

  result = toolResult.value

  // Capture outputs
  if toolStep.capture:
    for (varName, outputKey) in toolStep.capture:
      value = result.outputs[outputKey]
      context.variables.set(varName, value)

  return ok(StepResult{ stepIndex: context.stepIndex, success: true })
```

### executeWorkflowForEachStep(forEachStep, context)

**Inputs:**
- `forEachStep.for_each: string` — variable name (template) — array to iterate
- `forEachStep.as: string` — loop variable name
- `forEachStep.steps: WorkflowStep[]` — steps to repeat
- `forEachStep.on_error?: 'continue' | 'stop'` — on iteration error

**Implementation:**

```
function executeWorkflowForEachStep(forEachStep, context):
  iterableRef = forEachStep.for_each
  loopVar = forEachStep.as

  // Resolve iterable from context
  iterable = context.variables.get(iterableRef)

  if not isArray(iterable):
    return err(BridgeError{
      code: 'WORKFLOW_STEP_FAILED',
      message: "for_each variable is not an array: " + iterableRef
    })

  // Iterate
  for each item in iterable:
    // Set loop variable
    context.variables.set(loopVar, item)

    // Execute inner steps
    for each innerStep in forEachStep.steps:
      innerResult = executeWorkflowStep(innerStep, context)

      if isErr(innerResult):
        if forEachStep.on_error == 'skip':
          // Skip this iteration and continue
          break
        else:
          // Stop iteration
          return err(innerResult.error)

  return ok(StepResult{ stepIndex: context.stepIndex, success: true })
```

### executeWorkflowAggregateStep(aggregate, context)

**Inputs:**
- `aggregate: Record<string, string>` — output mapping (templates)

**Implementation:**

```
function executeWorkflowAggregateStep(aggregate, context):
  // Render each template and store result
  for (outputKey, template) in aggregate:
    value = templateRenderer.render(template, context.variables)
    context.variables.set(outputKey, value)

  return ok(StepResult{ stepIndex: context.stepIndex, success: true })
```

## Error Handling

All errors include:
- `code: BridgeErrorCode` — specific error type
- `source: 'engine'` — indicates execution engine error
- `stepIndex: number` — which step failed
- `message` — human-readable with context

**Common error codes:**
- `TOOL_NOT_FOUND` — tool definition not found
- `PAGE_NOT_FOUND` — page definition not found
- `NAVIGATION_FAILED` — driver.goto() failed
- `NAVIGATION_TIMEOUT` — page didn't reach ready state
- `SELECTOR_NOT_FOUND` — element not found (and healing failed)
- `CAPTURE_FAILED` — output capture failed
- `SCHEMA_VALIDATION_ERROR` — inputs don't match schema
- `WORKFLOW_STEP_FAILED` — workflow step error

## Edge Cases

1. **Empty tool steps:** If tool has no steps, execution succeeds with no outputs.

2. **Circular tool references:** If tool A calls tool B which calls tool A, avoid infinite loops by tracking execution stack. Return err(WORKFLOW_STEP_FAILED).

3. **Missing URL template:** If page has no url_template, use url_pattern as fallback.

4. **Undefined variable in template:** If template references undefined variable, render as empty string or null.

5. **Conditional skip:** If step condition evaluates to falsy, skip the step. Don't error.

6. **Empty capture value:** If capture returns null/empty, store that value (don't error).

7. **for_each on non-array:** If for_each variable is not an array, return err(WORKFLOW_STEP_FAILED).

8. **Healing timeout:** If healing takes longer than expected, escalate as SELECTOR_NOT_FOUND.

9. **Page navigation with frames:** If page has iframes, current frame context is maintained across steps.

10. **Output override:** If multiple steps capture to same variable name, last one wins.

## Test Scenarios

### 1. Execute simple tool with one field

**Setup:** Tool with single interact step, then capture step.

**Expected:** ok(ToolExecutionResult) with outputs.

### 2. Execute tool with invalid inputs

**Setup:** Inputs don't match inputSchema.

**Expected:** err(SCHEMA_VALIDATION_ERROR).

### 3. Execute tool with navigation failure

**Setup:** First step navigates to invalid URL.

**Expected:** err(NAVIGATION_FAILED) with stepIndex: 1.

### 4. Execute tool with selector failure and healing success

**Setup:** Field selector fails, healing stage 2 succeeds.

**Expected:** ok(ToolExecutionResult) with field interacted.

### 5. Execute tool with healing exhausted

**Setup:** Selector fails, all healing stages fail.

**Expected:** err(SELECTOR_NOT_FOUND) with healing details.

### 6. Execute workflow with for_each loop

**Setup:** Workflow with for_each over array of items.

**Expected:** ok(WorkflowExecutionResult) with all iterations completed.

### 7. Execute workflow with error in loop item

**Setup:** for_each with on_error: 'continue'.

**Expected:** Skip failed item, continue with rest.

### 8. Execute workflow with conditional step

**Setup:** Tool step with condition that evaluates to false.

**Expected:** Step skipped, execution continues.

### 9. Execute workflow with aggregate step

**Setup:** Aggregate step combines multiple variables.

**Expected:** New output variable created with aggregated value.

### 10. Variable context accumulation

**Setup:** Multiple capture steps in tool.

**Expected:** All captured values available in subsequent steps via {{variable_name}}.

### 11. Template rendering in navigate step

**Setup:** Navigate with params: { page_id: "{{record_id}}" }.

**Expected:** URL rendered with captured record_id value.

### 12. Multi-step workflow with tool chaining

**Setup:** Workflow calls tool A, captures output, passes to tool B.

**Expected:** ok(WorkflowExecutionResult) with outputs from both tools available.

### 13. Tool with multiple capture steps

**Setup:** Tool captures 3 different outputs.

**Expected:** All 3 captured values in outputs.

### 14. Interact step with custom action

**Setup:** Interact step with action override: "click".

**Expected:** Field clicked instead of default interaction.

### 15. Execute tool with page change mid-execution

**Setup:** Tool navigates to page A, then page B.

**Expected:** context.currentPage updated, subsequent steps use page B.

### 16. Tool with JS evaluation step

**Setup:** Tool includes evaluate_js step with template.

**Expected:** JS evaluated with context variables, no error.
