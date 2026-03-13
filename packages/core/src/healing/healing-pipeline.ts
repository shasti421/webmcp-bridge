/**
 * HealingPipeline — self-healing selector recovery.
 *
 * 4-stage progressive healing:
 * 1. Fuzzy CSS relaxation (loosen CSS selectors)
 * 2. JS anchor walk (find by nearby labels, DOM structure)
 * 3. AI DOM analysis (LLM suggests new selector)
 * 4. Human-in-loop (extension only: user points at element)
 */
import type { SelectorChain, BridgeDriver, ElementHandle, SelectorStrategy } from '../types/bridge-driver.js';
import type { HealingConfig } from '../types/config.js';
import type { Result } from '../types/result.js';
import type { BridgeError } from '../types/errors.js';
import { ok, err } from '../types/result.js';
import { createBridgeError } from '../types/errors.js';

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
   * Runs stages 1-4 in order, returning first success.
   */
  async heal(
    originalSelectors: SelectorChain,
    fieldLabel: string,
    driver: BridgeDriver,
  ): Promise<Result<HealResult, BridgeError>> {
    // Stage 1: Fuzzy CSS match
    const stage1 = await this.stage1FuzzyMatch(originalSelectors, driver);
    if (stage1.ok) {
      return stage1;
    }

    // Stage 2: JS anchor walk
    const stage2 = await this.stage2JsAnchorWalk(originalSelectors, fieldLabel, driver);
    if (stage2.ok) {
      return stage2;
    }

    // Stage 3: AI DOM analysis
    if (this.config.aiHealing && this.aiCallback) {
      const stage3 = await this.stage3AiDomAnalysis(
        originalSelectors, fieldLabel, driver,
      );
      if (stage3.ok) {
        return stage3;
      }
    }

    // Stage 4: Human in loop
    if (this.config.humanInLoop && this.humanCallback) {
      const stage4 = await this.stage4HumanInLoop(
        originalSelectors, fieldLabel, driver,
      );
      if (stage4.ok) {
        return stage4;
      }
    }

    // All stages exhausted
    return err(createBridgeError(
      'HEALING_EXHAUSTED',
      'All healing stages failed',
      'healing',
      {
        cause: {
          originalSelectors,
        },
      },
    ));
  }

  /**
   * Stage 1: Fuzzy CSS relaxation.
   * Removes overly specific parts of CSS selectors and retries.
   */
  private async stage1FuzzyMatch(
    originalSelectors: SelectorChain,
    driver: BridgeDriver,
  ): Promise<Result<HealResult, BridgeError>> {
    const cssStrategies = originalSelectors.filter(
      (s): s is Extract<SelectorStrategy, { strategy: 'css' }> => s.strategy === 'css',
    );

    if (cssStrategies.length === 0) {
      return err(createBridgeError(
        'HEALING_EXHAUSTED',
        'No CSS selectors to relax',
        'healing',
      ));
    }

    for (const cssStrategy of cssStrategies) {
      const relaxedSelectors = relaxCssSelector(cssStrategy.selector);

      for (const relaxedSelector of relaxedSelectors) {
        try {
          const element = await driver.findElement([
            { strategy: 'css', selector: relaxedSelector },
          ]);
          const newSelector: SelectorStrategy = {
            strategy: 'css',
            selector: relaxedSelector,
          };
          return ok({
            element,
            newSelector,
            stage: 'fuzzy_match' as const,
          });
        } catch {
          // Try next relaxation
        }
      }
    }

    return err(createBridgeError(
      'HEALING_EXHAUSTED',
      'All CSS relaxations failed',
      'healing',
    ));
  }

  /**
   * Stage 2: JS anchor walk.
   * Find element by nearby label text or DOM structure heuristics.
   */
  private async stage2JsAnchorWalk(
    originalSelectors: SelectorChain,
    fieldLabel: string,
    driver: BridgeDriver,
  ): Promise<Result<HealResult, BridgeError>> {
    // Attempt 1: Find by label text from strategies or field label
    const labelText = extractLabelFromStrategies(originalSelectors) ?? fieldLabel;

    if (labelText) {
      const jsExpr = `(function() {
        var labels = Array.from(document.querySelectorAll('label'));
        var label = labels.find(function(l) { return l.textContent && l.textContent.includes('${escapeJs(labelText)}'); });
        if (!label) return null;
        var input = label.htmlFor ? document.getElementById(label.htmlFor) : label.querySelector('input, select, button, textarea');
        return input;
      })()`;

      try {
        const element = await driver.evaluate(jsExpr);
        if (element && typeof element === 'object') {
          const newSelector: SelectorStrategy = {
            strategy: 'js',
            expression: jsExpr,
          };
          return ok({
            element: element as ElementHandle,
            newSelector,
            stage: 'js_anchor_walk' as const,
          });
        }
      } catch {
        // Continue to DOM walk
      }
    }

    // Attempt 2: DOM walk heuristic using field label
    const walkExpr = `(function() {
      var key = '${escapeJs(fieldLabel)}';
      var ariaMatch = document.querySelector('[aria-label*="' + key + '"]');
      if (ariaMatch) return ariaMatch;
      var allElements = document.querySelectorAll('button, input, select, textarea, a, [role]');
      for (var i = 0; i < allElements.length; i++) {
        var el = allElements[i];
        if (el.textContent && el.textContent.toLowerCase().includes(key.toLowerCase())) {
          return el;
        }
      }
      return null;
    })()`;

    try {
      const element = await driver.evaluate(walkExpr);
      if (element && typeof element === 'object') {
        const newSelector: SelectorStrategy = {
          strategy: 'js',
          expression: walkExpr,
        };
        return ok({
          element: element as ElementHandle,
          newSelector,
          stage: 'js_anchor_walk' as const,
        });
      }
    } catch {
      // Fall through
    }

    return err(createBridgeError(
      'HEALING_EXHAUSTED',
      'JS anchor walk failed',
      'healing',
    ));
  }

  /**
   * Stage 3: AI DOM analysis.
   * Send DOM snapshot and screenshot to LLM for intelligent suggestion.
   */
  private async stage3AiDomAnalysis(
    originalSelectors: SelectorChain,
    fieldLabel: string,
    driver: BridgeDriver,
  ): Promise<Result<HealResult, BridgeError>> {
    if (!this.aiCallback) {
      return err(createBridgeError(
        'HEALING_EXHAUSTED',
        'AI callback not configured',
        'healing',
      ));
    }

    try {
      // Capture DOM snapshot
      let domSnapshot = '';
      try {
        const html = await driver.evaluate('document.documentElement.outerHTML');
        domSnapshot = typeof html === 'string' ? html : '';
      } catch {
        domSnapshot = '';
      }

      // Take screenshot
      let screenshot: Buffer;
      try {
        screenshot = await driver.screenshot();
      } catch {
        screenshot = Buffer.alloc(0);
      }

      // Call LLM
      const suggestedSelector = await this.aiCallback(
        domSnapshot, screenshot, originalSelectors, fieldLabel,
      );

      if (!suggestedSelector) {
        return err(createBridgeError(
          'HEALING_EXHAUSTED',
          'AI suggested no selector',
          'healing',
        ));
      }

      // Try the suggested selector
      const element = await driver.findElement([suggestedSelector]);
      return ok({
        element,
        newSelector: suggestedSelector,
        stage: 'ai_dom_analysis' as const,
      });
    } catch (e: unknown) {
      return err(createBridgeError(
        'HEALING_EXHAUSTED',
        `AI healing failed: ${e instanceof Error ? e.message : String(e)}`,
        'healing',
        { cause: e },
      ));
    }
  }

  /**
   * Stage 4: Human-in-loop.
   * Ask user to identify the element (extension only).
   */
  private async stage4HumanInLoop(
    _originalSelectors: SelectorChain,
    fieldLabel: string,
    driver: BridgeDriver,
  ): Promise<Result<HealResult, BridgeError>> {
    if (!this.humanCallback) {
      return err(createBridgeError(
        'HEALING_EXHAUSTED',
        'Human callback not configured',
        'healing',
      ));
    }

    try {
      const pageCtx = await driver.getPageContext();
      const suggestedSelector = await this.humanCallback(fieldLabel, pageCtx.url);

      if (!suggestedSelector) {
        return err(createBridgeError(
          'HEALING_EXHAUSTED',
          'User did not provide a selector',
          'healing',
        ));
      }

      // Try the user-provided selector
      const element = await driver.findElement([suggestedSelector]);
      return ok({
        element,
        newSelector: suggestedSelector,
        stage: 'human_in_loop' as const,
      });
    } catch (e: unknown) {
      return err(createBridgeError(
        'HEALING_EXHAUSTED',
        `Human-in-loop failed: ${e instanceof Error ? e.message : String(e)}`,
        'healing',
        { cause: e },
      ));
    }
  }
}

/**
 * Generate relaxed versions of a CSS selector.
 * Returns variants from least to most relaxed.
 */
function relaxCssSelector(selector: string): string[] {
  const relaxed: string[] = [];

  // Version 1: Remove :nth-child, :nth-of-type, :first, :last, :only
  const withoutNth = selector.replace(
    /:(nth-child|nth-of-type|first-child|last-child|first|last|only-child|only)\([^)]*\)/g,
    '',
  ).trim();
  if (withoutNth !== selector && withoutNth.length > 0) {
    relaxed.push(withoutNth);
  }

  // Version 2: Remove attribute value exact matches, use substring
  const withSubstring = (withoutNth || selector).replace(
    /\[([^\]=]+)='([^']+)'\]/g,
    '[$1*=\'$2\']',
  ).trim();
  if (withSubstring !== selector && withSubstring !== withoutNth && withSubstring.length > 0) {
    relaxed.push(withSubstring);
  }

  // Version 3: Remove class and attribute selectors, keep tag
  const tagOnly = selector
    .replace(/\.[\w-]+/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/:(nth-child|nth-of-type|first-child|last-child|first|last|only-child|only)\([^)]*\)/g, '')
    .replace(/#[\w-]+/g, '')
    .trim();
  if (tagOnly.length > 0 && tagOnly !== selector) {
    relaxed.push(tagOnly);
  }

  // Version 4: Just the tag name
  const tagMatch = selector.match(/^([a-z][a-z0-9]*)/i);
  if (tagMatch?.[1] && tagMatch[1] !== selector) {
    relaxed.push(tagMatch[1]);
  }

  return relaxed;
}

/**
 * Extract label text from selector strategies.
 */
function extractLabelFromStrategies(selectors: SelectorChain): string | undefined {
  for (const s of selectors) {
    if (s.strategy === 'label') {
      return s.text;
    }
    if (s.strategy === 'text') {
      return s.text;
    }
    if (s.strategy === 'aria' && s.name) {
      return s.name;
    }
  }
  return undefined;
}

/**
 * Escape a string for use inside JavaScript string literals.
 */
function escapeJs(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}
