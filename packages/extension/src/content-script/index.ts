/**
 * Content Script — DOM observer + page detector.
 *
 * Responsibilities:
 * - Observe DOM mutations (MutationObserver) to detect page changes
 * - Match current URL against loaded app url_patterns
 * - Take DOM snapshots for capture mode and healing
 * - Execute element interactions on behalf of service worker
 *
 * Implementation notes:
 * - Runs in page context (has DOM access)
 * - Communicates with service worker via chrome.runtime.sendMessage
 * - MutationObserver watches for significant DOM changes (not every mutation)
 * - Debounce DOM change notifications (500ms default)
 * - Recording: activates Recorder for Walk & Capture AI assistant
 */

import { initRecorder } from './recorder.js';
export { initRecorder } from './recorder.js';
export type { RecordedAction, ElementContext } from './recorder.js';

// ─── Types ──────────────────────────────────────────────

export interface InteractiveElement {
  id: string;
  tag: string;
  ariaLabel?: string;
  text?: string;
  xPath: string;
}

export interface DomSnapshot {
  html: string;
  interactiveElements: InteractiveElement[];
  ariaMap: Record<string, string[]>;
}

export interface ContentScriptDeps {
  chrome: typeof chrome;
  window: Window;
  document: Document;
}

// ─── XPath generation ───────────────────────────────────

export function generateXPath(element: Element): string {
  if (element.id) {
    return `//*[@id="${element.id}"]`;
  }

  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current !== current.ownerDocument.documentElement) {
    const parent: Element | null = current.parentElement;
    if (!parent) {
      parts.unshift(current.tagName.toLowerCase());
      break;
    }

    const tagName = current.tagName;
    const siblings = Array.from(parent.children).filter(
      (child: Element) => child.tagName === tagName,
    );

    if (siblings.length > 1) {
      const index = siblings.indexOf(current) + 1;
      parts.unshift(`${current.tagName.toLowerCase()}[${index}]`);
    } else {
      parts.unshift(current.tagName.toLowerCase());
    }

    current = parent;
  }

  return '/' + parts.join('/');
}

// ─── Interactive element capture ────────────────────────

export function captureInteractiveElements(doc: Document): InteractiveElement[] {
  const selector = 'button, input, select, a, textarea, [role]';
  const elements = doc.querySelectorAll(selector);

  const result: InteractiveElement[] = [];

  for (let i = 0; i < elements.length && result.length < 500; i++) {
    const el = elements[i]!;

    const id = el.id || `el_${i}`;
    const tag = el.tagName.toLowerCase();
    const ariaLabel = el.getAttribute('aria-label') ?? undefined;
    const rawText = el.textContent ?? '';
    const text = rawText.substring(0, 100) || undefined;
    const xPath = generateXPath(el);

    result.push({ id, tag, ariaLabel, text, xPath });
  }

  return result;
}

// ─── ARIA map ───────────────────────────────────────────

function buildAriaMap(doc: Document): Record<string, string[]> {
  const ariaMap: Record<string, string[]> = {};
  const ariaElements = doc.querySelectorAll('[aria-label]');

  for (const el of ariaElements) {
    const label = el.getAttribute('aria-label');
    if (label) {
      const tag = el.tagName.toLowerCase();
      if (!ariaMap[tag]) {
        ariaMap[tag] = [];
      }
      ariaMap[tag].push(label);
    }
  }

  return ariaMap;
}

// ─── DOM snapshot ───────────────────────────────────────

export function captureDomSnapshot(doc: Document): DomSnapshot {
  const fullHtml = doc.documentElement.outerHTML;
  const html = fullHtml.substring(0, 50000);
  const interactiveElements = captureInteractiveElements(doc);
  const ariaMap = buildAriaMap(doc);

  return { html, interactiveElements, ariaMap };
}

// ─── Page change notification ───────────────────────────

export function notifyPageChange(deps: ContentScriptDeps): void {
  deps.chrome.runtime.sendMessage({
    type: 'PAGE_DETECTED',
    payload: {
      url: deps.window.location.href,
      title: deps.document.title,
      timestamp: Date.now(),
    },
  });
}

// ─── Page navigation detection ──────────────────────────

export function setupPageNavigationDetection(deps: ContentScriptDeps): () => void {
  const originalPushState = deps.window.history.pushState;
  const originalReplaceState = deps.window.history.replaceState;

  deps.window.history.pushState = function (
    this: History,
    ...args: Parameters<History['pushState']>
  ): void {
    originalPushState.apply(this, args);
    notifyPageChange(deps);
  };

  deps.window.history.replaceState = function (
    this: History,
    ...args: Parameters<History['replaceState']>
  ): void {
    originalReplaceState.apply(this, args);
    notifyPageChange(deps);
  };

  const popstateHandler = (): void => {
    notifyPageChange(deps);
  };

  const loadHandler = (): void => {
    notifyPageChange(deps);
  };

  deps.window.addEventListener('popstate', popstateHandler);
  deps.window.addEventListener('load', loadHandler);

  // Return cleanup function
  return () => {
    deps.window.history.pushState = originalPushState;
    deps.window.history.replaceState = originalReplaceState;
    deps.window.removeEventListener('popstate', popstateHandler);
    deps.window.removeEventListener('load', loadHandler);
  };
}

// ─── DOM Observer ───────────────────────────────────────

export function setupDomObserver(deps: ContentScriptDeps, debounceMs = 500): () => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const observer = new MutationObserver(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      const snapshot = captureDomSnapshot(deps.document);
      deps.chrome.runtime.sendMessage({
        type: 'DOM_SNAPSHOT',
        payload: snapshot,
      });
    }, debounceMs);
  });

  // Only observe if body exists
  if (deps.document.body) {
    observer.observe(deps.document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: false,
      attributeFilter: ['class', 'id'],
    });
  }

  return () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    observer.disconnect();
  };
}

// ─── Bootstrap ──────────────────────────────────────────
// Auto-initialize when Chrome injects this content script.
// Guard: only run in browser with chrome.runtime (not in test environment).

if (typeof globalThis.chrome !== 'undefined' && globalThis.chrome?.runtime?.sendMessage) {
  const deps: ContentScriptDeps = {
    chrome: globalThis.chrome,
    window: globalThis.window,
    document: globalThis.document,
  };

  setupPageNavigationDetection(deps);
  setupDomObserver(deps);
  notifyPageChange(deps);
  initRecorder();
}
