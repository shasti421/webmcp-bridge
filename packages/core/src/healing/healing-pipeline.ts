/**
 * HealingPipeline — self-healing selector recovery.
 *
 * When all selectors in a chain fail, this pipeline attempts recovery:
 * 1. Fuzzy match relaxation (loosen CSS selectors, partial text match)
 * 2. JS semantic anchor walk (find by nearby labels, structure)
 * 3. AI DOM analysis (send DOM snapshot + screenshot to LLM for selector suggestion)
 * 4. Human-in-loop (extension only: ask user to point at element)
 *
 * On successful heal:
 * - Record new selector in page YAML (if config.recordSelector)
 * - Create review request (if config.createReviewRequest)
 * - Alert team (if config.alertWebhook)
 *
 * Implementation notes for agents:
 * - AI healing is optional — requires an LLM provider callback
 * - Human-in-loop only works in extension runtime
 * - Each heal stage has a timeout (fuzzy: 500ms, JS: 1s, AI: 5s)
 * - Return the healed ElementHandle + the new SelectorStrategy that worked
 */
import type { SelectorChain, BridgeDriver, ElementHandle, SelectorStrategy } from '../types/bridge-driver.js';
import type { HealingConfig } from '../types/config.js';
import type { Result } from '../types/result.js';
import type { BridgeError } from '../types/errors.js';

export interface HealResult {
  element: ElementHandle;
  /** The new selector strategy that successfully found the element */
  newSelector: SelectorStrategy;
  /** Which healing stage succeeded */
  stage: 'fuzzy_match' | 'js_anchor_walk' | 'ai_dom_analysis' | 'human_in_loop';
}

/** Callback for AI-based healing (injected by consumer) */
export type AiHealingCallback = (
  domSnapshot: string,
  screenshot: Buffer,
  originalSelectors: SelectorChain,
  fieldLabel: string,
) => Promise<SelectorStrategy | null>;

/** Callback for human-in-loop healing (extension only) */
export type HumanHealingCallback = (
  fieldLabel: string,
  pageUrl: string,
) => Promise<SelectorStrategy | null>;

export class HealingPipeline {
  constructor(
    private config: HealingConfig,
    private aiCallback?: AiHealingCallback,
    private humanCallback?: HumanHealingCallback,
  ) {}

  /**
   * Attempt to heal a failed selector chain.
   */
  async heal(
    originalSelectors: SelectorChain,
    fieldLabel: string,
    driver: BridgeDriver,
  ): Promise<Result<HealResult, BridgeError>> {
    // TODO: Implement — see spec: docs/specs/healing-pipeline-spec.md
    throw new Error('Not implemented');
  }
}
