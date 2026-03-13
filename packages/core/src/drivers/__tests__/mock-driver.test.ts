import { describe, it, expect, vi } from 'vitest';

import { createMockDriver } from '../mock-driver.js';
import type { BridgeDriver, ElementHandle, SelectorChain } from '../../types/bridge-driver.js';

describe('createMockDriver', () => {
  it('returns an object implementing BridgeDriver', () => {
    const driver = createMockDriver();
    expect(driver).toBeDefined();
    expect(typeof driver.goto).toBe('function');
    expect(typeof driver.findElement).toBe('function');
    expect(typeof driver.click).toBe('function');
    expect(typeof driver.type).toBe('function');
    expect(typeof driver.readText).toBe('function');
    expect(typeof driver.readPattern).toBe('function');
    expect(typeof driver.screenshot).toBe('function');
    expect(typeof driver.evaluate).toBe('function');
    expect(typeof driver.waitFor).toBe('function');
    expect(typeof driver.getPageContext).toBe('function');
    expect(typeof driver.waitForNavigation).toBe('function');
    expect(typeof driver.doubleClick).toBe('function');
    expect(typeof driver.select).toBe('function');
    expect(typeof driver.check).toBe('function');
    expect(typeof driver.clear).toBe('function');
    expect(typeof driver.hover).toBe('function');
    expect(typeof driver.dragDrop).toBe('function');
    expect(typeof driver.uploadFile).toBe('function');
    expect(typeof driver.pressKey).toBe('function');
    expect(typeof driver.pressSequentially).toBe('function');
    expect(typeof driver.scroll).toBe('function');
    expect(typeof driver.dismissOverlay).toBe('function');
    expect(typeof driver.dispatchEvent).toBe('function');
    expect(typeof driver.switchFrame).toBe('function');
    expect(typeof driver.handleDialog).toBe('function');
    expect(typeof driver.getNamedPage).toBe('function');
    expect(typeof driver.createPage).toBe('function');
  });

  it('every method is a vitest spy', () => {
    const driver = createMockDriver();
    // All methods should be vi.fn() spies with mock metadata
    const methods: (keyof BridgeDriver)[] = [
      'goto', 'waitForNavigation', 'findElement', 'click', 'doubleClick',
      'type', 'select', 'check', 'clear', 'hover', 'dragDrop', 'uploadFile',
      'readText', 'readPattern', 'pressKey', 'pressSequentially', 'scroll',
      'dismissOverlay', 'dispatchEvent', 'switchFrame', 'handleDialog',
      'waitFor', 'screenshot', 'evaluate', 'getPageContext', 'getNamedPage',
      'createPage',
    ];
    for (const method of methods) {
      const fn = driver[method] as ReturnType<typeof vi.fn>;
      expect(fn.mock, `${method} should be a vitest spy`).toBeDefined();
    }
  });

  describe('default responses', () => {
    it('goto resolves to void', async () => {
      const driver = createMockDriver();
      await expect(driver.goto('http://example.com')).resolves.toBeUndefined();
    });

    it('findElement resolves to a branded ElementHandle', async () => {
      const driver = createMockDriver();
      const chain: SelectorChain = [{ strategy: 'css', selector: 'div' }];
      const el = await driver.findElement(chain);
      expect(el).toHaveProperty('_brand', 'ElementHandle');
    });

    it('readText resolves to empty string', async () => {
      const driver = createMockDriver();
      const chain: SelectorChain = [{ strategy: 'css', selector: 'div' }];
      const text = await driver.readText(chain);
      expect(text).toBe('');
    });

    it('readPattern resolves to null', async () => {
      const driver = createMockDriver();
      const chain: SelectorChain = [{ strategy: 'css', selector: 'div' }];
      const match = await driver.readPattern(chain, '.*');
      expect(match).toBeNull();
    });

    it('screenshot resolves to an empty Buffer', async () => {
      const driver = createMockDriver();
      const buf = await driver.screenshot();
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf.length).toBe(0);
    });

    it('evaluate resolves to undefined', async () => {
      const driver = createMockDriver();
      const result = await driver.evaluate('1+1');
      expect(result).toBeUndefined();
    });

    it('getPageContext resolves to a default PageContext', async () => {
      const driver = createMockDriver();
      const ctx = await driver.getPageContext();
      expect(ctx).toEqual({
        url: 'about:blank',
        title: '',
        readyState: 'complete',
      });
    });

    it('click resolves to void', async () => {
      const driver = createMockDriver();
      await expect(driver.click({} as ElementHandle)).resolves.toBeUndefined();
    });

    it('type resolves to void', async () => {
      const driver = createMockDriver();
      await expect(driver.type({} as ElementHandle, 'hello')).resolves.toBeUndefined();
    });

    it('dismissOverlay resolves to false', async () => {
      const driver = createMockDriver();
      const dismissed = await driver.dismissOverlay({ type: 'press_escape' });
      expect(dismissed).toBe(false);
    });

    it('handleDialog resolves to empty string', async () => {
      const driver = createMockDriver();
      const dialogText = await driver.handleDialog('accept');
      expect(dialogText).toBe('');
    });

    it('getNamedPage resolves to a branded PageHandle', async () => {
      const driver = createMockDriver();
      const page = await driver.getNamedPage('main');
      expect(page).toHaveProperty('_brand', 'PageHandle');
      expect(page).toHaveProperty('name', 'main');
    });

    it('createPage resolves to a branded PageHandle', async () => {
      const driver = createMockDriver();
      const page = await driver.createPage('new-tab');
      expect(page).toHaveProperty('_brand', 'PageHandle');
      expect(page).toHaveProperty('name', 'new-tab');
    });
  });

  describe('configurable responses via mockResolvedValue', () => {
    it('findElement can be configured to return a custom element', async () => {
      const driver = createMockDriver();
      const customEl = { _brand: 'ElementHandle' as const, myData: 'test' };
      (driver.findElement as ReturnType<typeof vi.fn>).mockResolvedValue(customEl);

      const el = await driver.findElement([{ strategy: 'css', selector: '.btn' }]);
      expect(el).toBe(customEl);
    });

    it('readText can be configured to return custom text', async () => {
      const driver = createMockDriver();
      (driver.readText as ReturnType<typeof vi.fn>).mockResolvedValue('Hello World');

      const text = await driver.readText([{ strategy: 'css', selector: 'p' }]);
      expect(text).toBe('Hello World');
    });

    it('findElement can be configured to reject', async () => {
      const driver = createMockDriver();
      (driver.findElement as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Element not found'),
      );

      await expect(
        driver.findElement([{ strategy: 'css', selector: '.missing' }]),
      ).rejects.toThrow('Element not found');
    });

    it('evaluate can be configured to return a value', async () => {
      const driver = createMockDriver();
      (driver.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(42);

      const result = await driver.evaluate('return 42');
      expect(result).toBe(42);
    });

    it('getPageContext can be customized', async () => {
      const driver = createMockDriver();
      const customCtx = { url: 'http://example.com', title: 'Example', readyState: 'complete' as const };
      (driver.getPageContext as ReturnType<typeof vi.fn>).mockResolvedValue(customCtx);

      const ctx = await driver.getPageContext();
      expect(ctx.url).toBe('http://example.com');
    });
  });

  describe('call tracking', () => {
    it('records goto calls', async () => {
      const driver = createMockDriver();
      await driver.goto('http://example.com');
      await driver.goto('http://another.com');

      const spy = driver.goto as ReturnType<typeof vi.fn>;
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledWith('http://example.com');
      expect(spy).toHaveBeenCalledWith('http://another.com');
    });

    it('records click calls with element arg', async () => {
      const driver = createMockDriver();
      const el = { _brand: 'ElementHandle' as const };
      await driver.click(el);

      const spy = driver.click as ReturnType<typeof vi.fn>;
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(el);
    });

    it('records type calls with element and text', async () => {
      const driver = createMockDriver();
      const el = { _brand: 'ElementHandle' as const };
      await driver.type(el, 'hello', { clear: true });

      const spy = driver.type as ReturnType<typeof vi.fn>;
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(el, 'hello', { clear: true });
    });
  });

  describe('overrides parameter', () => {
    it('accepts partial overrides for specific methods', async () => {
      const customGoto = vi.fn().mockResolvedValue(undefined);
      const driver = createMockDriver({ goto: customGoto });

      await driver.goto('http://custom.com');
      expect(customGoto).toHaveBeenCalledWith('http://custom.com');
    });

    it('non-overridden methods still have defaults', async () => {
      const driver = createMockDriver({ goto: vi.fn().mockResolvedValue(undefined) });
      const text = await driver.readText([{ strategy: 'css', selector: 'p' }]);
      expect(text).toBe('');
    });
  });
});
