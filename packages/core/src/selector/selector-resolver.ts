/**
 * SelectorResolver — multi-strategy element resolution.
 *
 * Tries selectors in priority order: ARIA → Label → Text → CSS → JS.
 * If all fail, delegates to HealingPipeline.
 *
 * Implementation notes for agents:
 * - Takes a SelectorChain (ordered list of strategies) and a BridgeDriver
 * - Tries each strategy via the driver's findElement(), readText(), etc.
 * - Returns the first successful ElementHandle
 * - On failure, returns err with SELECTOR_NOT_FOUND
 * - Logs which strategy succeeded (for analytics / healing feedback)
 * - Does NOT call the healing pipeline — that's the Engine's job
 */
import type { SelectorChain, BridgeDriver, ElementHandle } from '../types/bridge-driver.js';
import type { Result } from '../types/result.js';
import type { BridgeError } from '../types/errors.js';

export interface ResolveResult {
  element: ElementHandle;
  /** Which strategy index succeeded (0-based) */
  strategyIndex: number;
  /** Strategy name that worked */
  strategyName: string;
}

export class SelectorResolver {
  /**
   * Resolve an element using a chain of selector strategies.
   */
  async resolve(
    selectors: SelectorChain,
    driver: BridgeDriver,
  ): Promise<Result<ResolveResult, BridgeError>> {
    // TODO: Implement — try each strategy, return first success
    throw new Error('Not implemented — see spec: docs/specs/selector-resolver-spec.md');
  }

  /**
   * Resolve and read text content from an element.
   */
  async resolveText(
    selectors: SelectorChain,
    driver: BridgeDriver,
  ): Promise<Result<string, BridgeError>> {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  /**
   * Resolve and extract text via regex pattern.
   */
  async resolvePattern(
    selectors: SelectorChain,
    regex: string,
    driver: BridgeDriver,
  ): Promise<Result<string | null, BridgeError>> {
    // TODO: Implement
    throw new Error('Not implemented');
  }
}
