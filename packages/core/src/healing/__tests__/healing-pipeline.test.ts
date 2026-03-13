import { describe, it, expect, vi, beforeEach } from 'vitest';

import { HealingPipeline } from '../healing-pipeline.js';
import type { AiHealingCallback, HumanHealingCallback } from '../healing-pipeline.js';
import { createMockDriver } from '../../drivers/mock-driver.js';
import type { BridgeDriver, SelectorChain, ElementHandle, SelectorStrategy } from '../../types/bridge-driver.js';
import type { HealingConfig } from '../../types/config.js';

function defaultConfig(overrides: Partial<HealingConfig> = {}): HealingConfig {
  return { aiHealing: false, humanInLoop: false, ...overrides };
}

describe('HealingPipeline', () => {
  let driver: BridgeDriver;

  beforeEach(() => {
    driver = createMockDriver();
  });

  describe('Stage 1: Fuzzy CSS match', () => {
    it('relaxes nth-child from CSS selector and finds element', async () => {
      const pipeline = new HealingPipeline(defaultConfig());
      const el: ElementHandle = { _brand: 'ElementHandle' };

      // Relaxed version succeeds on first attempt
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue(el);

      const selectors: SelectorChain = [
        { strategy: 'css', selector: 'button.submit:nth-child(2)' },
      ];

      const result = await pipeline.heal(selectors, 'Submit', driver);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stage).toBe('fuzzy_match');
        expect(result.value.element).toBe(el);
        expect(result.value.newSelector.strategy).toBe('css');
      }
    });

    it('tries multiple relaxations until one works', async () => {
      const pipeline = new HealingPipeline(defaultConfig());
      const el: ElementHandle = { _brand: 'ElementHandle' };

      (driver.findElement as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('not found'))
        .mockResolvedValueOnce(el);

      const selectors: SelectorChain = [
        { strategy: 'css', selector: "input[data-id='42']" },
      ];

      const result = await pipeline.heal(selectors, 'ID Field', driver);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stage).toBe('fuzzy_match');
      }
    });

    it('skips stage 1 when no CSS selectors in chain', async () => {
      const pipeline = new HealingPipeline(defaultConfig());

      (driver.findElement as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));
      (driver.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const selectors: SelectorChain = [
        { strategy: 'aria', role: 'button', name: 'Submit' },
      ];

      const result = await pipeline.heal(selectors, 'Submit', driver);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('HEALING_EXHAUSTED');
      }
    });
  });

  describe('Stage 2: JS anchor walk', () => {
    it('finds element by nearby label text', async () => {
      const pipeline = new HealingPipeline(defaultConfig());
      const el: ElementHandle = { _brand: 'ElementHandle' };

      // No CSS selectors -> skip stage 1
      // Stage 2 JS eval succeeds
      (driver.findElement as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));
      (driver.evaluate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(el);

      const selectors: SelectorChain = [
        { strategy: 'label', text: 'Email' },
      ];

      const result = await pipeline.heal(selectors, 'Email', driver);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stage).toBe('js_anchor_walk');
        expect(result.value.element).toBe(el);
      }
    });

    it('falls back to DOM walk heuristic using field label', async () => {
      const pipeline = new HealingPipeline(defaultConfig());
      const el: ElementHandle = { _brand: 'ElementHandle' };

      (driver.findElement as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));
      (driver.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(null)   // label search fails
        .mockResolvedValueOnce(el);    // DOM walk succeeds

      const selectors: SelectorChain = [
        { strategy: 'aria', role: 'button', name: 'Go' },
      ];

      const result = await pipeline.heal(selectors, 'Go Button', driver);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stage).toBe('js_anchor_walk');
      }
    });
  });

  describe('Stage 3: AI DOM analysis', () => {
    it('calls LLM callback and uses suggested selector', async () => {
      const suggestedSelector: SelectorStrategy = { strategy: 'css', selector: 'button.action-button' };
      const aiCallback: AiHealingCallback = vi.fn().mockResolvedValue(suggestedSelector);
      const pipeline = new HealingPipeline(
        defaultConfig({ aiHealing: true }),
        aiCallback,
      );
      const el: ElementHandle = { _brand: 'ElementHandle' };

      // .old-selector has no tag so stage 1 produces 0 relaxations.
      // Stage 2 evals return null. Stage 3 AI returns selector.
      // findElement: only called once (by stage 3 with AI selector) -> succeeds
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue(el);

      (driver.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(null)    // stage 2 label search
        .mockResolvedValueOnce(null)    // stage 2 DOM walk
        .mockResolvedValueOnce('<html></html>'); // DOM snapshot for stage 3

      (driver.screenshot as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.alloc(0));

      const selectors: SelectorChain = [
        { strategy: 'css', selector: '.old-selector' },
      ];

      const result = await pipeline.heal(selectors, 'Action', driver);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stage).toBe('ai_dom_analysis');
        expect(result.value.element).toBe(el);
      }
      expect(aiCallback).toHaveBeenCalled();
    });

    it('skips stage 3 when no AI callback configured', async () => {
      const pipeline = new HealingPipeline(defaultConfig({ aiHealing: true }));

      (driver.findElement as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));
      (driver.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await pipeline.heal(
        [{ strategy: 'aria', role: 'button' }],
        'Btn',
        driver,
      );

      expect(result.ok).toBe(false);
    });

    it('handles AI callback returning null', async () => {
      const aiCallback: AiHealingCallback = vi.fn().mockResolvedValue(null);
      const pipeline = new HealingPipeline(
        defaultConfig({ aiHealing: true }),
        aiCallback,
      );

      (driver.findElement as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));
      (driver.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('<html></html>');
      (driver.screenshot as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.alloc(0));

      const result = await pipeline.heal(
        [{ strategy: 'css', selector: '.x' }],
        'Test',
        driver,
      );

      expect(result.ok).toBe(false);
    });

    it('handles AI callback throwing error', async () => {
      const aiCallback: AiHealingCallback = vi.fn().mockRejectedValue(new Error('LLM failed'));
      const pipeline = new HealingPipeline(
        defaultConfig({ aiHealing: true }),
        aiCallback,
      );

      (driver.findElement as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));
      (driver.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('<html></html>');
      (driver.screenshot as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.alloc(0));

      const result = await pipeline.heal(
        [{ strategy: 'css', selector: '.x' }],
        'Test',
        driver,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('HEALING_EXHAUSTED');
      }
    });
  });

  describe('Stage 4: Human in loop', () => {
    it('calls human callback and uses returned selector', async () => {
      const userSelector: SelectorStrategy = { strategy: 'css', selector: '#user-clicked' };
      const humanCallback: HumanHealingCallback = vi.fn().mockResolvedValue(userSelector);
      const pipeline = new HealingPipeline(
        defaultConfig({ humanInLoop: true }),
        undefined,
        humanCallback,
      );
      const el: ElementHandle = { _brand: 'ElementHandle' };

      // .old has no tag so stage 1 produces 0 relaxations.
      // Stage 2 evals return null. Stage 4 human returns selector.
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue(el);

      (driver.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(null)  // stage 2 label
        .mockResolvedValueOnce(null); // stage 2 DOM walk

      (driver.getPageContext as ReturnType<typeof vi.fn>).mockResolvedValue({
        url: 'http://example.com',
        title: 'Test Page',
        readyState: 'complete',
      });

      const selectors: SelectorChain = [
        { strategy: 'css', selector: '.old' },
      ];

      const result = await pipeline.heal(selectors, 'Field', driver);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stage).toBe('human_in_loop');
        expect(result.value.element).toBe(el);
      }
      expect(humanCallback).toHaveBeenCalled();
    });

    it('skips stage 4 when no human callback', async () => {
      const pipeline = new HealingPipeline(defaultConfig({ humanInLoop: true }));

      (driver.findElement as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));
      (driver.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await pipeline.heal(
        [{ strategy: 'aria', role: 'button' }],
        'Btn',
        driver,
      );

      expect(result.ok).toBe(false);
    });
  });

  describe('All stages fail', () => {
    it('returns HEALING_EXHAUSTED when all stages fail', async () => {
      const pipeline = new HealingPipeline(defaultConfig());

      (driver.findElement as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));
      (driver.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const selectors: SelectorChain = [
        { strategy: 'css', selector: '.missing' },
      ];

      const result = await pipeline.heal(selectors, 'Missing', driver);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('HEALING_EXHAUSTED');
        expect(result.error.source).toBe('healing');
        expect(result.error.message).toContain('All healing stages failed');
      }
    });

    it('returns HEALING_EXHAUSTED with cause containing original selectors', async () => {
      const pipeline = new HealingPipeline(defaultConfig());

      (driver.findElement as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));
      (driver.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const selectors: SelectorChain = [
        { strategy: 'aria', role: 'button', name: 'Submit' },
        { strategy: 'css', selector: '.btn-submit' },
      ];

      const result = await pipeline.heal(selectors, 'Submit', driver);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.cause).toBeDefined();
        const cause = result.error.cause as { originalSelectors: SelectorChain };
        expect(cause.originalSelectors).toEqual(selectors);
      }
    });
  });

  describe('Selective stage execution', () => {
    it('only runs stages 1-2 when callbacks are null', async () => {
      const pipeline = new HealingPipeline(
        defaultConfig({ aiHealing: true, humanInLoop: true }),
        undefined,
        undefined,
      );

      (driver.findElement as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));
      (driver.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await pipeline.heal(
        [{ strategy: 'css', selector: '.x' }],
        'Test',
        driver,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('HEALING_EXHAUSTED');
      }
    });
  });
});
