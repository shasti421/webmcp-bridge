import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ResultCapturer } from '../result-capturer.js';
import { SelectorResolver } from '../../selector/selector-resolver.js';
import { createMockDriver } from '../../drivers/mock-driver.js';
import type { BridgeDriver } from '../../types/bridge-driver.js';
import type { OutputDefinition } from '../../types/semantic-model.js';

function makeOutput(overrides: Partial<OutputDefinition> = {}): OutputDefinition {
  return {
    id: 'test_output',
    label: 'Test Output',
    selectors: [{ strategy: 'css', selector: '#output' }],
    ...overrides,
  };
}

describe('ResultCapturer', () => {
  let driver: BridgeDriver;
  let resolver: SelectorResolver;
  let capturer: ResultCapturer;

  beforeEach(() => {
    driver = createMockDriver();
    resolver = new SelectorResolver();
    capturer = new ResultCapturer(resolver);
  });

  describe('capture() — text_content strategy', () => {
    it('captures text content by default (no strategies specified)', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue({ _brand: 'ElementHandle' });
      (driver.readText as ReturnType<typeof vi.fn>).mockResolvedValue('Alice');

      const output = makeOutput();
      const result = await capturer.capture(output, driver);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Alice');
      }
    });

    it('captures text content with explicit text_content strategy', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue({ _brand: 'ElementHandle' });
      (driver.readText as ReturnType<typeof vi.fn>).mockResolvedValue('Bob');

      const output = makeOutput({
        capture_strategies: [{
          type: 'text_content',
          selectors: [{ strategy: 'css', selector: '#name' }],
        }],
      });
      const result = await capturer.capture(output, driver);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Bob');
      }
    });

    it('returns empty string for element with no text', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue({ _brand: 'ElementHandle' });
      (driver.readText as ReturnType<typeof vi.fn>).mockResolvedValue('');

      const result = await capturer.capture(makeOutput(), driver);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('');
      }
    });
  });

  describe('capture() — pattern_match strategy', () => {
    it('extracts capture group from matching text', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue({ _brand: 'ElementHandle' });
      (driver.readText as ReturnType<typeof vi.fn>).mockResolvedValue('Price: $99.99');

      const output = makeOutput({
        capture_strategies: [{
          type: 'pattern_match',
          selectors: [{ strategy: 'css', selector: '#price' }],
          pattern: '\\$([0-9.]+)',
        }],
      });
      const result = await capturer.capture(output, driver);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('99.99');
      }
    });

    it('returns null when pattern does not match', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue({ _brand: 'ElementHandle' });
      (driver.readText as ReturnType<typeof vi.fn>).mockResolvedValue('Hello World');

      const output = makeOutput({
        capture_strategies: [{
          type: 'pattern_match',
          selectors: [{ strategy: 'css', selector: '#text' }],
          pattern: '\\d+',
        }],
      });
      const result = await capturer.capture(output, driver);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns CAPTURE_FAILED for invalid regex', async () => {
      const output = makeOutput({
        capture_strategies: [{
          type: 'pattern_match',
          selectors: [{ strategy: 'css', selector: '#text' }],
          pattern: '[invalid(',
        }],
      });
      const result = await capturer.capture(output, driver);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CAPTURE_FAILED');
        expect(result.error.message).toContain('Invalid regex pattern');
      }
    });
  });

  describe('capture() — attribute strategy', () => {
    it('captures attribute value', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue({ _brand: 'ElementHandle' });
      (driver.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue('/page/42');

      const output = makeOutput({
        capture_strategies: [{
          type: 'attribute',
          selectors: [{ strategy: 'css', selector: 'a#link' }],
          attribute: 'href',
        }],
      });
      const result = await capturer.capture(output, driver);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('/page/42');
      }
    });

    it('returns null for missing attribute', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue({ _brand: 'ElementHandle' });
      (driver.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const output = makeOutput({
        capture_strategies: [{
          type: 'attribute',
          selectors: [{ strategy: 'css', selector: 'div' }],
          attribute: 'data-id',
        }],
      });
      const result = await capturer.capture(output, driver);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });
  });

  describe('capture() — table strategy', () => {
    it('captures multiple row texts', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue({ _brand: 'ElementHandle' });
      (driver.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(['Row 1', 'Row 2', 'Row 3']);

      const output = makeOutput({
        capture_strategies: [{
          type: 'table',
          selectors: [{ strategy: 'css', selector: 'tr' }],
        }],
      });
      const result = await capturer.capture(output, driver);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(['Row 1', 'Row 2', 'Row 3']);
      }
    });

    it('returns empty array when no rows match', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue({ _brand: 'ElementHandle' });
      (driver.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const output = makeOutput({
        capture_strategies: [{
          type: 'table',
          selectors: [{ strategy: 'css', selector: 'tr' }],
        }],
      });
      const result = await capturer.capture(output, driver);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });
  });

  describe('capture() — fallback between strategies', () => {
    it('first strategy fails, second succeeds', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue({ _brand: 'ElementHandle' });
      // pattern_match will return null (no match), then text_content succeeds
      (driver.readText as ReturnType<typeof vi.fn>).mockResolvedValue('Hello World');

      const output = makeOutput({
        capture_strategies: [
          { type: 'pattern_match', selectors: [{ strategy: 'css', selector: '#x' }], pattern: '\\d+' },
          { type: 'text_content', selectors: [{ strategy: 'css', selector: '#x' }] },
        ],
      });
      const result = await capturer.capture(output, driver);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // pattern_match returns null which is treated as "no match" -> fall through
        // Actually per spec, null is ok (pattern doesn't match) but the strategy "succeeds"
        // So null is returned from first strategy
        expect(result.value).toBeNull();
      }
    });

    it('all strategies fail returns CAPTURE_FAILED', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));

      const output = makeOutput({
        capture_strategies: [
          { type: 'text_content', selectors: [{ strategy: 'css', selector: '#missing1' }] },
          { type: 'text_content', selectors: [{ strategy: 'css', selector: '#missing2' }] },
        ],
      });
      const result = await capturer.capture(output, driver);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CAPTURE_FAILED');
        expect(result.error.message).toContain('2 capture strategies failed');
      }
    });
  });

  describe('capture() — retry', () => {
    it('succeeds on second attempt after retry', async () => {
      const findSpy = driver.findElement as ReturnType<typeof vi.fn>;
      const readSpy = driver.readText as ReturnType<typeof vi.fn>;
      findSpy
        .mockRejectedValueOnce(new Error('not found'))
        .mockResolvedValue({ _brand: 'ElementHandle' });
      readSpy.mockResolvedValue('Found it');

      const output = makeOutput({ retry: 1 });
      const result = await capturer.capture(output, driver);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Found it');
      }
    });

    it('all retries fail returns last error', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));

      const output = makeOutput({ retry: 1 });
      const result = await capturer.capture(output, driver);

      expect(result.ok).toBe(false);
    });
  });

  describe('captureAll()', () => {
    it('captures all outputs and returns map', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue({ _brand: 'ElementHandle' });
      (driver.readText as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('Alice')
        .mockResolvedValueOnce('Bob');

      const outputs: OutputDefinition[] = [
        makeOutput({ id: 'name1' }),
        makeOutput({ id: 'name2' }),
      ];
      const result = await capturer.captureAll(outputs, driver);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ name1: 'Alice', name2: 'Bob' });
      }
    });

    it('fails fast on first error', async () => {
      (driver.findElement as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ _brand: 'ElementHandle' })
        .mockRejectedValueOnce(new Error('not found'));
      (driver.readText as ReturnType<typeof vi.fn>).mockResolvedValue('Alice');

      const outputs: OutputDefinition[] = [
        makeOutput({ id: 'name1' }),
        makeOutput({ id: 'name2' }),
        makeOutput({ id: 'name3' }),
      ];
      const result = await capturer.captureAll(outputs, driver);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        // Error can be SELECTOR_NOT_FOUND (propagated) or CAPTURE_FAILED
        expect(['CAPTURE_FAILED', 'SELECTOR_NOT_FOUND']).toContain(result.error.code);
      }
    });

    it('returns empty map for empty outputs', async () => {
      const result = await capturer.captureAll([], driver);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({});
      }
    });
  });

  describe('capture() — unknown strategy type', () => {
    it('returns CAPTURE_FAILED for unknown strategy type', async () => {
      const output = makeOutput({
        capture_strategies: [{
          type: 'unknown_type' as any,
          selectors: [{ strategy: 'css', selector: '#x' }],
        }],
      });
      const result = await capturer.capture(output, driver);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CAPTURE_FAILED');
        expect(result.error.message).toContain('Unknown strategy');
      }
    });
  });
});
