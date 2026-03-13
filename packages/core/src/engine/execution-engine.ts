/**
 * ExecutionEngine — orchestrates tool and workflow execution.
 *
 * This is the central coordinator. It:
 * 1. Loads a ToolDefinition or WorkflowDefinition from SemanticStore
 * 2. Iterates through steps sequentially
 * 3. For each step, delegates to appropriate handler:
 *    - navigate -> driver.goto() with URL template rendering
 *    - interact -> SelectorResolver + driver interaction methods
 *    - capture -> ResultCapturer
 *    - wait -> driver.waitFor() or setTimeout
 *    - tab -> driver.getNamedPage() / createPage()
 *    - evaluate_js -> driver.evaluate()
 * 4. Manages variable context (captured values available as {{var}})
 * 5. On selector failure, invokes HealingPipeline
 * 6. For workflows: handles for_each loops, on_error, aggregation
 */
import type { BridgeDriver, ElementHandle } from '../types/bridge-driver.js';
import type {
  ToolStep,
  WorkflowStep,
  PageDefinition,
  FieldDefinition,
} from '../types/semantic-model.js';
import type { Result } from '../types/result.js';
import type { BridgeError } from '../types/errors.js';
import { ok, err } from '../types/result.js';
import { createBridgeError } from '../types/errors.js';
import type { SemanticStore } from '../semantic/semantic-store.js';
import type { SelectorResolver } from '../selector/selector-resolver.js';
import type { ResultCapturer } from '../capture/result-capturer.js';
import type { HealingPipeline } from '../healing/healing-pipeline.js';
import { TemplateRenderer } from '../utils/template-renderer.js';

export interface ToolExecutionResult {
  /** All captured output values */
  outputs: Record<string, unknown>;
  /** Whether the tool completed successfully */
  success: boolean;
  /** Steps executed (for diagnostics) */
  stepsExecuted: number;
  /** Duration in ms */
  durationMs: number;
}

export interface WorkflowExecutionResult {
  outputs: Record<string, unknown>;
  success: boolean;
  /** Results from for_each loop iterations */
  iterations?: ToolExecutionResult[];
  errors?: BridgeError[];
  durationMs: number;
}

interface ExecutionContext {
  toolName?: string;
  workflowName?: string;
  variables: Map<string, unknown>;
  currentPage?: PageDefinition;
  stepIndex: number;
  startTime: number;
}

export class ExecutionEngine {
  private templateRenderer: TemplateRenderer;

  constructor(
    private store: SemanticStore,
    private selectorResolver: SelectorResolver,
    private resultCapturer: ResultCapturer,
    private healingPipeline: HealingPipeline,
  ) {
    this.templateRenderer = new TemplateRenderer();
  }

  /**
   * Execute a tool by name with given inputs.
   */
  async executeTool(
    toolName: string,
    inputs: Record<string, unknown>,
    driver: BridgeDriver,
  ): Promise<Result<ToolExecutionResult, BridgeError>> {
    const startTime = Date.now();

    // Step 1: Load tool definition
    const tool = this.store.getTool(toolName);
    if (!tool) {
      return err(createBridgeError(
        'TOOL_NOT_FOUND',
        `Tool not found: ${toolName}`,
        'engine',
        { toolName },
      ));
    }

    // Step 2: Load initial page
    const page = this.store.getPage(tool.bridge.page);
    if (!page) {
      return err(createBridgeError(
        'PAGE_NOT_FOUND',
        `Page not found: ${tool.bridge.page}`,
        'engine',
        { toolName },
      ));
    }

    // Step 3: Initialize context
    const context: ExecutionContext = {
      toolName,
      variables: new Map(Object.entries(inputs)),
      currentPage: page,
      stepIndex: 0,
      startTime,
    };

    // Step 4: Execute each step
    const outputs: Record<string, unknown> = {};
    let stepsExecuted = 0;

    for (const step of tool.bridge.steps) {
      const stepResult = await this.executeToolStep(step, context, driver);

      stepsExecuted++;
      context.stepIndex++;

      if (!stepResult.ok) {
        return err(createBridgeError(
          stepResult.error.code,
          `Step ${context.stepIndex} failed: ${stepResult.error.message}`,
          'engine',
          { toolName, stepIndex: context.stepIndex, cause: stepResult.error },
        ));
      }

      // Store captured value
      if (stepResult.value.capturedValue !== undefined) {
        const captureKey = stepResult.value.captureKey ?? `step_${stepsExecuted}`;
        outputs[captureKey] = stepResult.value.capturedValue;
      }
    }

    // Step 5: Apply returns mapping
    let finalOutputs: Record<string, unknown>;
    if (tool.bridge.returns) {
      finalOutputs = {};
      for (const [key, valueTemplate] of Object.entries(tool.bridge.returns)) {
        finalOutputs[key] = this.templateRenderer.render(
          valueTemplate,
          context.variables,
        );
      }
    } else {
      finalOutputs = outputs;
    }

    const durationMs = Date.now() - startTime;

    return ok({
      success: true,
      outputs: finalOutputs,
      stepsExecuted,
      durationMs,
    });
  }

  /**
   * Execute a workflow by name with given inputs.
   */
  async executeWorkflow(
    workflowName: string,
    inputs: Record<string, unknown>,
    driver: BridgeDriver,
  ): Promise<Result<WorkflowExecutionResult, BridgeError>> {
    const startTime = Date.now();

    const workflow = this.store.getWorkflow(workflowName);
    if (!workflow) {
      return err(createBridgeError(
        'TOOL_NOT_FOUND',
        `Workflow not found: ${workflowName}`,
        'engine',
      ));
    }

    const context: ExecutionContext = {
      workflowName,
      variables: new Map(Object.entries(inputs)),
      stepIndex: 0,
      startTime,
    };

    let stepsExecuted = 0;
    const errors: BridgeError[] = [];

    for (const step of workflow.steps) {
      const stepResult = await this.executeWorkflowStep(step, context, driver);

      stepsExecuted++;
      context.stepIndex++;

      if (!stepResult.ok) {
        return err(createBridgeError(
          stepResult.error.code,
          `Workflow step ${context.stepIndex} failed: ${stepResult.error.message}`,
          'engine',
          { stepIndex: context.stepIndex, cause: stepResult.error },
        ));
      }
    }

    const durationMs = Date.now() - startTime;
    const outputs: Record<string, unknown> = {};
    for (const [k, v] of context.variables) {
      outputs[k] = v;
    }

    return ok({
      success: true,
      outputs,
      errors,
      durationMs,
    });
  }

  /**
   * Get all tool schemas (for exposing to LLM as function definitions).
   */
  getToolSchemas(): Array<{ name: string; description: string; inputSchema: unknown; outputSchema?: unknown }> {
    const tools = this.store.listTools();
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
    }));
  }

  // ─── Private: Tool Step Dispatch ───────────────────

  private async executeToolStep(
    step: ToolStep,
    context: ExecutionContext,
    driver: BridgeDriver,
  ): Promise<Result<{ capturedValue?: unknown; captureKey?: string }, BridgeError>> {
    const stepObj = step as unknown as Record<string, unknown>;

    // Check condition
    if ('condition' in stepObj && typeof stepObj['condition'] === 'string') {
      const condResult = this.templateRenderer.evaluateCondition(
        stepObj['condition'],
        context.variables,
      );
      if (!condResult) {
        return ok({});
      }
    }

    if ('navigate' in stepObj) {
      return this.executeNavigateStep(
        stepObj['navigate'] as { page: string; params?: Record<string, string> },
        context,
        driver,
      );
    }
    if ('interact' in stepObj) {
      return this.executeInteractStep(
        stepObj['interact'] as { field?: string; action?: string; value?: string; target?: string },
        context,
        driver,
      );
    }
    if ('capture' in stepObj) {
      return this.executeCaptureStep(
        stepObj['capture'] as { from: string; store_as: string; wait?: boolean },
        context,
        driver,
      );
    }
    if ('wait' in stepObj) {
      return this.executeWaitStep(stepObj['wait'] as number | string, driver);
    }
    if ('tab' in stepObj) {
      return this.executeTabStep(stepObj['tab'] as string, driver);
    }
    if ('auth' in stepObj) {
      return ok({});
    }
    if ('evaluate_js' in stepObj) {
      return this.executeEvaluateStep(stepObj['evaluate_js'] as string, context, driver);
    }

    return err(createBridgeError('DRIVER_ERROR', 'Unknown step type', 'engine'));
  }

  private async executeNavigateStep(
    navigate: { page: string; params?: Record<string, string> },
    context: ExecutionContext,
    driver: BridgeDriver,
  ): Promise<Result<{ capturedValue?: unknown; captureKey?: string }, BridgeError>> {
    const page = this.store.getPage(navigate.page);
    if (!page) {
      return err(createBridgeError('PAGE_NOT_FOUND', `Page not found: ${navigate.page}`, 'engine'));
    }

    context.currentPage = page;

    const urlTemplate = page.url_template ?? page.url_pattern;
    const renderVars = new Map(context.variables);
    if (navigate.params) {
      for (const [k, v] of Object.entries(navigate.params)) {
        renderVars.set(k, v);
      }
    }

    const app = this.store.getApp(page.app);
    if (app) {
      renderVars.set('app', { base_url: app.base_url });
    }

    const renderedUrl = this.templateRenderer.render(urlTemplate, renderVars);

    try {
      await driver.goto(renderedUrl);
    } catch (e: unknown) {
      return err(createBridgeError(
        'NAVIGATION_FAILED',
        `Failed to navigate to ${renderedUrl}: ${e instanceof Error ? e.message : String(e)}`,
        'engine',
      ));
    }

    try {
      await driver.waitFor({ type: 'selector', value: page.wait_for, timeout: 30000 });
    } catch {
      return err(createBridgeError(
        'NAVIGATION_TIMEOUT',
        `Timeout waiting for page ready: ${page.wait_for}`,
        'engine',
      ));
    }

    return ok({});
  }

  private async executeInteractStep(
    interact: { field?: string; action?: string; value?: string; target?: string },
    context: ExecutionContext,
    driver: BridgeDriver,
  ): Promise<Result<{ capturedValue?: unknown; captureKey?: string }, BridgeError>> {
    const fieldRef = interact.field ?? interact.target;

    if (!fieldRef) {
      return err(createBridgeError(
        'SELECTOR_NOT_FOUND',
        'No field or target specified in interact step',
        'engine',
      ));
    }

    const renderedValue = interact.value
      ? this.templateRenderer.render(interact.value, context.variables)
      : undefined;

    const field: FieldDefinition | undefined = this.store.resolveFieldRef(fieldRef);
    if (!field) {
      return err(createBridgeError(
        'SELECTOR_NOT_FOUND',
        `Field not found: ${fieldRef}`,
        'engine',
        { fieldId: fieldRef },
      ));
    }

    const resolveResult = await this.selectorResolver.resolve(field.selectors, driver);

    let element: ElementHandle;
    if (!resolveResult.ok) {
      const healResult = await this.healingPipeline.heal(
        field.selectors,
        field.label,
        driver,
      );
      if (!healResult.ok) {
        return err(createBridgeError(
          'SELECTOR_NOT_FOUND',
          `Could not find field ${fieldRef} and healing failed`,
          'engine',
          { fieldId: fieldRef, stepIndex: context.stepIndex },
        ));
      }
      element = healResult.value.element;
    } else {
      element = resolveResult.value.element;
    }

    const action = interact.action ?? field.interaction.type;

    try {
      switch (action) {
        case 'click':
          await driver.click(element);
          break;
        case 'fill':
        case 'type':
        case 'text_input':
          if (renderedValue !== undefined) {
            await driver.type(element, renderedValue);
          }
          break;
        case 'select':
          if (renderedValue !== undefined) {
            await driver.select(element, renderedValue);
          }
          break;
        case 'check':
          await driver.check(element, true);
          break;
        case 'uncheck':
          await driver.check(element, false);
          break;
        case 'clear':
          await driver.clear(element);
          break;
        case 'hover':
          await driver.hover(element);
          break;
        default:
          if (field.type === 'action_button') {
            await driver.click(element);
          }
          break;
      }
    } catch (e: unknown) {
      return err(createBridgeError(
        'DRIVER_ERROR',
        `Action "${action}" failed on field ${fieldRef}: ${e instanceof Error ? e.message : String(e)}`,
        'engine',
        { fieldId: fieldRef, stepIndex: context.stepIndex },
      ));
    }

    return ok({});
  }

  private async executeCaptureStep(
    capture: { from: string; store_as: string; wait?: boolean },
    context: ExecutionContext,
    driver: BridgeDriver,
  ): Promise<Result<{ capturedValue?: unknown; captureKey?: string }, BridgeError>> {
    const output = this.store.resolveOutputRef(capture.from);
    if (!output) {
      return err(createBridgeError(
        'CAPTURE_FAILED',
        `Output not found: ${capture.from}`,
        'engine',
      ));
    }

    if (capture.wait) {
      try {
        await driver.waitFor({ type: 'timeout', value: 500 });
      } catch {
        // Ignore wait errors
      }
    }

    const captureResult = await this.resultCapturer.capture(output, driver);
    if (!captureResult.ok) {
      return err(createBridgeError(
        captureResult.error.code,
        `Failed to capture output ${capture.from}: ${captureResult.error.message}`,
        'engine',
      ));
    }

    context.variables.set(capture.store_as, captureResult.value);

    return ok({
      capturedValue: captureResult.value,
      captureKey: capture.store_as,
    });
  }

  private async executeWaitStep(
    wait: number | string,
    driver: BridgeDriver,
  ): Promise<Result<{ capturedValue?: unknown; captureKey?: string }, BridgeError>> {
    const durationMs = typeof wait === 'number' ? wait : parseDuration(wait);
    try {
      await driver.waitFor({ type: 'timeout', value: durationMs });
    } catch {
      // Ignore
    }
    return ok({});
  }

  private async executeTabStep(
    tab: string,
    driver: BridgeDriver,
  ): Promise<Result<{ capturedValue?: unknown; captureKey?: string }, BridgeError>> {
    try {
      await driver.getNamedPage(tab);
    } catch {
      try {
        await driver.createPage(tab);
      } catch {
        return err(createBridgeError(
          'DRIVER_ERROR',
          `Failed to get or create tab: ${tab}`,
          'engine',
        ));
      }
    }
    return ok({});
  }

  private async executeEvaluateStep(
    js: string,
    context: ExecutionContext,
    driver: BridgeDriver,
  ): Promise<Result<{ capturedValue?: unknown; captureKey?: string }, BridgeError>> {
    const renderedJs = this.templateRenderer.render(js, context.variables);
    try {
      await driver.evaluate(renderedJs);
    } catch (e: unknown) {
      return err(createBridgeError(
        'DRIVER_ERROR',
        `JS evaluation failed: ${e instanceof Error ? e.message : String(e)}`,
        'engine',
      ));
    }
    return ok({});
  }

  // ─── Workflow Step Dispatch ────────────────────────

  private async executeWorkflowStep(
    step: WorkflowStep,
    context: ExecutionContext,
    driver: BridgeDriver,
  ): Promise<Result<{ capturedValue?: unknown }, BridgeError>> {
    const stepObj = step as unknown as Record<string, unknown>;

    if ('tool' in stepObj) {
      return this.executeWorkflowToolStep(
        stepObj as unknown as { tool: string; params: Record<string, string>; capture?: Record<string, string>; on_error?: string },
        context,
        driver,
      );
    }

    if ('for_each' in stepObj) {
      return this.executeWorkflowForEachStep(
        stepObj as unknown as { for_each: string; as: string; steps: WorkflowStep[]; on_error?: string },
        context,
        driver,
      );
    }

    if ('aggregate' in stepObj) {
      return this.executeWorkflowAggregateStep(
        stepObj as unknown as { aggregate: Record<string, string> },
        context,
      );
    }

    if ('auth' in stepObj) {
      return ok({});
    }

    return err(createBridgeError('DRIVER_ERROR', 'Unknown workflow step type', 'engine'));
  }

  private async executeWorkflowToolStep(
    toolStep: { tool: string; params: Record<string, string>; capture?: Record<string, string>; on_error?: string },
    context: ExecutionContext,
    driver: BridgeDriver,
  ): Promise<Result<{ capturedValue?: unknown }, BridgeError>> {
    const renderedParams: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(toolStep.params)) {
      renderedParams[k] = this.templateRenderer.render(v, context.variables);
    }

    const toolResult = await this.executeTool(toolStep.tool, renderedParams, driver);

    if (!toolResult.ok) {
      if (toolStep.on_error === 'skip') {
        return ok({});
      }
      return err(toolResult.error);
    }

    if (toolStep.capture) {
      for (const [varName, outputKey] of Object.entries(toolStep.capture)) {
        const value = toolResult.value.outputs[outputKey];
        context.variables.set(varName, value);
      }
    }

    return ok({});
  }

  private async executeWorkflowForEachStep(
    forEachStep: { for_each: string; as: string; steps: WorkflowStep[]; on_error?: string },
    context: ExecutionContext,
    driver: BridgeDriver,
  ): Promise<Result<{ capturedValue?: unknown }, BridgeError>> {
    const iterable = context.variables.get(forEachStep.for_each);

    if (!Array.isArray(iterable)) {
      return err(createBridgeError(
        'WORKFLOW_STEP_FAILED',
        `for_each variable is not an array: ${forEachStep.for_each}`,
        'engine',
      ));
    }

    for (const item of iterable) {
      context.variables.set(forEachStep.as, item);

      for (const innerStep of forEachStep.steps) {
        const innerResult = await this.executeWorkflowStep(innerStep, context, driver);

        if (!innerResult.ok) {
          if (forEachStep.on_error === 'continue') {
            break;
          }
          return err(innerResult.error);
        }
      }
    }

    return ok({});
  }

  private executeWorkflowAggregateStep(
    aggregate: { aggregate: Record<string, string> },
    context: ExecutionContext,
  ): Result<{ capturedValue?: unknown }, BridgeError> {
    for (const [key, template] of Object.entries(aggregate.aggregate)) {
      const value = this.templateRenderer.render(template, context.variables);
      context.variables.set(key, value);
    }
    return ok({});
  }
}

function parseDuration(duration: string): number {
  const msMatch = duration.match(/^(\d+)\s*ms$/);
  if (msMatch?.[1]) {
    return parseInt(msMatch[1], 10);
  }
  const sMatch = duration.match(/^(\d+)\s*s$/);
  if (sMatch?.[1]) {
    return parseInt(sMatch[1], 10) * 1000;
  }
  const num = parseInt(duration, 10);
  return isNaN(num) ? 5000 : num;
}
