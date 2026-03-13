/**
 * ExecutionEngine — orchestrates tool and workflow execution.
 *
 * This is the central coordinator. It:
 * 1. Loads a ToolDefinition or WorkflowDefinition from SemanticStore
 * 2. Iterates through steps sequentially
 * 3. For each step, delegates to appropriate handler:
 *    - navigate → driver.goto() with URL template rendering
 *    - interact → SelectorResolver + driver interaction methods
 *    - capture → ResultCapturer
 *    - wait → driver.waitFor() or setTimeout
 *    - tab → driver.getNamedPage() / createPage()
 *    - evaluate_js → driver.evaluate()
 * 4. Manages variable context (captured values available as {{var}})
 * 5. On selector failure, invokes HealingPipeline
 * 6. For workflows: handles for_each loops, on_error, aggregation
 *
 * Implementation notes for agents:
 * - Use TemplateRenderer for {{variable}} substitution in step params
 * - Maintain a context Map<string, unknown> that accumulates captured values
 * - condition fields on steps: evaluate as truthy/falsy (skip step if falsy)
 * - Returns a ToolExecutionResult with all captured outputs
 */
import type { BridgeDriver } from '../types/bridge-driver.js';
import type { ToolDefinition, WorkflowDefinition } from '../types/semantic-model.js';
import type { Result } from '../types/result.js';
import type { BridgeError } from '../types/errors.js';
import type { SemanticStore } from '../semantic/semantic-store.js';
import type { SelectorResolver } from '../selector/selector-resolver.js';
import type { ResultCapturer } from '../capture/result-capturer.js';
import type { HealingPipeline } from '../healing/healing-pipeline.js';

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

export class ExecutionEngine {
  constructor(
    private store: SemanticStore,
    private selectorResolver: SelectorResolver,
    private resultCapturer: ResultCapturer,
    private healingPipeline: HealingPipeline,
  ) {}

  /**
   * Execute a tool by name with given inputs.
   */
  async executeTool(
    toolName: string,
    inputs: Record<string, unknown>,
    driver: BridgeDriver,
  ): Promise<Result<ToolExecutionResult, BridgeError>> {
    // TODO: Implement — see spec: docs/specs/execution-engine-spec.md
    throw new Error('Not implemented');
  }

  /**
   * Execute a workflow by name with given inputs.
   */
  async executeWorkflow(
    workflowName: string,
    inputs: Record<string, unknown>,
    driver: BridgeDriver,
  ): Promise<Result<WorkflowExecutionResult, BridgeError>> {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  /**
   * Get all tool schemas (for exposing to LLM as function definitions).
   */
  getToolSchemas(): Array<{ name: string; description: string; inputSchema: unknown; outputSchema?: unknown }> {
    // TODO: Implement — iterate all tools, return schema objects
    throw new Error('Not implemented');
  }
}
