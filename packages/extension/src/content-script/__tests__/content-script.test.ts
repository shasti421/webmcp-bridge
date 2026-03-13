/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  notifyPageChange,
  captureDomSnapshot,
  captureInteractiveElements,
  generateXPath,
  setupPageNavigationDetection,
  setupDomObserver,
  type ContentScriptDeps,
} from '../index.js';

// ─── Mock chrome API ───────────────────────────────────

function createMockChrome() {
  return {
    runtime: {
      sendMessage: vi.fn(),
    },
  };
}

function createMockDeps(overrides?: Partial<ContentScriptDeps>): ContentScriptDeps {
  return {
    chrome: createMockChrome() as unknown as typeof chrome,
    window: globalThis.window,
    document: globalThis.document,
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────

describe('Content Script', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('notifyPageChange', () => {
    it('sends PAGE_DETECTED message via chrome runtime', () => {
      const deps = createMockDeps();

      notifyPageChange(deps);

      expect(deps.chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'PAGE_DETECTED',
        payload: expect.objectContaining({
          url: expect.any(String),
          title: expect.any(String),
          timestamp: expect.any(Number),
        }),
      });
    });

    it('includes current URL in the payload', () => {
      const deps = createMockDeps();

      notifyPageChange(deps);

      const call = (deps.chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
      const message = call[0] as { payload: { url: string } };
      expect(message.payload.url).toBe(window.location.href);
    });
  });

  describe('captureInteractiveElements', () => {
    it('captures buttons', () => {
      document.body.innerHTML = '<button id="btn1">Click me</button>';

      const elements = captureInteractiveElements(document);

      expect(elements.length).toBe(1);
      expect(elements[0]!.tag).toBe('button');
      expect(elements[0]!.text).toBe('Click me');
    });

    it('captures inputs', () => {
      document.body.innerHTML = '<input id="name" type="text" aria-label="Name" />';

      const elements = captureInteractiveElements(document);

      expect(elements.length).toBe(1);
      expect(elements[0]!.tag).toBe('input');
      expect(elements[0]!.ariaLabel).toBe('Name');
    });

    it('captures select elements', () => {
      document.body.innerHTML = '<select id="color"><option>Red</option></select>';

      const elements = captureInteractiveElements(document);

      expect(elements.length).toBe(1);
      expect(elements[0]!.tag).toBe('select');
    });

    it('captures anchor elements', () => {
      document.body.innerHTML = '<a href="/about">About</a>';

      const elements = captureInteractiveElements(document);

      expect(elements.length).toBe(1);
      expect(elements[0]!.tag).toBe('a');
      expect(elements[0]!.text).toBe('About');
    });

    it('captures elements with role attribute', () => {
      document.body.innerHTML = '<div role="tab">Tab 1</div>';

      const elements = captureInteractiveElements(document);

      expect(elements.length).toBe(1);
      expect(elements[0]!.tag).toBe('div');
    });

    it('limits to 500 elements', () => {
      let html = '';
      for (let i = 0; i < 600; i++) {
        html += `<button id="btn${i}">B${i}</button>`;
      }
      document.body.innerHTML = html;

      const elements = captureInteractiveElements(document);

      expect(elements.length).toBe(500);
    });

    it('truncates text content to 100 chars', () => {
      const longText = 'A'.repeat(200);
      document.body.innerHTML = `<button>${longText}</button>`;

      const elements = captureInteractiveElements(document);

      expect(elements[0]!.text!.length).toBeLessThanOrEqual(100);
    });
  });

  describe('generateXPath', () => {
    it('generates xpath for element with id', () => {
      document.body.innerHTML = '<div id="main"><span id="target">text</span></div>';
      const el = document.getElementById('target')!;

      const xpath = generateXPath(el);

      expect(xpath).toContain('target');
    });

    it('generates xpath for element without id', () => {
      document.body.innerHTML = '<div><span>first</span><span>second</span></div>';
      const spans = document.querySelectorAll('span');
      const el = spans[1]!;

      const xpath = generateXPath(el);

      expect(xpath).toBeTruthy();
      expect(xpath.length).toBeGreaterThan(0);
    });
  });

  describe('captureDomSnapshot', () => {
    it('returns html, interactiveElements, and ariaMap', () => {
      document.body.innerHTML = '<button aria-label="Save">Save</button>';

      const snapshot = captureDomSnapshot(document);

      expect(snapshot).toHaveProperty('html');
      expect(snapshot).toHaveProperty('interactiveElements');
      expect(snapshot).toHaveProperty('ariaMap');
    });

    it('limits html to 50000 characters', () => {
      // Create a large DOM
      let html = '';
      for (let i = 0; i < 5000; i++) {
        html += `<div class="item-${i}">Content for item number ${i} with some extra padding text</div>`;
      }
      document.body.innerHTML = html;

      const snapshot = captureDomSnapshot(document);

      expect(snapshot.html.length).toBeLessThanOrEqual(50000);
    });

    it('includes interactive elements in snapshot', () => {
      document.body.innerHTML = '<input type="text" /><button>Go</button>';

      const snapshot = captureDomSnapshot(document);

      expect(snapshot.interactiveElements.length).toBe(2);
    });
  });

  describe('setupPageNavigationDetection', () => {
    it('patches history.pushState', () => {
      const deps = createMockDeps();
      const originalPushState = deps.window.history.pushState;

      const cleanup = setupPageNavigationDetection(deps);

      expect(deps.window.history.pushState).not.toBe(originalPushState);

      cleanup();
    });

    it('patches history.replaceState', () => {
      const deps = createMockDeps();
      const originalReplaceState = deps.window.history.replaceState;

      const cleanup = setupPageNavigationDetection(deps);

      expect(deps.window.history.replaceState).not.toBe(originalReplaceState);

      cleanup();
    });

    it('calls notifyPageChange when pushState is invoked', () => {
      const deps = createMockDeps();

      const cleanup = setupPageNavigationDetection(deps);

      deps.window.history.pushState({}, '', '/new-url');

      expect(deps.chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'PAGE_DETECTED' }),
      );

      cleanup();
    });

    it('restores original methods on cleanup', () => {
      const deps = createMockDeps();
      const originalPushState = deps.window.history.pushState;
      const originalReplaceState = deps.window.history.replaceState;

      const cleanup = setupPageNavigationDetection(deps);
      cleanup();

      expect(deps.window.history.pushState).toBe(originalPushState);
      expect(deps.window.history.replaceState).toBe(originalReplaceState);
    });
  });

  describe('setupDomObserver', () => {
    it('returns a disconnect function', () => {
      const deps = createMockDeps();

      const disconnect = setupDomObserver(deps, 50);

      expect(typeof disconnect).toBe('function');
      disconnect();
    });

    it('sends DOM_SNAPSHOT after debounce on DOM mutation', async () => {
      const deps = createMockDeps();

      const disconnect = setupDomObserver(deps, 50);

      // Trigger a DOM mutation
      const div = document.createElement('div');
      div.id = 'new-element';
      document.body.appendChild(div);

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(deps.chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'DOM_SNAPSHOT' }),
      );

      disconnect();
    });
  });
});
