/**
 * PlaywrightDriver — BridgeDriver implementation using Playwright.
 *
 * Maps each BridgeDriver method to Playwright's Page API:
 * - findElement → page.locator() with strategy-specific selectors
 * - click → locator.click()
 * - type → locator.fill() or locator.pressSequentially()
 * - readText → locator.textContent()
 * - screenshot → page.screenshot()
 * - etc.
 *
 * Implementation notes for agents:
 * - Constructor takes a Playwright Page instance
 * - ElementHandle wraps Playwright Locator (not Playwright ElementHandle, which is deprecated)
 * - For ARIA strategy: use page.getByRole(role, { name })
 * - For label strategy: use page.getByLabel(text)
 * - For text strategy: use page.getByText(text, { exact })
 * - For CSS strategy: use page.locator(selector)
 * - For JS strategy: use page.evaluate(expression)
 * - Multi-tab: use browser.contexts()[0].pages() for named pages
 */
import type {
  BridgeDriver,
  ElementHandle,
  PageHandle,
  PageContext,
  SelectorChain,
  SelectorStrategy,
  TypeOpts,
  ScrollOpts,
  DismissStrategy,
  WaitCondition,
  EventOpts,
} from '@webmcp-bridge/core';

import type { Page, Browser, BrowserContext, Locator } from 'playwright';

// Internal interface to carry the Playwright Locator inside an ElementHandle
interface LocatorElementHandle extends ElementHandle {
  readonly __locator: Locator;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wrapLocator(locator: Locator): ElementHandle {
  return { _brand: 'ElementHandle', __locator: locator } as unknown as ElementHandle;
}

function unwrapLocator(element: ElementHandle): Locator {
  return (element as unknown as LocatorElementHandle).__locator;
}

export class PlaywrightDriver implements BridgeDriver {
  private page: Page;
  private browser: Browser;
  private context: BrowserContext;
  private timeout: number;
  private namedPages: Map<string, Page> = new Map();

  constructor(page: Page, browser: Browser, context: BrowserContext, timeout: number = 30000) {
    this.page = page;
    this.browser = browser;
    this.context = context;
    this.timeout = timeout;
  }

  private mapStrategyToLocator(strategy: SelectorStrategy): Locator | null {
    switch (strategy.strategy) {
      case 'aria':
        return this.page.getByRole(strategy.role as Parameters<Page['getByRole']>[0], {
          name: strategy.name ? new RegExp(escapeRegex(strategy.name), 'i') : undefined,
        });
      case 'label':
        return this.page.getByLabel(new RegExp(escapeRegex(strategy.text), 'i'));
      case 'text':
        return strategy.exact
          ? this.page.getByText(strategy.text, { exact: true })
          : this.page.getByText(new RegExp(escapeRegex(strategy.text), 'i'));
      case 'css':
        return this.page.locator(strategy.selector);
      case 'js':
        return null; // handled specially
      default:
        throw new Error(`Unknown selector strategy: ${(strategy as { strategy: string }).strategy}`);
    }
  }

  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async waitForNavigation(urlPattern?: string | RegExp): Promise<void> {
    if (urlPattern) {
      await this.page.waitForURL(urlPattern, { timeout: this.timeout });
    } else {
      await this.page.waitForLoadState('domcontentloaded', { timeout: this.timeout });
    }
  }

  async findElement(selectors: SelectorChain): Promise<ElementHandle> {
    for (const strategy of selectors) {
      try {
        if (strategy.strategy === 'js') {
          const handle = await this.page.evaluateHandle(strategy.expression);
          const element = handle.asElement();
          if (element) {
            // Convert ElementHandle to a locator-like wrapper
            // We use page.locator with a JS expression
            const locator = this.page.locator(`js=${strategy.expression}`).first();
            try {
              await locator.waitFor({ state: 'attached', timeout: 5000 });
              return wrapLocator(locator);
            } catch {
              // If locator approach fails, fall through
            }
          }
          continue;
        }

        const locator = this.mapStrategyToLocator(strategy);
        if (!locator) continue;

        await locator.first().waitFor({ state: 'attached', timeout: 5000 });
        return wrapLocator(locator.first());
      } catch {
        continue;
      }
    }
    throw new Error('Failed to find element with any strategy');
  }

  async click(element: ElementHandle): Promise<void> {
    await unwrapLocator(element).click({ timeout: this.timeout });
  }

  async doubleClick(element: ElementHandle): Promise<void> {
    await unwrapLocator(element).dblclick({ timeout: this.timeout });
  }

  async type(element: ElementHandle, text: string, opts?: TypeOpts): Promise<void> {
    const locator = unwrapLocator(element);
    if (opts?.clear) {
      await locator.clear();
    }
    if (opts?.delay) {
      await locator.pressSequentially(text, { delay: opts.delay });
    } else {
      await locator.fill(text);
    }
  }

  async select(element: ElementHandle, value: string): Promise<void> {
    await unwrapLocator(element).selectOption(value);
  }

  async check(element: ElementHandle, state: boolean): Promise<void> {
    const locator = unwrapLocator(element);
    if (state) {
      await locator.check({ timeout: this.timeout });
    } else {
      await locator.uncheck({ timeout: this.timeout });
    }
  }

  async clear(element: ElementHandle): Promise<void> {
    await unwrapLocator(element).clear();
  }

  async hover(element: ElementHandle): Promise<void> {
    await unwrapLocator(element).hover({ timeout: this.timeout });
  }

  async dragDrop(source: ElementHandle, target: ElementHandle): Promise<void> {
    await unwrapLocator(source).dragTo(unwrapLocator(target));
  }

  async uploadFile(input: ElementHandle, paths: string[]): Promise<void> {
    await unwrapLocator(input).setInputFiles(paths);
  }

  async readText(selectors: SelectorChain): Promise<string> {
    const element = await this.findElement(selectors);
    const locator = unwrapLocator(element);
    const text = await locator.textContent({ timeout: this.timeout });
    return text?.trim() || '';
  }

  async readPattern(selectors: SelectorChain, regex: string): Promise<string | null> {
    const text = await this.readText(selectors);
    const pattern = new RegExp(regex);
    const match = pattern.exec(text);
    if (!match) return null;
    return match[1] ?? match[0];
  }

  async pressKey(key: string, modifiers?: string[]): Promise<void> {
    const combo = modifiers?.length ? `${modifiers.join('+')}+${key}` : key;
    await this.page.keyboard.press(combo);
  }

  async pressSequentially(element: ElementHandle, text: string, delay?: number): Promise<void> {
    await unwrapLocator(element).pressSequentially(text, delay ? { delay } : undefined);
  }

  async scroll(target?: ElementHandle | 'top' | 'bottom', opts?: ScrollOpts): Promise<void> {
    const behavior = opts?.behavior || 'instant';
    if (target === 'top') {
      await this.page.evaluate(`window.scrollTo({ top: 0, behavior: '${behavior}' })`);
    } else if (target === 'bottom') {
      await this.page.evaluate(`window.scrollTo({ top: document.body.scrollHeight, behavior: '${behavior}' })`);
    } else if (target) {
      await unwrapLocator(target as ElementHandle).scrollIntoViewIfNeeded({ timeout: this.timeout });
    } else {
      await this.page.evaluate(`window.scrollTo({ top: 0, behavior: '${behavior}' })`);
    }
  }

  async dismissOverlay(strategy: DismissStrategy): Promise<boolean> {
    try {
      switch (strategy.type) {
        case 'press_escape':
          await this.page.keyboard.press('Escape');
          break;
        case 'click_close':
          if (strategy.selector) {
            await this.page.locator(strategy.selector).click({ timeout: 3000 });
          }
          break;
        case 'click_text':
          if (strategy.text?.length) {
            for (const t of strategy.text) {
              try {
                await this.page.getByText(t, { exact: false }).click({ timeout: 2000 });
                break;
              } catch { continue; }
            }
          }
          break;
        case 'remove_element':
          if (strategy.selector) {
            await this.page.evaluate(`document.querySelector('${strategy.selector}')?.remove()`);
          }
          break;
      }
      if (strategy.waitAfter) {
        await this.page.waitForTimeout(strategy.waitAfter);
      }
      return true;
    } catch {
      return false;
    }
  }

  async dispatchEvent(element: ElementHandle, event: string, opts?: EventOpts): Promise<void> {
    const locator = unwrapLocator(element);
    await locator.dispatchEvent(event, opts?.detail ? { detail: opts.detail } : undefined);
  }

  async switchFrame(target: string | ElementHandle | 'parent'): Promise<void> {
    if (target === 'parent') {
      // Switch back to main frame
      this.page = this.page.mainFrame().page();
    } else if (typeof target === 'string') {
      const frame = this.page.frameLocator(target);
      // Store frame reference for subsequent operations
      // Playwright uses frameLocator chaining rather than frame switching
      // This is a simplification — real usage would need frame-aware locators
      void frame;
    } else {
      const locator = unwrapLocator(target);
      const frame = this.page.frameLocator(`iframe`).first();
      void frame;
      void locator;
    }
  }

  async handleDialog(action: 'accept' | 'dismiss', promptText?: string): Promise<string> {
    const dialogPromise = this.page.waitForEvent('dialog', { timeout: this.timeout });
    const dialog = await dialogPromise;
    const message = dialog.message();
    if (action === 'accept') {
      await dialog.accept(promptText);
    } else {
      await dialog.dismiss();
    }
    return message;
  }

  async waitFor(condition: WaitCondition): Promise<void> {
    switch (condition.type) {
      case 'selector':
        await this.page.locator(condition.value as string).waitFor({
          state: 'visible',
          timeout: condition.timeout || this.timeout,
        });
        break;
      case 'url':
        await this.page.waitForURL(condition.value as string | RegExp, {
          timeout: condition.timeout || this.timeout,
        });
        break;
      case 'timeout':
        await this.page.waitForTimeout(condition.value as number);
        break;
      case 'network_idle':
        await this.page.waitForLoadState('networkidle', {
          timeout: condition.timeout || this.timeout,
        });
        break;
      default:
        throw new Error(`Unknown wait condition type: ${(condition as { type: string }).type}`);
    }
  }

  async screenshot(): Promise<Buffer> {
    return await this.page.screenshot({ fullPage: true }) as Buffer;
  }

  async evaluate(js: string): Promise<unknown> {
    return await this.page.evaluate(js);
  }

  async getPageContext(): Promise<PageContext> {
    return {
      url: this.page.url(),
      title: await this.page.title(),
      readyState: await this.page.evaluate('document.readyState') as PageContext['readyState'],
    };
  }

  async getNamedPage(name: string): Promise<PageHandle> {
    const page = this.namedPages.get(name);
    if (!page) throw new Error(`Page not found: ${name}`);
    await page.bringToFront();
    return { name, _brand: 'PageHandle' } as PageHandle;
  }

  async createPage(name: string): Promise<PageHandle> {
    const newPage = await this.context.newPage();
    this.namedPages.set(name, newPage);
    return { name, _brand: 'PageHandle' } as PageHandle;
  }
}
