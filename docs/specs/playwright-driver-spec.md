# PlaywrightDriver Specification

## Purpose

The PlaywrightDriver is a concrete implementation of the BridgeDriver interface for Playwright (both TypeScript/Node.js and Python). It translates abstract selector strategies into Playwright locator chains and implements all browser automation methods.

**Key responsibilities:**
- Map abstract selector strategies to Playwright locators
- Implement element finding, interaction, reading, and navigation
- Support multi-tab/page management
- Handle waits, timeouts, and dialogs
- Provide diagnostics (screenshots, page state)
- Ensure consistent error handling and reporting

## Implementation: TypeScript Version

### Class Structure

```typescript
class PlaywrightDriver implements BridgeDriver {
  private page: Page;
  private browser: Browser;
  private context: BrowserContext;
  private namedPages: Map<string, Page>;
  private timeout: number = 30000;  // 30s default

  constructor(
    page: Page,
    browser: Browser,
    context: BrowserContext,
    timeout?: number
  )

  // Navigation
  async goto(url: string): Promise<void>
  async waitForNavigation(urlPattern?: string | RegExp): Promise<void>

  // Element discovery
  async findElement(selectors: SelectorChain): Promise<ElementHandle>

  // Interactions
  async click(element: ElementHandle): Promise<void>
  async doubleClick(element: ElementHandle): Promise<void>
  async type(element: ElementHandle, text: string, opts?: TypeOpts): Promise<void>
  async select(element: ElementHandle, value: string): Promise<void>
  async check(element: ElementHandle, state: boolean): Promise<void>
  async clear(element: ElementHandle): Promise<void>
  async hover(element: ElementHandle): Promise<void>
  async dragDrop(source: ElementHandle, target: ElementHandle): Promise<void>
  async uploadFile(input: ElementHandle, paths: string[]): Promise<void>

  // Reading
  async readText(selectors: SelectorChain): Promise<string>
  async readPattern(selectors: SelectorChain, regex: string): Promise<string | null>

  // Keyboard
  async pressKey(key: string, modifiers?: string[]): Promise<void>
  async pressSequentially(element: ElementHandle, text: string, delay?: number): Promise<void>

  // Scrolling
  async scroll(target?: ElementHandle | 'top' | 'bottom', opts?: ScrollOpts): Promise<void>

  // Overlays
  async dismissOverlay(strategy: DismissStrategy): Promise<boolean>

  // Events
  async dispatchEvent(element: ElementHandle, event: string, opts?: EventOpts): Promise<void>

  // Frames
  async switchFrame(target: string | ElementHandle | 'parent'): Promise<void>

  // Dialogs
  async handleDialog(action: 'accept' | 'dismiss', promptText?: string): Promise<string>

  // Waiting
  async waitFor(condition: WaitCondition): Promise<void>

  // Diagnostics
  async screenshot(): Promise<Buffer>

  // JS escape hatch
  async evaluate(js: string): Promise<unknown>

  // Context
  async getPageContext(): Promise<PageContext>

  // Multi-tab
  async getNamedPage(name: string): Promise<PageHandle>
  async createPage(name: string): Promise<PageHandle>

  // Internal helpers
  private mapStrategyToLocator(strategy: SelectorStrategy): Locator
  private unwrapElementHandle(element: ElementHandle): any  // Unwrap from wrapper
  private wrapElement(locator: Locator): ElementHandle     // Wrap in ElementHandle
}
```

### Strategy Mapping

```typescript
private mapStrategyToLocator(strategy: SelectorStrategy): Locator {
  switch (strategy.strategy) {
    case 'aria':
      return this.page.getByRole(strategy.role, {
        name: strategy.name ? new RegExp(escapeRegex(strategy.name), 'i') : undefined,
        exact: false
      });

    case 'label':
      if (strategy.scope) {
        const scopeLocator = this.page.locator(strategy.scope);
        return scopeLocator.locator('label').filter({
          hasText: new RegExp(escapeRegex(strategy.text), 'i')
        }).first();
      }
      return this.page.getByLabel(new RegExp(escapeRegex(strategy.text), 'i'));

    case 'text':
      if (strategy.exact) {
        return this.page.getByText(strategy.text, { exact: true });
      } else {
        return this.page.getByText(new RegExp(escapeRegex(strategy.text), 'i'));
      }

    case 'css':
      return this.page.locator(strategy.selector);

    case 'js':
      // JS strategy: create a pseudo-locator wrapper
      // Not directly supported by Playwright; use evaluate instead
      return null;  // Handled specially in resolve()

    default:
      throw new Error(`Unknown selector strategy: ${strategy.strategy}`);
  }
}

private escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

### Algorithm: findElement(selectors)

**Inputs:**
- `selectors: SelectorChain` — array of selector strategies

**Outputs:**
- `ElementHandle` — wrapper around Playwright locator/element
- Throws error if all strategies fail

**Implementation:**

```typescript
async findElement(selectors: SelectorChain): Promise<ElementHandle> {
  for (const strategy of selectors) {
    try {
      if (strategy.strategy === 'js') {
        // Special handling for JS
        const element = await this.page.evaluate(strategy.expression);
        if (element) {
          return this.wrapElement(element);
        }
      } else {
        const locator = this.mapStrategyToLocator(strategy);

        // Wait for element to be visible/attached
        await locator.first().waitFor({ state: 'attached', timeout: this.timeout });

        return this.wrapElement(locator.first());
      }
    } catch (error) {
      // Strategy failed, try next
      continue;
    }
  }

  throw new Error(`Failed to find element with any strategy`);
}
```

### Algorithm: click(element)

```typescript
async click(element: ElementHandle): Promise<void> {
  const locator = this.unwrapElementHandle(element);
  await locator.click({ timeout: this.timeout });
}
```

### Algorithm: type(element, text, opts?)

```typescript
async type(element: ElementHandle, text: string, opts?: TypeOpts): Promise<void> {
  const locator = this.unwrapElementHandle(element);

  if (opts?.clear) {
    await locator.clear();
  }

  if (opts?.delay) {
    // Type with delay between keystrokes
    for (const char of text) {
      await locator.type(char, { delay: opts.delay });
    }
  } else {
    // Fast fill
    await locator.fill(text);
  }
}
```

### Algorithm: select(element, value)

```typescript
async select(element: ElementHandle, value: string): Promise<void> {
  const locator = this.unwrapElementHandle(element);

  // Supports <select> elements
  await locator.selectOption(value);
}
```

### Algorithm: readText(selectors)

```typescript
async readText(selectors: SelectorChain): Promise<string> {
  const element = await this.findElement(selectors);
  const locator = this.unwrapElementHandle(element);

  const text = await locator.textContent();
  return text?.trim() || '';
}
```

### Algorithm: readPattern(selectors, regex)

```typescript
async readPattern(selectors: SelectorChain, regex: string): Promise<string | null> {
  const text = await this.readText(selectors);

  const pattern = new RegExp(regex);
  const match = pattern.exec(text);

  if (!match) {
    return null;
  }

  // Return first capture group if present, else full match
  return match[1] ?? match[0];
}
```

### Algorithm: goto(url)

```typescript
async goto(url: string): Promise<void> {
  try {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    throw new Error(`Navigation failed: ${error.message}`);
  }
}
```

### Algorithm: waitFor(condition)

```typescript
async waitFor(condition: WaitCondition): Promise<void> {
  switch (condition.type) {
    case 'selector':
      await this.page.locator(condition.value as string).waitFor({
        state: 'visible',
        timeout: condition.timeout || this.timeout
      });
      break;

    case 'url':
      await this.page.waitForURL(condition.value as RegExp | string, {
        timeout: condition.timeout || this.timeout
      });
      break;

    case 'timeout':
      await this.page.waitForTimeout(condition.value as number);
      break;

    case 'network_idle':
      await this.page.waitForLoadState('networkidle', {
        timeout: condition.timeout || this.timeout
      });
      break;

    default:
      throw new Error(`Unknown wait condition type: ${condition.type}`);
  }
}
```

### Algorithm: screenshot()

```typescript
async screenshot(): Promise<Buffer> {
  return await this.page.screenshot({ fullPage: true });
}
```

### Algorithm: evaluate(js)

```typescript
async evaluate(js: string): Promise<unknown> {
  try {
    return await this.page.evaluate(js);
  } catch (error) {
    throw new Error(`JS evaluation failed: ${error.message}`);
  }
}
```

### Algorithm: Multi-tab Management

```typescript
private namedPages: Map<string, Page>;

async getNamedPage(name: string): Promise<PageHandle> {
  const page = this.namedPages.get(name);
  if (page) {
    await page.bringToFront();
    return page as PageHandle;
  }
  throw new Error(`Page not found: ${name}`);
}

async createPage(name: string): Promise<PageHandle> {
  const newPage = await this.context.newPage();
  this.namedPages.set(name, newPage);
  return newPage as PageHandle;
}
```

## Implementation: Python Version

The Python implementation mirrors the TypeScript version using `playwright.sync_api`:

```python
from playwright.sync_api import sync_playwright, Page, Browser, BrowserContext, Locator
from typing import Optional, Dict, List, Any, Union
import re
import json

class PlaywrightDriver:
    def __init__(
        self,
        page: Page,
        browser: Browser,
        context: BrowserContext,
        timeout: int = 30000
    ):
        self.page = page
        self.browser = browser
        self.context = context
        self.timeout = timeout
        self.named_pages: Dict[str, Page] = {}

    def goto(self, url: str) -> None:
        """Navigate to URL"""
        try:
            self.page.goto(url, wait_until='domcontentloaded')
        except Exception as e:
            raise RuntimeError(f"Navigation failed: {str(e)}")

    def find_element(self, selectors: List[Dict[str, Any]]) -> Any:
        """Find element using selector chain"""
        for strategy in selectors:
            try:
                if strategy['strategy'] == 'aria':
                    locator = self.page.get_by_role(
                        strategy['role'],
                        name=re.compile(strategy.get('name', ''), re.IGNORECASE) if strategy.get('name') else None
                    )
                    locator.first.wait_for(state='attached', timeout=self.timeout)
                    return locator.first

                elif strategy['strategy'] == 'label':
                    text_pattern = re.compile(strategy['text'], re.IGNORECASE)
                    locator = self.page.get_by_label(text_pattern)
                    locator.first.wait_for(state='attached', timeout=self.timeout)
                    return locator.first

                elif strategy['strategy'] == 'text':
                    exact = strategy.get('exact', False)
                    locator = self.page.get_by_text(strategy['text'], exact=exact)
                    locator.first.wait_for(state='attached', timeout=self.timeout)
                    return locator.first

                elif strategy['strategy'] == 'css':
                    locator = self.page.locator(strategy['selector'])
                    locator.first.wait_for(state='attached', timeout=self.timeout)
                    return locator.first

                elif strategy['strategy'] == 'js':
                    element = self.page.evaluate(strategy['expression'])
                    if element:
                        return element

            except Exception:
                continue

        raise RuntimeError("Failed to find element with any strategy")

    def click(self, element: Locator) -> None:
        """Click element"""
        element.click(timeout=self.timeout)

    def type(self, element: Locator, text: str, opts: Optional[Dict] = None) -> None:
        """Type text into element"""
        opts = opts or {}

        if opts.get('clear'):
            element.clear()

        if opts.get('delay'):
            for char in text:
                element.type(char, delay=opts['delay'])
        else:
            element.fill(text)

    def select(self, element: Locator, value: str) -> None:
        """Select option from dropdown"""
        element.select_option(value)

    def read_text(self, selectors: List[Dict[str, Any]]) -> str:
        """Read text from element"""
        element = self.find_element(selectors)
        text = element.text_content()
        return (text or '').strip()

    def read_pattern(self, selectors: List[Dict[str, Any]], regex: str) -> Optional[str]:
        """Read text and match pattern"""
        text = self.read_text(selectors)
        pattern = re.compile(regex)
        match = pattern.search(text)

        if not match:
            return None

        return match.group(1) if match.lastindex and match.lastindex >= 1 else match.group(0)

    def wait_for(self, condition: Dict[str, Any]) -> None:
        """Wait for condition"""
        cond_type = condition.get('type')
        value = condition.get('value')
        timeout = condition.get('timeout', self.timeout)

        if cond_type == 'selector':
            self.page.locator(value).wait_for(state='visible', timeout=timeout)

        elif cond_type == 'url':
            self.page.wait_for_url(value, timeout=timeout)

        elif cond_type == 'timeout':
            self.page.wait_for_timeout(value)

        elif cond_type == 'network_idle':
            self.page.wait_for_load_state('networkidle', timeout=timeout)

        else:
            raise ValueError(f"Unknown wait condition type: {cond_type}")

    def screenshot(self) -> bytes:
        """Take screenshot"""
        return self.page.screenshot(full_page=True)

    def evaluate(self, js: str) -> Any:
        """Evaluate JavaScript"""
        try:
            return self.page.evaluate(js)
        except Exception as e:
            raise RuntimeError(f"JS evaluation failed: {str(e)}")

    def get_page_context(self) -> Dict[str, Any]:
        """Get page context info"""
        return {
            'url': self.page.url,
            'title': self.page.title,
            'readyState': self.page.evaluate('document.readyState')
        }

    def get_named_page(self, name: str) -> Page:
        """Get named page"""
        if name in self.named_pages:
            page = self.named_pages[name]
            page.bring_to_front()
            return page
        raise RuntimeError(f"Page not found: {name}")

    def create_page(self, name: str) -> Page:
        """Create new named page"""
        page = self.context.new_page()
        self.named_pages[name] = page
        return page
```

## Error Handling

Both implementations handle errors consistently:

1. **Selector not found:** Throw RuntimeError with message "Failed to find element with any strategy"
2. **Navigation timeout:** Throw RuntimeError with "Navigation failed: ..."
3. **Invalid strategy:** Throw ValueError with "Unknown selector strategy: ..."
4. **JS evaluation:** Throw RuntimeError with "JS evaluation failed: ..."

## Edge Cases

1. **Invisible elements:** Playwright's `waitFor(state: 'attached')` does not require visibility. Use `state: 'visible'` explicitly if needed.

2. **Cross-origin iframes:** Cannot access elements inside cross-origin iframes. Will fail silently.

3. **Dynamic content:** If element appears/disappears frequently, retries are handled by the healing pipeline, not here.

4. **Multiple matching elements:** Always return `.first()` to ensure single element.

5. **Stale element handles:** Locators are lazy; elements are resolved at interaction time. No stale handle errors.

6. **Timeout override:** Each method respects `this.timeout`. Can be overridden per-call if needed.

7. **Page closed:** If page is closed, all methods will throw. Not specially handled.

8. **Modal dialogs:** Use `handleDialog()` to handle JavaScript alerts/confirms.

## Test Scenarios

### 1. Click element by CSS

**Setup:** Page with `<button class="submit">`
**Test:** `driver.click(findElement([{ strategy: 'css', selector: '.submit' }]))`
**Expected:** Button clicked without error

### 2. Type into text field

**Setup:** Page with `<input id="email" />`
**Test:** `driver.type(element, 'test@example.com')`
**Expected:** Text entered into input

### 3. Type with delay

**Setup:** Page with input
**Test:** `driver.type(element, 'slow', { delay: 100 })`
**Expected:** Text entered character by character with 100ms delay

### 4. Select from dropdown

**Setup:** Page with `<select><option value="opt1">Option 1</option></select>`
**Test:** `driver.select(element, 'opt1')`
**Expected:** Option selected

### 5. Read text from element

**Setup:** Page with `<p>Hello World</p>`
**Test:** `driver.readText([{ strategy: 'text', text: 'Hello' }])`
**Expected:** `"Hello World"`

### 6. Match pattern in text

**Setup:** Page with `<p>Price: $99.99</p>`
**Test:** `driver.readPattern([...], '\$([0-9.]+)')`
**Expected:** `"99.99"`

### 7. Navigate to URL

**Setup:** Empty driver
**Test:** `driver.goto('https://example.com')`
**Expected:** Page navigated, no error

### 8. Wait for selector

**Setup:** Page with element added dynamically
**Test:** `driver.waitFor({ type: 'selector', value: '.added', timeout: 5000 })`
**Expected:** Wait succeeds when element appears

### 9. Wait for timeout

**Setup:** Any page
**Test:** `driver.waitFor({ type: 'timeout', value: 1000 })`
**Expected:** Wait 1s then return

### 10. Find by ARIA role

**Setup:** Page with `<button aria-label="Submit">Send</button>`
**Test:** `driver.findElement([{ strategy: 'aria', role: 'button', name: 'Submit' }])`
**Expected:** Button found

### 11. Find by label

**Setup:** Page with `<label>Email</label><input />`
**Test:** `driver.findElement([{ strategy: 'label', text: 'Email' }])`
**Expected:** Input found

### 12. Screenshot

**Setup:** Any page
**Test:** `driver.screenshot()`
**Expected:** Buffer returned with PNG data

### 13. Evaluate JavaScript

**Setup:** Page
**Test:** `driver.evaluate('document.title')`
**Expected:** Page title returned

### 14. Multi-tab: create page

**Setup:** Driver with one page
**Test:** `driver.createPage('tab2')`
**Expected:** New page created, can navigate independently

### 15. Multi-tab: get named page

**Setup:** Driver with named pages
**Test:** `driver.getNamedPage('tab2')`
**Expected:** Page returned and brought to front

### 16. Strategy fallback

**Setup:** Two strategies, first fails
**Test:** `driver.findElement([{ strategy: 'css', selector: '.no-match' }, { strategy: 'text', text: 'Found' }])`
**Expected:** Second strategy succeeds, element found
