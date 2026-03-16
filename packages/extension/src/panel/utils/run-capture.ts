/**
 * Shared utility to run page capture on the active tab.
 * Extracted from CaptureMode so GuideMode can reuse the same logic.
 */

import type { CaptureSnapshot } from '../reducer.js';

/**
 * Runs the page scanner on the active tab and returns captured elements.
 * This is the same DOM-walking logic from CaptureMode — finds interactive elements,
 * Salesforce field labels+values, shadow DOM paths, etc.
 */
export function runCapture(): Promise<CaptureSnapshot> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        reject(new Error('No active tab found'));
        return;
      }

      chrome.scripting.executeScript(
        {
          target: { tabId: tab.id },
          func: scanPageDOM,
        },
        (results) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || 'Capture failed'));
            return;
          }
          const result = results?.[0]?.result as CaptureSnapshot | undefined;
          if (!result) {
            reject(new Error('No capture result returned'));
            return;
          }
          resolve(result);
        },
      );
    });
  });
}

/**
 * The actual DOM scanning function — runs in the page context via executeScript.
 * Must be self-contained (no imports, no closures).
 */
function scanPageDOM(): {
  url: string;
  title: string;
  elements: Array<{
    id: string;
    tag: string;
    type?: string;
    ariaLabel?: string;
    text?: string;
    xPath: string;
    cssSelector?: string;
    label?: string;
    shadowPath?: string;
    href?: string;
    value?: string;
  }>;
  timestamp: number;
} {
  const elements: Array<{
    id: string;
    tag: string;
    type?: string;
    ariaLabel?: string;
    text?: string;
    xPath: string;
    cssSelector?: string;
    label?: string;
    shadowPath?: string;
    href?: string;
    value?: string;
  }> = [];

  const interactiveTags = new Set([
    'button', 'input', 'select', 'a', 'textarea',
  ]);
  const interactiveRoles = new Set([
    'button', 'textbox', 'combobox', 'listbox', 'checkbox',
    'radio', 'switch', 'slider', 'searchbox', 'spinbutton',
    'link', 'menuitem', 'tab', 'option',
  ]);

  function buildCssSelector(el: Element): string {
    if (el.id) return `#${el.id}`;

    const tag = el.tagName.toLowerCase();
    const testId = el.getAttribute('data-testid') || el.getAttribute('data-aura-rendered-by');
    if (testId) return `[data-testid="${testId}"]`;

    if (el.classList.length > 0) {
      const classSelector = `${tag}.${Array.from(el.classList).map(c => CSS.escape(c)).join('.')}`;
      try {
        if (el.ownerDocument.querySelectorAll(classSelector).length === 1) {
          return classSelector;
        }
      } catch {
        // Fall through to nth-of-type selector below.
      }
    }

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

  function findLabel(el: Element): string | undefined {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    const id = el.id;
    if (id) {
      const rootNode = el.getRootNode() as Document | ShadowRoot;
      const label = ('querySelector' in rootNode ? rootNode.querySelector(`label[for="${id}"]`) : null) as HTMLLabelElement | null;
      if (label?.textContent) return label.textContent.trim();
    }

    const parentLabel = el.closest('label');
    if (parentLabel?.textContent) return parentLabel.textContent.trim().substring(0, 60);

    const parent = el.parentElement;
    if (parent) {
      const prev = el.previousElementSibling;
      if (prev?.tagName === 'LABEL' || prev?.tagName === 'SPAN') {
        const text = prev.textContent?.trim();
        if (text && text.length < 60) return text;
      }
      const sldsLabel = parent.closest('.slds-form-element')?.querySelector('.slds-form-element__label');
      if (sldsLabel?.textContent) return sldsLabel.textContent.trim();
    }

    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder;

    return undefined;
  }

  function buildShadowPath(el: Element): string {
    const parts: string[] = [];
    let current: Element | null = el;

    while (current) {
      const root: Node = current.getRootNode();
      if (root instanceof ShadowRoot) {
        const host: Element = root.host;
        let hostSelector = host.tagName.toLowerCase();
        if (host.id) hostSelector = `#${host.id}`;
        else if (host.className && typeof host.className === 'string') {
          const cls = host.className.trim().split(/\s+/)[0];
          if (cls) hostSelector = `${host.tagName.toLowerCase()}.${cls}`;
        }
        parts.unshift(`${hostSelector} >> shadow >> ${buildElementSelector(current)}`);
        current = host.parentElement;
      } else {
        parts.unshift(buildElementSelector(current));
        break;
      }
    }

    return parts.join(' > ');
  }

  function buildElementSelector(el: Element): string {
    const tag = el.tagName.toLowerCase();
    if (el.id) return `#${el.id}`;
    if (el.className && typeof el.className === 'string') {
      const cls = el.className.trim().split(/\s+/).slice(0, 2).join('.');
      if (cls) return `${tag}.${cls}`;
    }
    return tag;
  }

  // ── First pass: interactive elements via stack-based DOM walk ──
  const seen = new Set<string>();
  const stack: Array<Document | ShadowRoot | Element> = [document];

  while (stack.length > 0 && elements.length < 500) {
    const root = stack.pop()!;

    const children = root instanceof Element
      ? root.children
      : (root as Document | ShadowRoot).children ?? [];

    for (let i = children.length - 1; i >= 0; i--) {
      const el = children[i]!;
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role');

      const isInteractive =
        interactiveTags.has(tag) ||
        (role && interactiveRoles.has(role)) ||
        el.hasAttribute('contenteditable') ||
        el.hasAttribute('aria-label') ||
        el.hasAttribute('data-testid');

      if (isInteractive) {
        const cssSelector = buildCssSelector(el);

        const label = findLabel(el);

        let directText: string | undefined;
        if (el.childNodes.length <= 5) {
          directText = (el.textContent || '').trim().substring(0, 80) || undefined;
        } else {
          const textParts: string[] = [];
          for (let j = 0; j < el.childNodes.length; j++) {
            const node = el.childNodes[j]!;
            if (node.nodeType === Node.TEXT_NODE) {
              const t = (node.textContent || '').trim();
              if (t) textParts.push(t);
            }
          }
          directText = textParts.join(' ').substring(0, 80) || undefined;
        }

        const shadowPath = el.getRootNode() instanceof ShadowRoot
          ? buildShadowPath(el)
          : undefined;

        const displayLabel = label || directText || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || undefined;

        const dedupeKey = `${tag}|${displayLabel || ''}|${directText || ''}|${cssSelector}`;
        if (seen.has(dedupeKey) && !el.id) {
          // skip duplicate, still push children
        } else {
          seen.add(dedupeKey);

          const href = tag === 'a' ? (el as HTMLAnchorElement).href || undefined : undefined;
          const inputValue = (tag === 'input' || tag === 'textarea' || tag === 'select')
            ? (el as HTMLInputElement).value || undefined
            : undefined;

          elements.push({
            id: el.id || `${tag}_${elements.length}`,
            tag,
            type: (el as HTMLInputElement).type || undefined,
            ariaLabel: el.getAttribute('aria-label') || undefined,
            text: directText || undefined,
            xPath: el.id ? `//*[@id="${el.id}"]` : '',
            cssSelector,
            label: displayLabel,
            shadowPath,
            href,
            value: inputValue,
          });
        }
      }

      if (el.shadowRoot) {
        stack.push(el.shadowRoot);
      }
      stack.push(el);
    }
  }

  // ── Second pass: Salesforce detail page field values ──
  const formElements = document.querySelectorAll('.slds-form-element, .slds-form-element_stacked');
  for (const fe of formElements) {
    if (elements.length >= 500) break;

    const labelEl = fe.querySelector('.slds-form-element__label, .test-id__field-label');
    const valueEl = fe.querySelector('.slds-form-element__control, .test-id__field-value');
    if (!labelEl || !valueEl) continue;

    const fieldLabel = labelEl.textContent?.trim();
    if (!fieldLabel || fieldLabel.length < 2) continue;

    const fieldValue = valueEl.textContent?.trim().substring(0, 200);
    if (!fieldValue) continue;

    const linkEl = valueEl.querySelector('a');
    const fieldHref = linkEl?.href || undefined;

    const fieldSnake = fieldLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const dedupeKey = `field_value|${fieldSnake}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const fieldCss = buildCssSelector(fe);

    elements.push({
      id: `field_${fieldSnake || elements.length}`,
      tag: fieldHref ? 'a' : 'span',
      type: 'field_value',
      ariaLabel: undefined,
      text: fieldValue.substring(0, 80),
      xPath: '',
      cssSelector: fieldCss,
      label: fieldLabel,
      shadowPath: undefined,
      href: fieldHref,
      value: fieldValue,
    });
  }

  return {
    url: window.location.href,
    title: document.title,
    elements,
    timestamp: Date.now(),
  };
}
