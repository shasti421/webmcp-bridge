/**
 * BridgeDriver — the core abstraction implemented by each runtime.
 * ContentScriptDriver (extension) and PlaywrightDriver (headless) both implement this.
 * This interface is GENERIC — no app-specific knowledge.
 */

export interface ElementHandle {
  readonly _brand: 'ElementHandle';
}

export interface PageHandle {
  readonly name: string;
  readonly _brand: 'PageHandle';
}

export interface PageContext {
  url: string;
  title: string;
  readyState: 'loading' | 'interactive' | 'complete';
}

export interface TypeOpts {
  clear?: boolean;
  delay?: number;
}

export interface ScrollOpts {
  behavior?: 'smooth' | 'instant';
}

export interface DismissStrategy {
  type: 'click_close' | 'press_escape' | 'remove_element' | 'click_text';
  selector?: string;
  text?: string[];
  waitAfter?: number;
}

export interface WaitCondition {
  type: 'selector' | 'url' | 'timeout' | 'network_idle';
  value: string | number | RegExp;
  timeout?: number;
}

export interface EventOpts {
  bubbles?: boolean;
  cancelable?: boolean;
  detail?: unknown;
}

export type SelectorStrategy =
  | { strategy: 'aria'; role: string; name?: string; confidence?: number }
  | { strategy: 'label'; text: string; scope?: string; confidence?: number }
  | { strategy: 'text'; text: string; exact?: boolean; confidence?: number }
  | { strategy: 'css'; selector: string; confidence?: number }
  | { strategy: 'js'; expression: string; confidence?: number };

export type SelectorChain = SelectorStrategy[];

/**
 * The BridgeDriver interface — runtime-agnostic browser automation.
 */
export interface BridgeDriver {
  // Navigation
  goto(url: string): Promise<void>;
  waitForNavigation(urlPattern?: string | RegExp): Promise<void>;

  // Element discovery
  findElement(selectors: SelectorChain): Promise<ElementHandle>;

  // Interactions
  click(element: ElementHandle): Promise<void>;
  doubleClick(element: ElementHandle): Promise<void>;
  type(element: ElementHandle, text: string, opts?: TypeOpts): Promise<void>;
  select(element: ElementHandle, value: string): Promise<void>;
  check(element: ElementHandle, state: boolean): Promise<void>;
  clear(element: ElementHandle): Promise<void>;
  hover(element: ElementHandle): Promise<void>;
  dragDrop(source: ElementHandle, target: ElementHandle): Promise<void>;
  uploadFile(input: ElementHandle, paths: string[]): Promise<void>;

  // Reading
  readText(selectors: SelectorChain): Promise<string>;
  readPattern(selectors: SelectorChain, regex: string): Promise<string | null>;

  // Keyboard
  pressKey(key: string, modifiers?: string[]): Promise<void>;
  pressSequentially(element: ElementHandle, text: string, delay?: number): Promise<void>;

  // Scrolling
  scroll(target?: ElementHandle | 'top' | 'bottom', opts?: ScrollOpts): Promise<void>;

  // Overlays
  dismissOverlay(strategy: DismissStrategy): Promise<boolean>;

  // Events
  dispatchEvent(element: ElementHandle, event: string, opts?: EventOpts): Promise<void>;

  // Frames
  switchFrame(target: string | ElementHandle | 'parent'): Promise<void>;

  // Dialogs
  handleDialog(action: 'accept' | 'dismiss', promptText?: string): Promise<string>;

  // Waiting
  waitFor(condition: WaitCondition): Promise<void>;

  // Diagnostics
  screenshot(): Promise<Buffer>;

  // JS escape hatch
  evaluate(js: string): Promise<unknown>;

  // Context
  getPageContext(): Promise<PageContext>;

  // Multi-tab
  getNamedPage(name: string): Promise<PageHandle>;
  createPage(name: string): Promise<PageHandle>;
}
