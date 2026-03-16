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
    inputKind?: 'text' | 'select' | 'checkbox' | 'radio';
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

function isComboboxLike(el: Element | null): boolean {
  if (!el) return false;

  const explicitRole = el.getAttribute('role')?.toLowerCase();
  if (explicitRole === 'combobox') {
    return true;
  }

  if (el instanceof HTMLSelectElement || el.tagName.toLowerCase() === 'select') {
    return true;
  }

  const popupKind = (el.getAttribute('aria-haspopup') || '').toLowerCase();
  const hasPopupLink =
    el.hasAttribute('aria-controls') ||
    el.hasAttribute('aria-owns') ||
    el.hasAttribute('aria-expanded');

  return popupKind === 'listbox' && hasPopupLink;
}

function inferAccessibleRole(el: Element): string | undefined {
  const explicitRole = el.getAttribute('role');
  if (explicitRole) {
    return explicitRole;
  }

  if (isComboboxLike(el)) {
    return 'combobox';
  }

  const tag = el.tagName.toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a') return 'link';
  if (tag === 'textarea') return 'textbox';

  if (tag === 'input') {
    const type = (el as HTMLInputElement).type?.toLowerCase();
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'search') return 'searchbox';
    return 'textbox';
  }

  return undefined;
}

function getInputKind(el: Element): 'text' | 'select' | 'checkbox' | 'radio' {
  if (isComboboxLike(el)) {
    return 'select';
  }

  const type = (el as HTMLInputElement).type?.toLowerCase();
  if (type === 'checkbox') return 'checkbox';
  if (type === 'radio') return 'radio';
  return 'text';
}

function getInputValue(el: Element): string {
  if (el instanceof HTMLSelectElement) {
    const selectedOption = el.selectedOptions[0];
    return truncate(selectedOption?.textContent || el.value, 200) || '';
  }

  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') {
      return el.checked ? 'true' : 'false';
    }
    return truncate(el.value, 200) || '';
  }

  if (el instanceof HTMLTextAreaElement) {
    return truncate(el.value, 200) || '';
  }

  return truncate((el as HTMLInputElement).value || '', 200) || '';
}

function scoreSelectionController(candidate: Element, popup: Element, popupId?: string): number {
  let score = 0;

  if (popupId && (candidate.getAttribute('aria-controls') === popupId || candidate.getAttribute('aria-owns') === popupId)) {
    score += 300;
  }

  if (candidate === document.activeElement) {
    score += 180;
  }

  if (candidate.getAttribute('aria-expanded') === 'true') {
    score += 120;
  }

  if (candidate.getAttribute('role')?.toLowerCase() === 'combobox') {
    score += 100;
  }

  if ((candidate.getAttribute('aria-haspopup') || '').toLowerCase() === 'listbox') {
    score += 90;
  }

  const candidateLabel = `${candidate.getAttribute('aria-label') || ''} ${candidate.textContent || ''}`.toLowerCase();
  if (candidateLabel.includes('filter')) {
    score += 40;
  }

  try {
    const popupRect = popup.getBoundingClientRect();
    const candidateRect = candidate.getBoundingClientRect();
    const popupCenterX = popupRect.left + popupRect.width / 2;
    const popupCenterY = popupRect.top + popupRect.height / 2;
    const candidateCenterX = candidateRect.left + candidateRect.width / 2;
    const candidateCenterY = candidateRect.top + candidateRect.height / 2;
    const distance = Math.hypot(popupCenterX - candidateCenterX, popupCenterY - candidateCenterY);
    score += Math.max(0, 80 - Math.round(distance / 8));
  } catch {
    // Ignore layout failures in synthetic environments.
  }

  return score;
}

function findSelectionSource(target: Element): { source: Element; selectedText: string } | null {
  const optionEl = target.closest('option, [role="option"], [role="menuitemradio"], [role="radio"]');
  if (!optionEl) return null;

  const selectedText =
    truncate(optionEl.getAttribute('aria-label'), 200) ||
    truncate(optionEl.textContent, 200) ||
    truncate(optionEl.getAttribute('data-value'), 200);

  if (!selectedText) return null;

  if (optionEl instanceof HTMLOptionElement) {
    const selectEl = optionEl.closest('select');
    if (selectEl) {
      return { source: selectEl, selectedText };
    }
  }

  const popup = optionEl.closest('[role="listbox"], [role="menu"]');
  if (!popup) {
    return null;
  }

  const popupId = popup.id || undefined;
  const candidates = new Set<Element>();

  if (popupId) {
    for (const candidate of document.querySelectorAll('[aria-controls], [aria-owns]')) {
      if (!(candidate instanceof Element)) continue;
      if (candidate.getAttribute('aria-controls') === popupId || candidate.getAttribute('aria-owns') === popupId) {
        candidates.add(candidate);
      }
    }
  }

  const activeEl = document.activeElement;
  if (activeEl instanceof Element && isComboboxLike(activeEl)) {
    candidates.add(activeEl);
  }

  for (const candidate of document.querySelectorAll(
    '[role="combobox"], [aria-haspopup="listbox"][aria-expanded="true"], [aria-haspopup="listbox"][aria-controls], [aria-haspopup="listbox"][aria-owns]',
  )) {
    if (candidate instanceof Element && isComboboxLike(candidate)) {
      candidates.add(candidate);
    }
  }

  let bestCandidate: Element | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const score = scoreSelectionController(candidate, popup, popupId);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  return bestCandidate ? { source: bestCandidate, selectedText } : null;
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

  const ariaRole = inferAccessibleRole(el);
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
  private recentInputEmissions: WeakMap<Element, {
    value: string;
    kind: 'text' | 'select' | 'checkbox' | 'radio';
    timestamp: number;
  }> = new WeakMap();
  private inputDebounceMs = 300;
  private inputDuplicateWindowMs = 2000;
  private lastUrl: string;
  private sendAction: (action: RecordedAction) => void;

  // Bound handlers for cleanup
  private boundClickHandler: (e: MouseEvent) => void;
  private boundInputHandler: (e: Event) => void;
  private boundChangeHandler: (e: Event) => void;
  private boundKeyHandler: (e: KeyboardEvent) => void;

  constructor(sendAction: (action: RecordedAction) => void) {
    this.sendAction = sendAction;
    this.lastUrl = window.location.href;

    this.boundClickHandler = this.handleClick.bind(this);
    this.boundInputHandler = this.handleInput.bind(this);
    this.boundChangeHandler = this.handleChange.bind(this);
    this.boundKeyHandler = this.handleKeypress.bind(this);
  }

  start(): void {
    if (this.recording) return;
    this.recording = true;
    this.actions = [];
    this.lastUrl = window.location.href;
    this.recentInputEmissions = new WeakMap();
    actionCounter = 0;

    document.addEventListener('click', this.boundClickHandler, { capture: true });
    document.addEventListener('input', this.boundInputHandler, { capture: true });
    document.addEventListener('change', this.boundChangeHandler, { capture: true });
    document.addEventListener('keydown', this.boundKeyHandler, { capture: true });

    // Hook navigation
    this.hookNavigation();
  }

  stop(): RecordedAction[] {
    if (!this.recording) return this.actions;
    this.recording = false;

    document.removeEventListener('click', this.boundClickHandler, { capture: true });
    document.removeEventListener('input', this.boundInputHandler, { capture: true });
    document.removeEventListener('change', this.boundChangeHandler, { capture: true });
    document.removeEventListener('keydown', this.boundKeyHandler, { capture: true });

    // Clear debounce timers
    for (const timer of this.inputDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.inputDebounceTimers.clear();
    this.recentInputEmissions = new WeakMap();

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
    const selection = findSelectionSource(el);
    if (selection) {
      this.emitInputAction(selection.source, e.composedPath(), selection.selectedText, 'select');
      return;
    }

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
    const inputKind = getInputKind(el);

    if (inputKind !== 'text') {
      this.emitInputAction(el, e.composedPath(), getInputValue(el), inputKind);
      return;
    }

    // Debounce rapid input events for the same element
    const existing = this.inputDebounceTimers.get(el);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.inputDebounceTimers.delete(el);
      this.emitInputAction(el, e.composedPath(), getInputValue(el), inputKind);
    }, this.inputDebounceMs);

    this.inputDebounceTimers.set(el, timer);
  }

  private handleChange(e: Event): void {
    if (!this.recording) return;

    const target = e.composedPath()[0];
    if (!(target instanceof Element)) return;

    const el = target as Element;
    const inputKind = getInputKind(el);
    this.emitInputAction(el, e.composedPath(), getInputValue(el), inputKind);
  }

  private emitInputAction(
    el: Element,
    composedPath: EventTarget[],
    inputValue: string,
    inputKind: 'text' | 'select' | 'checkbox' | 'radio',
  ): void {
    const now = Date.now();
    const previous = this.recentInputEmissions.get(el);
    if (
      previous &&
      previous.kind === inputKind &&
      previous.value === inputValue &&
      now - previous.timestamp < this.inputDuplicateWindowMs
    ) {
      return;
    }

    const ctx = buildElementContext(el, composedPath);

    const action: RecordedAction = {
      id: generateId(),
      type: 'input',
      timestamp: now,
      url: window.location.href,
      element: ctx,
      metadata: {
        inputValue,
        inputKind,
      },
    };

    this.recentInputEmissions.set(el, {
      value: inputValue,
      kind: inputKind,
      timestamp: now,
    });
    this.emit(action);
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
          // Guard: chrome.runtime.id is undefined when extension context is invalidated
          if (!chrome.runtime?.id) {
            recorderInstance?.stop();
            recorderInstance = null;
            return;
          }
          try {
            chrome.runtime.sendMessage({ type: 'ACTION_RECORDED', payload: action }).catch(() => {});
          } catch {
            recorderInstance?.stop();
            recorderInstance = null;
          }
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
