/**
 * ResultCapturer — extracts output values from pages after actions.
 *
 * Responsibilities:
 * - Given an OutputDefinition, use SelectorResolver to find the element
 * - Try capture_strategies in order: text_content → pattern_match → attribute → table
 * - Handle transient outputs (toasts, alerts) with configurable wait + retry
 * - Return captured value as string or string[] (for table outputs)
 *
 * Implementation notes for agents:
 * - Uses SelectorResolver for element finding
 * - For pattern_match: use RegExp with specified group
 * - For attribute: read element attribute by name
 * - For table: extract all matching elements, return array
 * - Retry logic: if output.retry > 0, retry with backoff
 * - Transient handling: if output.transient, wait up to output.wait_timeout
 */
import type { OutputDefinition } from '../types/semantic-model.js';
import type { BridgeDriver } from '../types/bridge-driver.js';
import type { Result } from '../types/result.js';
import type { BridgeError } from '../types/errors.js';
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
    // TODO: Implement — see spec: docs/specs/result-capturer-spec.md
    throw new Error('Not implemented');
  }

  /**
   * Capture multiple outputs at once (e.g., all page outputs after an action).
   */
  async captureAll(
    outputs: OutputDefinition[],
    driver: BridgeDriver,
  ): Promise<Result<Record<string, CapturedValue>, BridgeError>> {
    // TODO: Implement
    throw new Error('Not implemented');
  }
}
