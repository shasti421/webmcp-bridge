/**
 * SelectorResolver — multi-strategy element resolution.
 *
 * Tries selectors in priority order: ARIA -> Label -> Text -> CSS -> JS.
 * If all fail, returns err with SELECTOR_NOT_FOUND (healing is the Engine's job).
 */
import type { SelectorChain, SelectorStrategy, BridgeDriver, ElementHandle } from '../types/bridge-driver.js';
import type { Result } from '../types/result.js';
import type { BridgeError } from '../types/errors.js';
import { ok, err } from '../types/result.js';
import { createBridgeError } from '../types/errors.js';

export interface ResolveResult {
  element: ElementHandle;
  /** Which strategy index succeeded (0-based) */
  strategyIndex: number;
  /** Strategy name that worked */
  strategyName: string;
}

interface ResolutionAttempt {
  strategy: SelectorStrategy;
  error?: string;
  durationMs: number;
}

export class SelectorResolver {
  /**
   * Resolve an element using a chain of selector strategies.
   * Tries each strategy in order, returning the first success.
   */
  async resolve(
    selectors: SelectorChain,
    driver: BridgeDriver,
  ): Promise<Result<ResolveResult, BridgeError>> {
    if (selectors.length === 0) {
      return err(createBridgeError(
        'SELECTOR_NOT_FOUND',
        'Empty selector chain',
        'selector',
      ));
    }

    const attempts: ResolutionAttempt[] = [];

    for (let i = 0; i < selectors.length; i++) {
      const strategy = selectors[i]!;
      const startTime = Date.now();

      try {
        // Each strategy is passed as a single-element SelectorChain to findElement
        const element = await driver.findElement([strategy]);
        return ok({
          element,
          strategyIndex: i,
          strategyName: strategy.strategy,
        });
      } catch (e: unknown) {
        const durationMs = Date.now() - startTime;
        const errorMessage = e instanceof Error ? e.message : String(e);
        attempts.push({
          strategy,
          error: errorMessage,
          durationMs,
        });
      }
    }

    // All strategies failed
    const attemptDetails = attempts
      .map(a => `[${a.strategy.strategy}] ${a.error ?? 'unknown error'} (${a.durationMs}ms)`)
      .join('; ');

    return err(createBridgeError(
      'SELECTOR_NOT_FOUND',
      `Failed to resolve selectors (${selectors.length} strategies tried): ${attemptDetails}`,
      'selector',
      {
        cause: {
          attempts,
          selectorChain: selectors,
        },
      },
    ));
  }

  /**
   * Resolve and read text content from an element.
   */
  async resolveText(
    selectors: SelectorChain,
    driver: BridgeDriver,
  ): Promise<Result<string, BridgeError>> {
    const elementResult = await this.resolve(selectors, driver);

    if (!elementResult.ok) {
      return err(elementResult.error);
    }

    try {
      const text = await driver.readText(selectors);
      return ok(text);
    } catch (e: unknown) {
      return err(createBridgeError(
        'CAPTURE_FAILED',
        'Failed to read text from element',
        'selector',
        { cause: e },
      ));
    }
  }

  /**
   * Resolve and extract text via regex pattern.
   * Returns capture group 1 if present, else full match, else null.
   */
  async resolvePattern(
    selectors: SelectorChain,
    regex: string,
    driver: BridgeDriver,
  ): Promise<Result<string | null, BridgeError>> {
    const textResult = await this.resolveText(selectors, driver);

    if (!textResult.ok) {
      return err(textResult.error);
    }

    const text = textResult.value;
    const pattern = new RegExp(regex);
    const match = pattern.exec(text);

    if (!match) {
      return ok(null);
    }

    // Return first capture group if present, else full match
    if (match.length > 1 && match[1] !== undefined) {
      return ok(match[1]);
    }

    return ok(match[0]);
  }
}
