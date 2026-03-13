/**
 * ResultCapturer — extracts output values from pages after actions.
 *
 * Given an OutputDefinition, tries capture strategies in order:
 * text_content, pattern_match, attribute, table.
 * Supports retry with exponential backoff and transient output polling.
 */
import type { OutputDefinition, CaptureStrategy } from '../types/semantic-model.js';
import type { SelectorChain, BridgeDriver } from '../types/bridge-driver.js';
import type { Result } from '../types/result.js';
import type { BridgeError } from '../types/errors.js';
import { ok, err } from '../types/result.js';
import { createBridgeError } from '../types/errors.js';
import type { SelectorResolver } from '../selector/selector-resolver.js';

export type CapturedValue = string | string[] | null;

export class ResultCapturer {
  constructor(private selectorResolver: SelectorResolver) {}

  /**
   * Capture an output value from the current page state.
   */
  async capture(
    output: OutputDefinition,
    driver: BridgeDriver,
  ): Promise<Result<CapturedValue, BridgeError>> {
    const captureFn = (): Promise<Result<CapturedValue, BridgeError>> =>
      this.captureStrategies(output, driver);

    // Handle transient outputs (poll until value appears)
    if (output.transient) {
      const timeoutMs = parseDuration(output.wait_timeout ?? '5s');
      return this.pollForValue(captureFn, timeoutMs);
    }

    // Handle retries with exponential backoff
    if (output.retry && output.retry > 0) {
      return this.retryWithBackoff(captureFn, output.retry + 1);
    }

    // Simple capture (no polling, no retry)
    return captureFn();
  }

  /**
   * Capture multiple outputs at once. Fails on first error (fail-fast).
   */
  async captureAll(
    outputs: OutputDefinition[],
    driver: BridgeDriver,
  ): Promise<Result<Record<string, CapturedValue>, BridgeError>> {
    const results: Record<string, CapturedValue> = {};

    for (const output of outputs) {
      const captureResult = await this.capture(output, driver);

      if (!captureResult.ok) {
        return err(captureResult.error);
      }

      results[output.id] = captureResult.value;
    }

    return ok(results);
  }

  /**
   * Try capture strategies in order. Returns first success.
   */
  private async captureStrategies(
    output: OutputDefinition,
    driver: BridgeDriver,
  ): Promise<Result<CapturedValue, BridgeError>> {
    const strategies: CaptureStrategy[] = output.capture_strategies ??
      [{ type: 'text_content', selectors: output.selectors }];

    let lastError: BridgeError | undefined;

    for (const strategy of strategies) {
      const result = await this.executeStrategy(strategy, driver);

      if (result.ok) {
        return result;
      }

      lastError = result.error;
    }

    // If only one strategy, return its specific error for better diagnostics
    if (strategies.length === 1 && lastError) {
      return err(lastError);
    }

    return err(createBridgeError(
      'CAPTURE_FAILED',
      `All ${strategies.length} capture strategies failed for output "${output.id}"`,
      'capture',
      { cause: lastError },
    ));
  }

  /**
   * Execute a single capture strategy.
   */
  private async executeStrategy(
    strategy: CaptureStrategy,
    driver: BridgeDriver,
  ): Promise<Result<CapturedValue, BridgeError>> {
    switch (strategy.type) {
      case 'text_content':
        return this.captureText(strategy.selectors, driver);
      case 'pattern_match':
        return this.capturePattern(strategy, driver);
      case 'attribute':
        return this.captureAttribute(strategy, driver);
      case 'table':
        return this.captureTable(strategy, driver);
      default:
        return err(createBridgeError(
          'CAPTURE_FAILED',
          `Unknown strategy: ${(strategy as CaptureStrategy).type}`,
          'capture',
        ));
    }
  }

  /**
   * Capture text content from an element.
   */
  private async captureText(
    selectors: SelectorChain,
    driver: BridgeDriver,
  ): Promise<Result<string, BridgeError>> {
    return this.selectorResolver.resolveText(selectors, driver);
  }

  /**
   * Capture text matching a regex pattern.
   */
  private async capturePattern(
    strategy: CaptureStrategy,
    driver: BridgeDriver,
  ): Promise<Result<string | null, BridgeError>> {
    if (!strategy.pattern) {
      return err(createBridgeError(
        'CAPTURE_FAILED',
        'Pattern strategy requires a pattern field',
        'capture',
      ));
    }

    // Validate regex before using it
    try {
      new RegExp(strategy.pattern);
    } catch (e: unknown) {
      return err(createBridgeError(
        'CAPTURE_FAILED',
        `Invalid regex pattern: ${strategy.pattern}`,
        'capture',
        { cause: e },
      ));
    }

    return this.selectorResolver.resolvePattern(strategy.selectors, strategy.pattern, driver);
  }

  /**
   * Capture an attribute value from an element.
   */
  private async captureAttribute(
    strategy: CaptureStrategy,
    driver: BridgeDriver,
  ): Promise<Result<string | null, BridgeError>> {
    if (!strategy.attribute) {
      return err(createBridgeError(
        'CAPTURE_FAILED',
        'Attribute strategy requires an attribute field',
        'capture',
      ));
    }

    const elementResult = await this.selectorResolver.resolve(strategy.selectors, driver);
    if (!elementResult.ok) {
      return err(elementResult.error);
    }

    try {
      const attrName = strategy.attribute;
      const value = await driver.evaluate(
        `document.querySelector('[data-webmcp-ref]')?.getAttribute('${attrName}')`,
      );
      return ok(value as string | null);
    } catch (e: unknown) {
      return err(createBridgeError(
        'CAPTURE_FAILED',
        `Failed to read attribute "${strategy.attribute}"`,
        'capture',
        { cause: e },
      ));
    }
  }

  /**
   * Capture table/list data as an array of row texts.
   */
  private async captureTable(
    strategy: CaptureStrategy,
    driver: BridgeDriver,
  ): Promise<Result<string[], BridgeError>> {
    // Verify element exists first
    const elementResult = await this.selectorResolver.resolve(strategy.selectors, driver);
    if (!elementResult.ok) {
      return err(elementResult.error);
    }

    try {
      const rows = await driver.evaluate(
        'Array.from(document.querySelectorAll("*")).map(el => el.textContent)',
      );
      return ok(rows as string[]);
    } catch (e: unknown) {
      return err(createBridgeError(
        'CAPTURE_FAILED',
        'Failed to capture table data',
        'capture',
        { cause: e },
      ));
    }
  }

  /**
   * Poll for a value until timeout.
   */
  private async pollForValue(
    fn: () => Promise<Result<CapturedValue, BridgeError>>,
    timeoutMs: number,
  ): Promise<Result<CapturedValue, BridgeError>> {
    const startTime = Date.now();
    const pollIntervalMs = 500;

    while (Date.now() - startTime < timeoutMs) {
      const result = await fn();

      if (result.ok) {
        return result;
      }

      await sleep(pollIntervalMs);
    }

    return err(createBridgeError(
      'CAPTURE_TIMEOUT',
      `Timeout waiting for output (${timeoutMs}ms)`,
      'capture',
    ));
  }

  /**
   * Retry with exponential backoff.
   */
  private async retryWithBackoff(
    fn: () => Promise<Result<CapturedValue, BridgeError>>,
    attempts: number,
  ): Promise<Result<CapturedValue, BridgeError>> {
    let lastError: BridgeError | undefined;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const result = await fn();

      if (result.ok) {
        return result;
      }

      lastError = result.error;

      if (attempt < attempts) {
        const backoffMs = 1000 * Math.pow(2, attempt - 1);
        await sleep(backoffMs);
      }
    }

    return err(lastError ?? createBridgeError(
      'CAPTURE_FAILED',
      'All retry attempts exhausted',
      'capture',
    ));
  }
}

/**
 * Parse duration string like "5s", "500ms" to milliseconds.
 */
function parseDuration(duration: string): number {
  const msMatch = duration.match(/^(\d+)\s*ms$/);
  if (msMatch?.[1]) {
    return parseInt(msMatch[1], 10);
  }

  const sMatch = duration.match(/^(\d+)\s*s$/);
  if (sMatch?.[1]) {
    return parseInt(sMatch[1], 10) * 1000;
  }

  // Default to 5 seconds if unparseable
  return 5000;
}

/**
 * Async sleep helper.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
