/**
 * CaptureMode — Engineer UI for teaching the system.
 *
 * Shows:
 * - Current page info
 * - Capture page button to take DOM snapshot
 * - Captured elements list with selectors
 * - Download YAML button to export page definition
 * - Suggested tool cards based on captured page
 */
import React from 'react';

import type { SidePanelState, SidePanelAction, ToolSchema, CapturedElement, CaptureSnapshot } from '../reducer.js';

interface CaptureModeProps {
  state: SidePanelState;
  dispatch: (action: SidePanelAction) => void;
}

function toSnakeCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function bestLabel(el: CapturedElement): string {
  // Priority: explicit label > ariaLabel > visible text > id
  return el.label || el.ariaLabel || el.text || el.id;
}

function fieldId(el: CapturedElement): string {
  const label = bestLabel(el);
  const snake = toSnakeCase(label);
  return snake || el.id;
}

function mapFieldType(el: CapturedElement): string {
  if (el.tag === 'select') return 'picklist';
  if (el.type === 'checkbox') return 'checkbox';
  if (el.type === 'radio') return 'radio';
  if (el.type === 'date' || el.type === 'datetime-local') return 'date';
  if (el.type === 'number') return 'number';
  if (el.type === 'file') return 'file';
  if (el.tag === 'textarea') return 'textarea';
  return 'text';
}

function buildSelectors(el: CapturedElement): string[] {
  const selectors: string[] = [];

  // 1. ARIA strategy (best for resilience)
  if (el.ariaLabel || el.label) {
    const name = el.ariaLabel || el.label;
    let role = 'textbox';
    if (el.type === 'checkbox') role = 'checkbox';
    else if (el.type === 'radio') role = 'radio';
    else if (el.tag === 'select') role = 'combobox';
    else if (el.tag === 'button') role = 'button';
    else if (el.tag === 'a') role = 'link';
    else if (el.type === 'search') role = 'searchbox';
    selectors.push(`    - strategy: aria\n      role: ${role}\n      name: "${name}"`);
  }

  // 2. Label strategy (for labeled form elements)
  if (el.label && el.label !== el.ariaLabel) {
    selectors.push(`    - strategy: label\n      text: "${el.label}"`);
  }

  // 3. CSS strategy (ID-based if available)
  if (el.cssSelector) {
    selectors.push(`    - strategy: css\n      selector: "${el.cssSelector}"`);
  } else if (el.id && !el.id.startsWith('input_') && !el.id.startsWith('checkbox_')) {
    selectors.push(`    - strategy: css\n      selector: "#${el.id}"`);
  }

  // 4. Shadow DOM path (for shadow-piercing)
  if (el.shadowPath) {
    selectors.push(`    - strategy: js\n      expression: "${el.shadowPath.replace(/"/g, '\\"')}"`);
  }

  // Ensure minimum 2 selectors
  if (selectors.length < 2 && el.id) {
    selectors.push(`    - strategy: css\n      selector: "#${el.id}"`);
  }

  return selectors;
}

function generatePageYaml(snapshot: CaptureSnapshot): string {
  const pageId = toSnakeCase(snapshot.title) || 'unnamed_page';

  const fields = snapshot.elements
    .filter((el) => ['input', 'textarea', 'select'].includes(el.tag) && el.type !== 'field_value')
    .map((el) => {
      const id = fieldId(el);
      const label = bestLabel(el);
      const type = mapFieldType(el);
      const selectors = buildSelectors(el);

      return `  - id: ${id}\n    label: "${label}"\n    type: ${type}\n    selectors:\n${selectors.join('\n')}`;
    });

  // Regular outputs (non-interactive, non-field-value elements)
  const regularOutputs = snapshot.elements
    .filter((el) => !['input', 'textarea', 'select', 'button', 'a'].includes(el.tag) && el.type !== 'field_value')
    .slice(0, 10)
    .map((el) => {
      const id = fieldId(el);
      const label = bestLabel(el);
      const selectors = buildSelectors(el);

      return `  - id: ${id}\n    label: "${label}"\n    selectors:\n${selectors.join('\n')}`;
    });

  // Field values from detail page (label + value + optional href)
  const fieldValueOutputs = snapshot.elements
    .filter((el) => el.type === 'field_value')
    .map((el) => {
      const id = fieldId(el);
      const label = bestLabel(el);
      const elWithExtras = el as CapturedElement & { href?: string; value?: string };
      const value = elWithExtras.value || el.text || '';
      const href = elWithExtras.href;

      let entry = `  - id: ${id}\n    label: "${label}"`;
      if (value) entry += `\n    value: "${value.substring(0, 200).replace(/"/g, '\\"')}"`;
      if (href) entry += `\n    href: "${href}"`;
      if (el.cssSelector) {
        entry += `\n    selectors:\n    - strategy: css\n      selector: "${el.cssSelector}"`;
      }
      return entry;
    });

  const outputs = [...regularOutputs, ...fieldValueOutputs];

  return [
    `id: ${pageId}`,
    `app: my_app`,
    `url_pattern: "${snapshot.url}"`,
    `wait_for:`,
    `  type: selector`,
    `  value: "body"`,
    fields.length > 0 ? `fields:\n${fields.join('\n')}` : '',
    outputs.length > 0 ? `outputs:\n${outputs.join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

function handleCapture(dispatch: (action: SidePanelAction) => void): void {
  dispatch({ type: 'SET_CAPTURING', payload: true });
  dispatch({ type: 'CLEAR_ERROR' });

  // Get active tab and request DOM snapshot from content script
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) {
      dispatch({ type: 'SET_ERROR', payload: 'No active tab found' });
      dispatch({ type: 'SET_CAPTURING', payload: false });
      return;
    }

    // Execute capture script in the content script context
    chrome.scripting.executeScript(
      {
        target: { tabId: tab.id },
        func: () => {
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

          // Find the closest label text for a form element
          function findLabel(el: Element): string | undefined {
            // Check for aria-label
            const ariaLabel = el.getAttribute('aria-label');
            if (ariaLabel) return ariaLabel;

            // Check for associated <label>
            const id = el.id;
            if (id) {
              // Search in both light DOM and shadow roots
              const rootNode = el.getRootNode() as Document | ShadowRoot;
              const label = ('querySelector' in rootNode ? rootNode.querySelector(`label[for="${id}"]`) : null) as HTMLLabelElement | null;
              if (label?.textContent) return label.textContent.trim();
            }

            // Check for parent label
            const parentLabel = el.closest('label');
            if (parentLabel?.textContent) return parentLabel.textContent.trim().substring(0, 60);

            // Check for preceding sibling or parent text
            const parent = el.parentElement;
            if (parent) {
              const prev = el.previousElementSibling;
              if (prev?.tagName === 'LABEL' || prev?.tagName === 'SPAN') {
                const text = prev.textContent?.trim();
                if (text && text.length < 60) return text;
              }
              // Salesforce-specific: look for .slds-form-element__label
              const sldsLabel = parent.closest('.slds-form-element')?.querySelector('.slds-form-element__label');
              if (sldsLabel?.textContent) return sldsLabel.textContent.trim();
            }

            // Check placeholder
            const placeholder = el.getAttribute('placeholder');
            if (placeholder) return placeholder;

            return undefined;
          }

          // Build a CSS path that pierces shadow DOM
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

          // Iterative DOM walk using a stack — handles deeply nested shadow DOM
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
                let cssSelector = '';
                if (el.id) {
                  cssSelector = `#${el.id}`;
                } else if (el.className && typeof el.className === 'string') {
                  const cls = el.className.trim().split(/\s+/).slice(0, 2).join('.');
                  if (cls) cssSelector = `${tag}.${cls}`;
                }

                const label = findLabel(el);

                // Get direct/shallow text — prefer innerText of the element itself
                // For small elements, grab textContent; for large containers, only grab
                // text from direct text nodes to avoid pulling in all descendant text
                let directText: string | undefined;
                if (el.childNodes.length <= 5) {
                  directText = (el.textContent || '').trim().substring(0, 80) || undefined;
                } else {
                  // Only get text from direct text node children
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

                // Build a unique display name for this element
                const displayLabel = label || directText || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || undefined;

                // Skip duplicate elements with same tag + same display info + same text + same cssSelector
                const dedupeKey = `${tag}|${displayLabel || ''}|${directText || ''}|${cssSelector}`;
                if (seen.has(dedupeKey) && !el.id) {
                  // still push to stack for children
                } else {
                  seen.add(dedupeKey);

                  // Capture href for links
                  const href = tag === 'a' ? (el as HTMLAnchorElement).href || undefined : undefined;

                  // Capture value for inputs
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

              // Push shadow root first (will be processed after children)
              if (el.shadowRoot) {
                stack.push(el.shadowRoot);
              }

              // Push element to walk its children
              stack.push(el);
            }
          }

          // ── Second pass: Salesforce detail page field values ──
          // Captures label+value pairs from .slds-form-element containers
          // These contain read-only field data like URLs, dates, text values
          const formElements = document.querySelectorAll('.slds-form-element, .slds-form-element_stacked');
          for (const fe of formElements) {
            if (elements.length >= 500) break;

            const labelEl = fe.querySelector('.slds-form-element__label, .test-id__field-label');
            const valueEl = fe.querySelector('.slds-form-element__control, .test-id__field-value');
            if (!labelEl || !valueEl) continue;

            const fieldLabel = labelEl.textContent?.trim();
            if (!fieldLabel || fieldLabel.length < 2) continue;

            // Get text value
            const fieldValue = valueEl.textContent?.trim().substring(0, 200);
            if (!fieldValue) continue;

            // Check for link inside the value
            const linkEl = valueEl.querySelector('a');
            const fieldHref = linkEl?.href || undefined;

            const fieldSnake = fieldLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
            const dedupeKey = `field_value|${fieldSnake}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);

            let fieldCss = '';
            if (fe.id) fieldCss = `#${fe.id}`;
            else if (fe.className && typeof fe.className === 'string') {
              const cls = fe.className.trim().split(/\s+/).slice(0, 2).join('.');
              if (cls) fieldCss = `div.${cls}`;
            }

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
        },
      },
      (results) => {
        if (chrome.runtime.lastError) {
          dispatch({ type: 'SET_ERROR', payload: chrome.runtime.lastError.message || 'Capture failed' });
          dispatch({ type: 'SET_CAPTURING', payload: false });
          return;
        }

        const result = results?.[0]?.result as CaptureSnapshot | undefined;
        if (!result) {
          dispatch({ type: 'SET_ERROR', payload: 'No capture result returned' });
          dispatch({ type: 'SET_CAPTURING', payload: false });
          return;
        }

        dispatch({ type: 'SET_SNAPSHOT', payload: result });
        dispatch({
          type: 'UPDATE_PAGE',
          payload: { url: result.url, title: result.title },
        });
      },
    );
  });
}

function downloadYaml(yaml: string, filename: string): void {
  const blob = new Blob([yaml], { type: 'text/yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function CaptureMode({ state, dispatch }: CaptureModeProps): React.JSX.Element {
  const snapshot = state.snapshot;

  const inputElements = snapshot?.elements.filter((el) =>
    ['input', 'textarea', 'select'].includes(el.tag) && el.type !== 'field_value',
  ) ?? [];

  const buttonElements = snapshot?.elements.filter((el) =>
    (el.tag === 'button' || (el.tag === 'a' && el.type !== 'field_value')),
  ) ?? [];

  const fieldValues = snapshot?.elements.filter((el) =>
    el.type === 'field_value',
  ) ?? [];

  const otherElements = snapshot?.elements.filter((el) =>
    !['input', 'textarea', 'select', 'button', 'a'].includes(el.tag) && el.type !== 'field_value',
  ) ?? [];

  return (
    <div className="capture-panel">
      {state.currentPageUrl && (
        <div className="page-info" style={{ marginBottom: '8px', fontSize: '12px', color: '#666' }}>
          <div className="page-url" style={{ wordBreak: 'break-all' }}>{state.currentPageUrl}</div>
          {state.currentPageTitle && (
            <div className="page-title" style={{ fontWeight: 'bold' }}>{state.currentPageTitle}</div>
          )}
        </div>
      )}

      <button
        className="capture-button"
        disabled={state.capturing}
        onClick={() => handleCapture(dispatch)}
        style={{ padding: '8px 16px', cursor: state.capturing ? 'wait' : 'pointer' }}
      >
        {state.capturing ? 'Capturing...' : 'Capture Page'}
      </button>

      {state.error && (
        <div style={{ color: 'red', marginTop: '8px', fontSize: '13px' }}>{state.error}</div>
      )}

      {snapshot && (
        <div style={{ marginTop: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: '0 0 8px' }}>
              Captured {snapshot.elements.length} elements
            </h3>
            <button
              onClick={() => downloadYaml(
                generatePageYaml(snapshot),
                `${snapshot.title.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'page'}.yaml`,
              )}
              style={{ fontSize: '12px', padding: '4px 8px' }}
            >
              Download YAML
            </button>
          </div>

          {inputElements.length > 0 && (
            <div>
              <h4 style={{ margin: '8px 0 4px', color: '#2563eb' }}>Fields ({inputElements.length})</h4>
              {inputElements.map((el: CapturedElement) => (
                <div key={el.id} style={{ fontSize: '12px', padding: '4px', borderBottom: '1px solid #eee' }}>
                  <strong>{el.label || el.ariaLabel || el.id}</strong>
                  <span style={{ color: '#888', marginLeft: '4px' }}>{el.tag}{el.type ? `[${el.type}]` : ''}</span>
                  {el.text && el.text !== el.label && (
                    <span style={{ color: '#555', marginLeft: '4px', fontStyle: 'italic' }}>"{el.text.substring(0, 30)}"</span>
                  )}
                  {el.cssSelector && <code style={{ display: 'block', color: '#059669', fontSize: '11px' }}>{el.cssSelector}</code>}
                  {el.shadowPath && <code style={{ display: 'block', color: '#9333ea', fontSize: '10px' }}>shadow: {el.shadowPath}</code>}
                </div>
              ))}
            </div>
          )}

          {buttonElements.length > 0 && (
            <div>
              <h4 style={{ margin: '8px 0 4px', color: '#dc2626' }}>Buttons/Links ({buttonElements.length})</h4>
              {buttonElements.map((el: CapturedElement) => (
                <div key={el.id} style={{ fontSize: '12px', padding: '4px', borderBottom: '1px solid #eee' }}>
                  <strong>{el.label || el.text || el.ariaLabel || el.id}</strong>
                  <span style={{ color: '#888', marginLeft: '4px' }}>{el.tag}</span>
                  {(el as CapturedElement & { href?: string }).href && (
                    <code style={{ display: 'block', color: '#2563eb', fontSize: '10px', wordBreak: 'break-all' }}>
                      {(el as CapturedElement & { href?: string }).href}
                    </code>
                  )}
                  {el.cssSelector && <code style={{ display: 'block', color: '#059669', fontSize: '11px' }}>{el.cssSelector}</code>}
                </div>
              ))}
            </div>
          )}

          {fieldValues.length > 0 && (
            <div>
              <h4 style={{ margin: '8px 0 4px', color: '#0891b2' }}>Field Values ({fieldValues.length})</h4>
              {fieldValues.map((el: CapturedElement) => (
                <div key={el.id} style={{ fontSize: '12px', padding: '4px', borderBottom: '1px solid #eee' }}>
                  <strong>{el.label}</strong>
                  <span style={{ color: '#555', marginLeft: '4px' }}>
                    = {((el as CapturedElement & { value?: string }).value || el.text || '').substring(0, 60)}
                  </span>
                  {(el as CapturedElement & { href?: string }).href && (
                    <code style={{ display: 'block', color: '#2563eb', fontSize: '10px', wordBreak: 'break-all' }}>
                      {(el as CapturedElement & { href?: string }).href}
                    </code>
                  )}
                </div>
              ))}
            </div>
          )}

          {otherElements.length > 0 && (
            <div>
              <h4 style={{ margin: '8px 0 4px', color: '#7c3aed' }}>Outputs ({otherElements.length})</h4>
              {otherElements.map((el: CapturedElement) => (
                <div key={el.id} style={{ fontSize: '12px', padding: '4px', borderBottom: '1px solid #eee' }}>
                  <strong>{el.label || el.text?.substring(0, 40) || el.ariaLabel || el.id}</strong>
                  <span style={{ color: '#888', marginLeft: '4px' }}>{el.tag}</span>
                  {el.text && el.text !== el.label && (
                    <span style={{ color: '#555', marginLeft: '4px', fontStyle: 'italic' }}>"{el.text.substring(0, 30)}"</span>
                  )}
                  {el.cssSelector && <code style={{ display: 'block', color: '#059669', fontSize: '11px' }}>{el.cssSelector}</code>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {state.suggestedTools.length > 0 && (
        <div className="suggested-tools">
          <h3>Suggested Tools</h3>
          {state.suggestedTools.map((tool: ToolSchema) => (
            <div key={tool.name} className="tool-card">
              <h4>{tool.name}</h4>
              <p>{tool.description}</p>
              <button
                onClick={() => dispatch({ type: 'SELECT_TOOL', payload: tool })}
              >
                Use This Tool
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
