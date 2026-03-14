/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Recorder } from '../recorder.js';
import type { RecordedAction } from '../recorder.js';

// ─── Mock chrome API ────────────────────────────────────

const mockChrome = {
  runtime: {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    onMessage: { addListener: vi.fn() },
  },
};
(globalThis as unknown as { chrome: unknown }).chrome = mockChrome;

// Polyfill CSS.escape if not available
if (!globalThis.CSS?.escape) {
  (globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS = {
    escape: (s: string) => s.replace(/([^\w-])/g, '\\$1'),
  };
}

// ─── Test helpers ───────────────────────────────────────

function createMockElement(overrides: Partial<{
  tagName: string;
  id: string;
  className: string;
  textContent: string;
  href: string;
  value: string;
  ariaLabel: string;
  role: string;
  type: string;
  parentElement: Element | null;
  classList: DOMTokenList;
  ownerDocument: Document;
}> = {}): Element {
  const el = document.createElement(overrides.tagName?.toLowerCase() || 'button');
  if (overrides.id) el.id = overrides.id;
  if (overrides.className) el.className = overrides.className;
  if (overrides.textContent) el.textContent = overrides.textContent;
  if (overrides.ariaLabel) el.setAttribute('aria-label', overrides.ariaLabel);
  if (overrides.role) el.setAttribute('role', overrides.role);
  if (overrides.type) el.setAttribute('type', overrides.type);
  if (overrides.href) (el as HTMLAnchorElement).href = overrides.href;
  document.body.appendChild(el);
  return el;
}

function fireClick(el: Element): void {
  const event = new MouseEvent('click', { bubbles: true, composed: true });
  el.dispatchEvent(event);
}

function fireInput(el: Element, value: string): void {
  (el as HTMLInputElement).value = value;
  const event = new Event('input', { bubbles: true, composed: true });
  el.dispatchEvent(event);
}

function fireKeydown(el: Element, key: string): void {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, composed: true });
  el.dispatchEvent(event);
}

// ─── Tests ──────────────────────────────────────────────

describe('Recorder', () => {
  let sendAction: ReturnType<typeof vi.fn>;
  let recorder: Recorder;

  beforeEach(() => {
    sendAction = vi.fn();
    recorder = new Recorder(sendAction);
    document.body.innerHTML = '';
  });

  afterEach(() => {
    recorder.stop();
  });

  describe('lifecycle', () => {
    it('starts and stops recording', () => {
      expect(recorder.isRecording()).toBe(false);
      recorder.start();
      expect(recorder.isRecording()).toBe(true);
      recorder.stop();
      expect(recorder.isRecording()).toBe(false);
    });

    it('returns actions on stop', () => {
      recorder.start();
      const btn = createMockElement({ tagName: 'BUTTON', textContent: 'Submit' });
      fireClick(btn);
      const actions = recorder.stop();
      expect(actions.length).toBe(1);
    });

    it('does not capture when not recording', () => {
      const btn = createMockElement({ tagName: 'BUTTON', textContent: 'Submit' });
      fireClick(btn);
      expect(sendAction).not.toHaveBeenCalled();
    });

    it('does not double-start', () => {
      recorder.start();
      recorder.start(); // should be no-op
      expect(recorder.isRecording()).toBe(true);
    });
  });

  describe('click capture', () => {
    it('captures click events with element context', () => {
      recorder.start();
      const btn = createMockElement({
        tagName: 'BUTTON',
        textContent: 'Save',
        ariaLabel: 'Save record',
        role: 'button',
      });
      fireClick(btn);

      expect(sendAction).toHaveBeenCalledTimes(1);
      const action: RecordedAction = sendAction.mock.calls[0][0];

      expect(action.type).toBe('click');
      expect(action.element).toBeDefined();
      expect(action.element!.tag).toBe('button');
      expect(action.element!.ariaLabel).toBe('Save record');
      expect(action.element!.ariaRole).toBe('button');
      expect(action.element!.text).toContain('Save');
    });

    it('captures link clicks with href', () => {
      recorder.start();
      const link = createMockElement({
        tagName: 'A',
        textContent: 'Related Cases',
        href: 'https://example.com/cases',
      });
      fireClick(link);

      const action: RecordedAction = sendAction.mock.calls[0][0];
      expect(action.element!.href).toContain('example.com/cases');
    });

    it('captures element with CSS selector', () => {
      recorder.start();
      const btn = createMockElement({ tagName: 'BUTTON', id: 'submit-btn' });
      fireClick(btn);

      const action: RecordedAction = sendAction.mock.calls[0][0];
      expect(action.element!.selectors.css).toBe('#submit-btn');
    });

    it('includes bounding rect', () => {
      recorder.start();
      const btn = createMockElement({ tagName: 'BUTTON', textContent: 'Click' });
      fireClick(btn);

      const action: RecordedAction = sendAction.mock.calls[0][0];
      expect(action.element!.boundingRect).toBeDefined();
      expect(typeof action.element!.boundingRect!.x).toBe('number');
    });
  });

  describe('input capture', () => {
    it('captures input events with debouncing', async () => {
      recorder.start();
      const input = createMockElement({ tagName: 'INPUT', type: 'text' }) as HTMLInputElement;

      // Rapid typing
      fireInput(input, 'h');
      fireInput(input, 'he');
      fireInput(input, 'hel');
      fireInput(input, 'hello');

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 400));

      // Should only emit once due to debouncing
      expect(sendAction).toHaveBeenCalledTimes(1);
      const action: RecordedAction = sendAction.mock.calls[0][0];
      expect(action.type).toBe('input');
      expect(action.metadata?.inputValue).toBe('hello');
    });
  });

  describe('keypress capture', () => {
    it('captures Enter key', () => {
      recorder.start();
      const input = createMockElement({ tagName: 'INPUT', type: 'text' });
      fireKeydown(input, 'Enter');

      expect(sendAction).toHaveBeenCalledTimes(1);
      const action: RecordedAction = sendAction.mock.calls[0][0];
      expect(action.type).toBe('keypress');
      expect(action.metadata?.key).toBe('Enter');
    });

    it('captures Escape key', () => {
      recorder.start();
      fireKeydown(document.body, 'Escape');

      expect(sendAction).toHaveBeenCalledTimes(1);
      expect(sendAction.mock.calls[0][0].metadata?.key).toBe('Escape');
    });

    it('ignores regular character keys', () => {
      recorder.start();
      const input = createMockElement({ tagName: 'INPUT', type: 'text' });
      fireKeydown(input, 'a');
      fireKeydown(input, 'b');
      fireKeydown(input, 'c');

      expect(sendAction).not.toHaveBeenCalled();
    });
  });

  describe('action limits', () => {
    it('stops recording after max actions', () => {
      recorder.start();

      // Override max for testing
      (recorder as unknown as { maxActions: number }).maxActions = 5;

      const btn = createMockElement({ tagName: 'BUTTON', textContent: 'Click' });
      for (let i = 0; i < 10; i++) {
        fireClick(btn);
      }

      const actions = recorder.stop();
      expect(actions.length).toBe(5);
      expect(sendAction).toHaveBeenCalledTimes(5);
    });
  });

  describe('element context', () => {
    it('finds nearby label from aria-label', () => {
      recorder.start();
      const btn = createMockElement({
        tagName: 'BUTTON',
        ariaLabel: 'Save Changes',
      });
      fireClick(btn);

      const action: RecordedAction = sendAction.mock.calls[0][0];
      expect(action.element!.nearbyLabel).toBe('Save Changes');
    });

    it('builds aria selector for elements with role', () => {
      recorder.start();
      const tab = createMockElement({
        tagName: 'A',
        role: 'tab',
        ariaLabel: 'Details',
        textContent: 'Details',
      });
      fireClick(tab);

      const action: RecordedAction = sendAction.mock.calls[0][0];
      expect(action.element!.selectors.aria).toEqual({
        role: 'tab',
        name: 'Details',
      });
    });

    it('captures sibling texts for disambiguation', () => {
      recorder.start();
      const container = document.createElement('div');
      const span1 = document.createElement('span');
      span1.textContent = 'First';
      const span2 = document.createElement('span');
      span2.textContent = 'Second';
      const btn = document.createElement('button');
      btn.textContent = 'Click';
      container.appendChild(span1);
      container.appendChild(btn);
      container.appendChild(span2);
      document.body.appendChild(container);

      fireClick(btn);

      const action: RecordedAction = sendAction.mock.calls[0][0];
      expect(action.element!.siblingTexts).toBeDefined();
      expect(action.element!.siblingTexts!.length).toBeGreaterThan(0);
    });
  });

  describe('action properties', () => {
    it('includes timestamp and url', () => {
      recorder.start();
      const btn = createMockElement({ tagName: 'BUTTON', textContent: 'Go' });
      const before = Date.now();
      fireClick(btn);
      const after = Date.now();

      const action: RecordedAction = sendAction.mock.calls[0][0];
      expect(action.timestamp).toBeGreaterThanOrEqual(before);
      expect(action.timestamp).toBeLessThanOrEqual(after);
      expect(action.url).toBe(window.location.href);
    });

    it('generates unique IDs', () => {
      recorder.start();
      const btn = createMockElement({ tagName: 'BUTTON', textContent: 'Go' });
      fireClick(btn);
      fireClick(btn);

      const id1 = sendAction.mock.calls[0][0].id;
      const id2 = sendAction.mock.calls[1][0].id;
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^act_/);
    });
  });
});
