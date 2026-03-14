/**
 * Recorder — captures user interactions in real-time during a recording session.
 *
 * Listens for click, input, and navigation events and packages them as
 * RecordedAction objects with rich element context (selectors, shadow path,
 * nearby labels). Uses event.composedPath() to pierce shadow DOM at capture
 * time, completely bypassing the need to search the shadow DOM later.
 *
 * Recording is off by default — activated via START_RECORDING message from
 * the service worker. Events are sent individually via ACTION_RECORDED.
 */

// ─── Types ──────────────────────────────────────────────

export interface ElementContext {
  tag: string;
  id?: string;
  classes: string[];
  text?: string;
  value?: string;
  href?: string;
  type?: string;
  ariaLabel?: string;
  ariaRole?: string;
  placeholder?: string;
  selectors: {
    aria?: { role: string; name: string };
    css?: string;
    xPath?: string;
    testId?: string;
  };
  nearbyLabel?: string;
  containerClass?: string;
  shadowPath?: string[];
  shadowDepth?: number;
  siblingTexts?: string[];
  boundingRect?: { x: number; y: number; width: number; height: number };
}

export interface RecordedAction {
  id: string;
  type: 'click' | 'input' | 'navigate' | 'keypress' | 'tab_switch';
  timestamp: number;
  url: string;
  element?: ElementContext;
  metadata?: {
    inputValue?: string;
    key?: string;
    fromUrl?: string;
    toUrl?: string;
  };
}

// ─── Helpers ────────────────────────────────────────────

let actionCounter = 0;

function generateId(): string {
  return `act_${Date.now()}_${++actionCounter}`;
}

function truncate(str: string | null | undefined, len: number): string | undefined {
  if (!str) return undefined;
  const trimmed = str.trim();
  return trimmed.length > 0 ? trimmed.substring(0, len) : undefined;
}

/**
 * Build a CSS selector for an element.
 */
function buildCssSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;

  const tag = el.tagName.toLowerCase();

  // data-testid or data-aura-rendered-by
  const testId = el.getAttribute('data-testid') || el.getAttribute('data-aura-rendered-by');
  if (testId) return `[data-testid="${testId}"]`;

  // Unique class combination
  if (el.classList.length > 0) {
    const classSelector = `${tag}.${Array.from(el.classList).map(c => CSS.escape(c)).join('.')}`;
    try {
      if (el.ownerDocument.querySelectorAll(classSelector).length === 1) {
        return classSelector;
      }
    } catch { /* fallback below */ }
  }

  // Tag + nth-of-type
  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
    if (siblings.length > 1) {
      const idx = siblings.indexOf(el) + 1;
      return `${tag}:nth-of-type(${idx})`;
    }
  }

  return tag;
}

/**
 * Build XPath for an element.
 */
function buildXPath(el: Element): string {
  if (el.id) return `//*[@id="${el.id}"]`;

  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== current.ownerDocument.documentElement) {
    const parent: Element | null = current.parentElement;
    if (!parent) {
      parts.unshift(current.tagName.toLowerCase());
      break;
    }
    const tag = current.tagName;
    const siblings = Array.from(parent.children).filter((c: Element) => c.tagName === tag);
    if (siblings.length > 1) {
      parts.unshift(`${current.tagName.toLowerCase()}[${siblings.indexOf(current) + 1}]`);
    } else {
      parts.unshift(current.tagName.toLowerCase());
    }
    current = parent;
  }
  return '/' + parts.join('/');
}

/**
 * Extract shadow DOM path from composedPath.
 */
function extractShadowPath(path: EventTarget[]): string[] | undefined {
  const segments: string[] = [];
  let hasShadow = false;

  for (const node of path) {
    if (node instanceof ShadowRoot) {
      hasShadow = true;
      const host = (node as ShadowRoot).host;
      segments.push(`${host.tagName.toLowerCase()}::shadow`);
    } else if (node instanceof Element && node !== document.documentElement && node !== document.body) {
      segments.push(node.tagName.toLowerCase());
    }
  }

  if (!hasShadow) return undefined;
  return segments.reverse();
}

/**
 * Find the nearest label for an element by walking up the DOM.
 */
function findNearbyLabel(el: Element): string | undefined {
  // 1. aria-label on the element itself
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // 2. aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = el.ownerDocument.getElementById(labelledBy);
    if (labelEl) return truncate(labelEl.textContent, 80);
  }

  // 3. Associated <label> via for attribute
  if (el.id) {
    const label = el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return truncate(label.textContent, 80);
  }

  // 4. Walk up parents looking for label patterns
  let parent = el.parentElement;
  for (let i = 0; i < 6 && parent; i++) {
    // Salesforce SLDS label
    const sldsLabel = parent.querySelector('.slds-form-element__label, .test-id__field-label');
    if (sldsLabel) return truncate(sldsLabel.textContent, 80);

    // Generic label child
    const label = parent.querySelector('label');
    if (label && label !== el) return truncate(label.textContent, 80);

    // Check for heading
    const heading = parent.querySelector('h1, h2, h3, h4');
    if (heading) return truncate(heading.textContent, 80);

    parent = parent.parentElement;
  }

  // 5. Previous sibling text
  const prev = el.previousElementSibling;
  if (prev && prev.tagName === 'LABEL') return truncate(prev.textContent, 80);

  return undefined;
}

/**
 * Build rich ElementContext from a DOM element + event composedPath.
 */
function buildElementContext(el: Element, composedPath?: EventTarget[]): ElementContext {
  const tag = el.tagName.toLowerCase();
  const rect = el.getBoundingClientRect();

  const ariaRole = el.getAttribute('role') || undefined;
  const ariaLabel = el.getAttribute('aria-label') || undefined;
  const ariaName = ariaLabel || truncate(el.textContent, 60);

  const testId = el.getAttribute('data-testid') || undefined;

  const ctx: ElementContext = {
    tag,
    id: el.id || undefined,
    classes: Array.from(el.classList),
    text: truncate(el.textContent, 100),
    href: (el as HTMLAnchorElement).href || el.getAttribute('href') || undefined,
    value: (el as HTMLInputElement).value || undefined,
    type: el.getAttribute('type') || undefined,
    ariaLabel,
    ariaRole,
    placeholder: el.getAttribute('placeholder') || undefined,
    selectors: {
      css: buildCssSelector(el),
      xPath: buildXPath(el),
      testId,
    },
    nearbyLabel: findNearbyLabel(el),
    boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };

  // ARIA selector
  if (ariaRole && ariaName) {
    ctx.selectors.aria = { role: ariaRole, name: ariaName };
  }

  // Shadow path from composedPath
  if (composedPath) {
    const shadowPath = extractShadowPath(composedPath);
    if (shadowPath) {
      ctx.shadowPath = shadowPath;
      ctx.shadowDepth = shadowPath.filter(s => s.includes('::shadow')).length;
    }
  }

  // Container class (for context)
  const container = el.closest('[class*="form-element"], [class*="field"], [class*="card"], [class*="section"]');
  if (container && container !== el) {
    ctx.containerClass = container.className.substring(0, 80);
  }

  // Sibling texts (for disambiguation)
  const parent = el.parentElement;
  if (parent) {
    ctx.siblingTexts = Array.from(parent.children)
      .filter(c => c !== el && c.textContent?.trim())
      .slice(0, 5)
      .map(c => c.textContent!.trim().substring(0, 40));
  }

  return ctx;
}

// ─── Recorder Class ─────────────────────────────────────

export class Recorder {
  private recording = false;
  private actions: RecordedAction[] = [];
  private maxActions = 500;
  private inputDebounceTimers: Map<Element, ReturnType<typeof setTimeout>> = new Map();
  private inputDebounceMs = 300;
  private lastUrl: string;
  private sendAction: (action: RecordedAction) => void;

  // Bound handlers for cleanup
  private boundClickHandler: (e: MouseEvent) => void;
  private boundInputHandler: (e: Event) => void;
  private boundKeyHandler: (e: KeyboardEvent) => void;

  constructor(sendAction: (action: RecordedAction) => void) {
    this.sendAction = sendAction;
    this.lastUrl = window.location.href;

    this.boundClickHandler = this.handleClick.bind(this);
    this.boundInputHandler = this.handleInput.bind(this);
    this.boundKeyHandler = this.handleKeypress.bind(this);
  }

  start(): void {
    if (this.recording) return;
    this.recording = true;
    this.actions = [];
    this.lastUrl = window.location.href;
    actionCounter = 0;

    document.addEventListener('click', this.boundClickHandler, { capture: true });
    document.addEventListener('input', this.boundInputHandler, { capture: true });
    document.addEventListener('keydown', this.boundKeyHandler, { capture: true });

    // Hook navigation
    this.hookNavigation();
  }

  stop(): RecordedAction[] {
    if (!this.recording) return this.actions;
    this.recording = false;

    document.removeEventListener('click', this.boundClickHandler, { capture: true });
    document.removeEventListener('input', this.boundInputHandler, { capture: true });
    document.removeEventListener('keydown', this.boundKeyHandler, { capture: true });

    // Clear debounce timers
    for (const timer of this.inputDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.inputDebounceTimers.clear();

    return this.actions;
  }

  isRecording(): boolean {
    return this.recording;
  }

  getActions(): RecordedAction[] {
    return [...this.actions];
  }

  private emit(action: RecordedAction): void {
    if (this.actions.length >= this.maxActions) return;
    this.actions.push(action);
    this.sendAction(action);
  }

  private handleClick(e: MouseEvent): void {
    if (!this.recording) return;

    const target = e.composedPath()[0];
    if (!(target instanceof Element)) return;

    const el = target as Element;
    const ctx = buildElementContext(el, e.composedPath());

    // Check if navigation happened
    const currentUrl = window.location.href;
    const navigated = currentUrl !== this.lastUrl;

    const action: RecordedAction = {
      id: generateId(),
      type: 'click',
      timestamp: Date.now(),
      url: currentUrl,
      element: ctx,
    };

    this.emit(action);

    // Check for navigation after a small delay
    if (!navigated) {
      setTimeout(() => {
        const newUrl = window.location.href;
        if (newUrl !== this.lastUrl) {
          this.emitNavigation(this.lastUrl, newUrl);
          this.lastUrl = newUrl;
        }
      }, 500);
    }
  }

  private handleInput(e: Event): void {
    if (!this.recording) return;

    const target = e.composedPath()[0];
    if (!(target instanceof Element)) return;

    const el = target as Element;

    // Debounce rapid input events for the same element
    const existing = this.inputDebounceTimers.get(el);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.inputDebounceTimers.delete(el);

      const ctx = buildElementContext(el, e.composedPath());
      const inputValue = (el as HTMLInputElement).value || '';

      const action: RecordedAction = {
        id: generateId(),
        type: 'input',
        timestamp: Date.now(),
        url: window.location.href,
        element: ctx,
        metadata: {
          inputValue: inputValue.substring(0, 200),
        },
      };

      this.emit(action);
    }, this.inputDebounceMs);

    this.inputDebounceTimers.set(el, timer);
  }

  private handleKeypress(e: KeyboardEvent): void {
    if (!this.recording) return;

    // Only capture significant keys
    if (!['Enter', 'Tab', 'Escape'].includes(e.key)) return;

    const target = e.composedPath()[0];
    const el = target instanceof Element ? target : null;

    const action: RecordedAction = {
      id: generateId(),
      type: 'keypress',
      timestamp: Date.now(),
      url: window.location.href,
      element: el ? buildElementContext(el, e.composedPath()) : undefined,
      metadata: { key: e.key },
    };

    this.emit(action);
  }

  private emitNavigation(fromUrl: string, toUrl: string): void {
    const action: RecordedAction = {
      id: generateId(),
      type: 'navigate',
      timestamp: Date.now(),
      url: toUrl,
      metadata: { fromUrl, toUrl },
    };
    this.emit(action);
  }

  private hookNavigation(): void {
    const self = this;
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;

    history.pushState = function (...args: Parameters<typeof history.pushState>) {
      const from = window.location.href;
      originalPush.apply(this, args);
      const to = window.location.href;
      if (from !== to && self.recording) {
        self.emitNavigation(from, to);
        self.lastUrl = to;
      }
    };

    history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
      const from = window.location.href;
      originalReplace.apply(this, args);
      const to = window.location.href;
      if (from !== to && self.recording) {
        self.emitNavigation(from, to);
        self.lastUrl = to;
      }
    };

    window.addEventListener('popstate', () => {
      if (!self.recording) return;
      const newUrl = window.location.href;
      if (newUrl !== self.lastUrl) {
        self.emitNavigation(self.lastUrl, newUrl);
        self.lastUrl = newUrl;
      }
    });
  }
}

// ─── Init (activated via message from service worker) ────

let recorderInstance: Recorder | null = null;

export function initRecorder(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'START_RECORDING') {
      if (!recorderInstance) {
        recorderInstance = new Recorder((action) => {
          chrome.runtime.sendMessage({ type: 'ACTION_RECORDED', payload: action }).catch(() => {});
        });
      }
      recorderInstance.start();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === 'STOP_RECORDING') {
      const actions = recorderInstance?.stop() ?? [];
      sendResponse({ ok: true, actions });
      recorderInstance = null;
      return;
    }
  });
}
