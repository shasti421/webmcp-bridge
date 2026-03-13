import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SelectorResolver } from '../selector-resolver.js';
import { createMockDriver } from '../../drivers/mock-driver.js';
import type { BridgeDriver, SelectorChain, ElementHandle } from '../../types/bridge-driver.js';

describe('SelectorResolver', () => {
  let driver: BridgeDriver;
  let resolver: SelectorResolver;

  beforeEach(() => {
    driver = createMockDriver();
    resolver = new SelectorResolver();
  });

  describe('resolve()', () => {
    it('resolves with a single aria strategy', async () => {
      const el: ElementHandle = { _brand: 'ElementHandle' };
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue(el);
      const chain: SelectorChain = [{ strategy: 'aria', role: 'button', name: 'Submit' }];
      const result = await resolver.resolve(chain, driver);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.element).toBe(el);
        expect(result.value.strategyIndex).toBe(0);
        expect(result.value.strategyName).toBe('aria');
      }
    });

    it('resolves with a single css strategy', async () => {
      const el: ElementHandle = { _brand: 'ElementHandle' };
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue(el);
      const chain: SelectorChain = [{ strategy: 'css', selector: 'button.submit' }];
      const result = await resolver.resolve(chain, driver);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.strategyName).toBe('css');
      }
    });

    it('resolves with text strategy', async () => {
      const el: ElementHandle = { _brand: 'ElementHandle' };
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue(el);
      const chain: SelectorChain = [{ strategy: 'text', text: 'Hello' }];
      const result = await resolver.resolve(chain, driver);
      expect(result.ok).toBe(true);
      if (result.ok) { expect(result.value.strategyName).toBe('text'); }
    });

    it('resolves with label strategy', async () => {
      const el: ElementHandle = { _brand: 'ElementHandle' };
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue(el);
      const chain: SelectorChain = [{ strategy: 'label', text: 'Email' }];
      const result = await resolver.resolve(chain, driver);
      expect(result.ok).toBe(true);
      if (result.ok) { expect(result.value.strategyName).toBe('label'); }
    });

    it('resolves with js strategy', async () => {
      const el: ElementHandle = { _brand: 'ElementHandle' };
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue(el);
      const chain: SelectorChain = [{ strategy: 'js', expression: 'document.querySelector("button")' }];
      const result = await resolver.resolve(chain, driver);
      expect(result.ok).toBe(true);
      if (result.ok) { expect(result.value.strategyName).toBe('js'); }
    });

    it('returns SELECTOR_NOT_FOUND when strategy fails', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('No element'));
      const chain: SelectorChain = [{ strategy: 'aria', role: 'button', name: 'Cancel' }];
      const result = await resolver.resolve(chain, driver);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SELECTOR_NOT_FOUND');
        expect(result.error.source).toBe('selector');
        expect(result.error.message).toContain('1 strategies tried');
        expect(result.error.message).toContain('aria');
      }
    });

    it('falls back to second strategy when first fails', async () => {
      const el: ElementHandle = { _brand: 'ElementHandle' };
      (driver.findElement as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('No aria'))
        .mockResolvedValueOnce(el);
      const chain: SelectorChain = [
        { strategy: 'aria', role: 'button' },
        { strategy: 'css', selector: 'button.submit' },
      ];
      const result = await resolver.resolve(chain, driver);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.strategyIndex).toBe(1);
        expect(result.value.strategyName).toBe('css');
      }
    });

    it('returns error with all attempt details when all fail', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('No aria'))
        .mockRejectedValueOnce(new Error('No css'));
      const chain: SelectorChain = [
        { strategy: 'aria', role: 'button' },
        { strategy: 'css', selector: '.no-such-class' },
      ];
      const result = await resolver.resolve(chain, driver);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SELECTOR_NOT_FOUND');
        expect(result.error.message).toContain('2 strategies tried');
        expect(result.error.cause).toBeDefined();
      }
    });

    it('returns error for empty selector chain', async () => {
      const result = await resolver.resolve([], driver);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SELECTOR_NOT_FOUND');
        expect(result.error.message).toContain('Empty selector chain');
      }
    });

    it('handles 5 strategies with only last succeeding', async () => {
      const el: ElementHandle = { _brand: 'ElementHandle' };
      (driver.findElement as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('f1'))
        .mockRejectedValueOnce(new Error('f2'))
        .mockRejectedValueOnce(new Error('f3'))
        .mockRejectedValueOnce(new Error('f4'))
        .mockResolvedValueOnce(el);
      const chain: SelectorChain = [
        { strategy: 'aria', role: 'button' },
        { strategy: 'label', text: 'Submit' },
        { strategy: 'text', text: 'Submit' },
        { strategy: 'css', selector: '.btn' },
        { strategy: 'js', expression: 'document.querySelector("button")' },
      ];
      const result = await resolver.resolve(chain, driver);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.strategyIndex).toBe(4);
        expect(result.value.strategyName).toBe('js');
      }
    });

    it('records duration in error attempts', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));
      const chain: SelectorChain = [{ strategy: 'css', selector: '.x' }];
      const result = await resolver.resolve(chain, driver);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const cause = result.error.cause as { attempts: Array<{ durationMs: number }> };
        expect(cause.attempts).toHaveLength(1);
        expect(cause.attempts[0].durationMs).toBeGreaterThanOrEqual(0);
      }
    });

    it('passes single-strategy chain to findElement', async () => {
      const el: ElementHandle = { _brand: 'ElementHandle' };
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue(el);
      await resolver.resolve([{ strategy: 'css', selector: '#btn' }], driver);
      expect(driver.findElement).toHaveBeenCalledWith([{ strategy: 'css', selector: '#btn' }]);
    });
  });

  describe('resolveText()', () => {
    it('resolves and returns text content', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue({ _brand: 'ElementHandle' });
      (driver.readText as ReturnType<typeof vi.fn>).mockResolvedValue('Hello World');
      const result = await resolver.resolveText([{ strategy: 'text', text: 'Hello' }], driver);
      expect(result.ok).toBe(true);
      if (result.ok) { expect(result.value).toBe('Hello World'); }
    });

    it('returns error when element not found', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));
      const result = await resolver.resolveText([{ strategy: 'text', text: 'Bye' }], driver);
      expect(result.ok).toBe(false);
      if (!result.ok) { expect(result.error.code).toBe('SELECTOR_NOT_FOUND'); }
    });

    it('returns CAPTURE_FAILED when readText fails', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue({ _brand: 'ElementHandle' });
      (driver.readText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('readText failed'));
      const result = await resolver.resolveText([{ strategy: 'css', selector: 'p' }], driver);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CAPTURE_FAILED');
        expect(result.error.source).toBe('selector');
      }
    });

    it('returns empty string for element with no text', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue({ _brand: 'ElementHandle' });
      (driver.readText as ReturnType<typeof vi.fn>).mockResolvedValue('');
      const result = await resolver.resolveText([{ strategy: 'css', selector: 'div' }], driver);
      expect(result.ok).toBe(true);
      if (result.ok) { expect(result.value).toBe(''); }
    });
  });

  describe('resolvePattern()', () => {
    it('extracts capture group from matching text', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue({ _brand: 'ElementHandle' });
      (driver.readText as ReturnType<typeof vi.fn>).mockResolvedValue('Price: $99.99');
      const result = await resolver.resolvePattern([{ strategy: 'text', text: 'Price' }], '\\$([0-9.]+)', driver);
      expect(result.ok).toBe(true);
      if (result.ok) { expect(result.value).toBe('99.99'); }
    });

    it('returns full match when no capture group', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue({ _brand: 'ElementHandle' });
      (driver.readText as ReturnType<typeof vi.fn>).mockResolvedValue('Order #12345');
      const result = await resolver.resolvePattern([{ strategy: 'css', selector: '.order' }], '\\d+', driver);
      expect(result.ok).toBe(true);
      if (result.ok) { expect(result.value).toBe('12345'); }
    });

    it('returns null when pattern does not match', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue({ _brand: 'ElementHandle' });
      (driver.readText as ReturnType<typeof vi.fn>).mockResolvedValue('Price: $99.99');
      const result = await resolver.resolvePattern([{ strategy: 'text', text: 'Price' }], '€([0-9.]+)', driver);
      expect(result.ok).toBe(true);
      if (result.ok) { expect(result.value).toBeNull(); }
    });

    it('returns SELECTOR_NOT_FOUND when element not found', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));
      const result = await resolver.resolvePattern([{ strategy: 'css', selector: '.missing' }], '.*', driver);
      expect(result.ok).toBe(false);
      if (!result.ok) { expect(result.error.code).toBe('SELECTOR_NOT_FOUND'); }
    });

    it('handles regex with multiple groups — returns first', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue({ _brand: 'ElementHandle' });
      (driver.readText as ReturnType<typeof vi.fn>).mockResolvedValue('2024-01-15');
      const result = await resolver.resolvePattern([{ strategy: 'css', selector: '.date' }], '(\\d{4})-(\\d{2})-(\\d{2})', driver);
      expect(result.ok).toBe(true);
      if (result.ok) { expect(result.value).toBe('2024'); }
    });
  });
});
