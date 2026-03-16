/**
 * Deterministic YAML builder — converts recorded actions + captured page snapshots
 * into valid semantic definitions WITHOUT AI-generated selectors.
 *
 * Selectors come from the actual page scan (CaptureSnapshot).
 * AI only provides: tool name, description, template variable names.
 */

import type { CaptureSnapshot, CapturedElement } from '../reducer.js';
import type { RecordedAction } from '../../content-script/recorder.js';

// ─── Types ──────────────────────────────────────────────

export interface ToolMetadata {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  /** Maps URL path segments to parameter names, e.g. { "001abc": "account_id" } */
  templateVariables: Record<string, string>;
}

interface PageField {
  id: string;
  label: string;
  type: string;
  selectors: Array<Record<string, unknown>>;
  interaction: { type: string; value?: string };
}

interface PageOutput {
  id: string;
  label: string;
  selectors: Array<Record<string, unknown>>;
  capture_strategies?: Array<Record<string, unknown>>;
}

export interface PageDefinition {
  page: {
    id: string;
    app: string;
    url_pattern: string;
    url_template: string;
    wait_for: string;
    fields: PageField[];
    outputs: PageOutput[];
  };
}

export interface AppDefinition {
  app: {
    id: string;
    name: string;
    base_url: string;
    url_patterns: string[];
  };
}

export interface ToolDefinition {
  tool: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    bridge: {
      page: string;
      steps: Array<Record<string, unknown>>;
      returns: Record<string, string>;
    };
  };
}

// ─── Helpers ────────────────────────────────────────────

function toSnakeCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function normalizeText(str: string | undefined): string {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenize(str: string | undefined): string[] {
  const normalized = normalizeText(str);
  return normalized ? normalized.split(/\s+/) : [];
}

function titleCase(str: string): string {
  return str
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function createUniqueId(raw: string, usedIds: Set<string>, fallback: string): string {
  const base = toSnakeCase(raw) || fallback;
  let candidate = base;
  let suffix = 2;

  while (usedIds.has(candidate)) {
    candidate = `${base}_${suffix++}`;
  }

  usedIds.add(candidate);
  return candidate;
}

function isSpecificCssSelector(selector: string | undefined): boolean {
  if (!selector) return false;

  return selector.startsWith('#') ||
    selector.startsWith('[') ||
    selector.includes('.') ||
    selector.includes(':') ||
    selector.includes(' ') ||
    selector.includes('>');
}

function buildLabelRelativeJs(label: string): string {
  const escapedLabel = label.replace(/'/g, "\\'");
  return `(() => { const labels = document.querySelectorAll('.slds-form-element__label, .test-id__field-label'); for (const l of labels) { if (l.textContent.trim() === '${escapedLabel}') { const fe = l.closest('.slds-form-element'); if (fe) { const a = fe.querySelector('a'); if (a) return a; const input = fe.querySelector('input, select, textarea, button'); if (input) return input; const val = fe.querySelector('.slds-form-element__control, .test-id__field-value'); if (val) return val; } } } return null; })()`;
}

/**
 * Build selector chain for a captured element.
 * Uses the actual selectors from the page scan — never invents.
 */
function buildSelectors(el: CapturedElement): Array<Record<string, unknown>> {
  const selectors: Array<Record<string, unknown>> = [];

  // 1. ARIA strategy
  if (el.ariaLabel || el.label) {
    const name = el.ariaLabel || el.label;
    let role = 'textbox';
    if (el.type === 'checkbox') role = 'checkbox';
    else if (el.type === 'radio') role = 'radio';
    else if (el.tag === 'select') role = 'combobox';
    else if (el.tag === 'button') role = 'button';
    else if (el.tag === 'a') role = 'link';
    else if (el.type === 'search') role = 'searchbox';
    else if (el.type === 'tab' || el.ariaLabel?.toLowerCase().includes('tab')) role = 'tab';
    selectors.push({ strategy: 'aria', role, name, confidence: 0.95 });
  }

  // 2. Text strategy (for buttons and links with visible text)
  if (el.text && (el.tag === 'button' || el.tag === 'a') && !el.text.includes('\n')) {
    const textVal = el.text.substring(0, 60).trim();
    if (textVal.length > 0 && textVal.length < 60) {
      selectors.push({ strategy: 'text', text: textVal, exact: true, confidence: 0.85 });
    }
  }

  // 3. CSS strategy (from actual page scan)
  if (el.cssSelector && (isSpecificCssSelector(el.cssSelector) || selectors.length === 0)) {
    selectors.push({ strategy: 'css', selector: el.cssSelector, confidence: 0.80 });
  }

  // 4. Shadow DOM JS strategy
  if (el.shadowPath) {
    selectors.push({
      strategy: 'js',
      expression: `(() => { const el = document.querySelector('${el.shadowPath.replace(/'/g, "\\'")}'); return el; })()`,
      confidence: 0.75,
    });
  }

  // 5. Label-relative JS strategy for field_value types (Salesforce fields)
  if (el.type === 'field_value' && el.label) {
    selectors.push({ strategy: 'js', expression: buildLabelRelativeJs(el.label), confidence: 0.85 });
  }

  // Interactive Salesforce fields often only expose weak selectors like plain "a" or "button".
  if (el.label && (el.tag === 'a' || el.tag === 'button') && !isSpecificCssSelector(el.cssSelector)) {
    selectors.push({ strategy: 'js', expression: buildLabelRelativeJs(el.label), confidence: 0.82 });
  }

  // Ensure at least one selector
  if (selectors.length === 0 && el.id) {
    selectors.push({ strategy: 'css', selector: `#${el.id}`, confidence: 0.70 });
  }

  return selectors;
}

function mapFieldType(el: CapturedElement): string {
  if (el.tag === 'select') return 'picklist';
  if (el.type === 'checkbox') return 'checkbox';
  if (el.type === 'radio') return 'radio';
  if (el.tag === 'button' || el.tag === 'a') return 'action_button';
  if (el.tag === 'textarea') return 'textarea';
  return 'text';
}

function mapInteraction(el: CapturedElement): { type: string } {
  if (el.tag === 'button' || el.tag === 'a') return { type: 'click' };
  if (el.tag === 'select') return { type: 'select' };
  if (el.type === 'checkbox') return { type: 'check' };
  return { type: 'fill' };
}

function isSalesforceId(segment: string): boolean {
  return /^[a-zA-Z0-9]{15,18}$/.test(segment);
}

export function deriveTemplateVariables(pages: string[]): Record<string, string> {
  const templateVars: Record<string, string> = {};

  for (const url of pages) {
    try {
      const parts = new URL(url).pathname.split('/').filter(Boolean);
      const rIdx = parts.indexOf('r');
      if (rIdx >= 0 && parts[rIdx + 1] && parts[rIdx + 2]) {
        const objectName = parts[rIdx + 1]!;
        const objectId = parts[rIdx + 2]!;
        if (isSalesforceId(objectId)) {
          const paramName = `${toSnakeCase(objectName)}_id`;
          if (paramName && !templateVars[objectId]) {
            templateVars[objectId] = paramName;
          }
        }
      }
    } catch {
      // Ignore malformed URLs in partial recordings.
    }
  }

  return templateVars;
}

// Extract URL pattern by replacing IDs with wildcards.
// e.g. /lightning/r/Account/001abc/view -> /lightning/r/Account/{wildcard}/view
function urlToPattern(url: string): string {
  try {
    const u = new URL(url);
    // Replace Salesforce 15/18-char IDs with *
    return u.pathname.replace(/\/[a-zA-Z0-9]{15,18}(?=\/|$)/g, '/*');
  } catch {
    return url;
  }
}

/**
 * Build URL template from URL + template variables.
 * e.g. /lightning/r/Account/001abc/view with { "001abc": "account_id" }
 *   -> {{app.base_url}}/lightning/r/Account/{{account_id}}/view
 */
function urlToTemplate(url: string, templateVars: Record<string, string>): string {
  try {
    const u = new URL(url);
    let path = u.pathname;
    for (const [literal, paramName] of Object.entries(templateVars)) {
      path = path.replace(literal, `{{${paramName}}}`);
    }
    return `{{app.base_url}}${path}`;
  } catch {
    return url;
  }
}

/**
 * Derive a page ID from URL path.
 * e.g. /lightning/r/Account/001abc/view -> account_view
 */
function urlToPageId(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    // For Salesforce: /lightning/r/ObjectName/ID/view -> objectname_view
    // But /lightning/r/ObjectName/ID/related/Cases/view -> objectname_related_cases_view
    const objectIdx = parts.indexOf('r');
    if (objectIdx >= 0 && parts[objectIdx + 1]) {
      const obj = parts[objectIdx + 1]!.toLowerCase();
      // Collect all meaningful path segments after the ID
      const afterObj = parts.slice(objectIdx + 2);
      const meaningful = afterObj.filter(p => !isSalesforceId(p));
      if (meaningful.length > 0) {
        return `${obj}_${meaningful.map(s => s.toLowerCase()).join('_')}`;
      }
      return `${obj}_detail`;
    }
    // For /lightning/n/ObjectName -> objectname
    const nIdx = parts.indexOf('n');
    if (nIdx >= 0 && parts[nIdx + 1]) {
      return toSnakeCase(parts[nIdx + 1]!) || 'page';
    }
    // Fallback: last meaningful path segment
    const meaningful = parts.filter(p => !isSalesforceId(p));
    return toSnakeCase(meaningful.slice(-2).join('_')) || 'page';
  } catch {
    return 'page';
  }
}

// ─── Match recorded action to captured element ──────────

/**
 * Find the best matching CapturedElement for a recorded action.
 * Matches by score across CSS selector, label/nearbyLabel, aria, text, and id.
 */
function matchActionToElement(
  action: RecordedAction,
  snapshot: CaptureSnapshot,
): CapturedElement | null {
  const el = action.element;
  if (!el) return null;

  let bestMatch: CapturedElement | null = null;
  let bestScore = 0;

  for (const candidate of snapshot.elements) {
    let score = 0;

    if (el.selectors?.css && candidate.cssSelector && el.selectors.css === candidate.cssSelector) {
      score += 200;
    }

    if (el.id && candidate.id && el.id === candidate.id) {
      score += 180;
    }

    const actionAria = normalizeText((el.selectors?.aria as { name?: string } | undefined)?.name || el.ariaLabel);
    const candidateAria = normalizeText(candidate.ariaLabel || candidate.label);
    if (actionAria && candidateAria) {
      if (actionAria === candidateAria) score += 140;
      else if (candidateAria.includes(actionAria) || actionAria.includes(candidateAria)) score += 90;
    }

    const actionLabels = [el.nearbyLabel, el.ariaLabel, el.text];
    const candidateLabels = [candidate.label, candidate.ariaLabel, candidate.text];
    for (const actionLabel of actionLabels) {
      const normalizedAction = normalizeText(actionLabel);
      if (!normalizedAction) continue;
      for (const candidateLabel of candidateLabels) {
        const normalizedCandidate = normalizeText(candidateLabel);
        if (!normalizedCandidate) continue;
        if (normalizedAction === normalizedCandidate) score += 120;
        else if (normalizedCandidate.includes(normalizedAction) || normalizedAction.includes(normalizedCandidate)) score += 70;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  }

  return bestScore >= 70 ? bestMatch : null;
}

interface IndexedPageField {
  id: string;
  label: string;
  type: string;
  interactionType: string;
  selectors: Array<Record<string, unknown>>;
}

interface ResolvedFieldMatch {
  id: string;
  label: string;
  type: string;
  interactionType: string;
}

interface QuickFilterState {
  active: boolean;
  nextFilterIndex: number;
  selectedValues: string[];
}

function collectActionHints(
  action: RecordedAction,
  matchedElement: CapturedElement | null,
): string[] {
  const hints = [
    action.element?.nearbyLabel,
    action.element?.ariaLabel,
    (action.element?.selectors?.aria as { name?: string } | undefined)?.name,
    action.element?.text,
    action.element?.id,
    matchedElement?.label,
    matchedElement?.ariaLabel,
    matchedElement?.text,
    matchedElement?.id,
  ]
    .map(value => normalizeText(value))
    .filter(Boolean);

  return Array.from(new Set(hints));
}

function findFieldByExactSelector(
  fields: IndexedPageField[],
  action: RecordedAction,
  matchedElement: CapturedElement | null,
): string | null {
  const actionCss = action.element?.selectors?.css;
  const actionAria = action.element?.selectors?.aria as { role?: string; name?: string } | undefined;
  const matchedCss = matchedElement?.cssSelector;
  const matchedAria = matchedElement?.ariaLabel;

  for (const field of fields) {
    for (const selector of field.selectors) {
      if (selector.strategy === 'css' && typeof selector.selector === 'string') {
        if (!isSpecificCssSelector(selector.selector)) {
          continue;
        }
        if ((actionCss && selector.selector === actionCss) || (matchedCss && selector.selector === matchedCss)) {
          return field.id;
        }
      }

      if (selector.strategy === 'aria' && typeof selector.name === 'string') {
        const selectorName = normalizeText(selector.name);
        const selectorRole = typeof selector.role === 'string' ? selector.role : undefined;
        const actionName = normalizeText(actionAria?.name || action.element?.ariaLabel);
        const matchedName = normalizeText(matchedAria);

        if (selectorRole && actionAria?.role && selectorRole !== actionAria.role) {
          continue;
        }

        if ((actionName && selectorName === actionName) || (matchedName && selectorName === matchedName)) {
          return field.id;
        }
      }

      if (selector.strategy === 'text' && typeof selector.text === 'string') {
        const selectorText = normalizeText(selector.text);
        const actionText = normalizeText(action.element?.text);
        const matchedText = normalizeText(matchedElement?.text);
        if ((actionText && selectorText === actionText) || (matchedText && selectorText === matchedText)) {
          return field.id;
        }
      }
    }
  }

  return null;
}

function scoreFieldMatch(field: IndexedPageField, hints: string[], action: RecordedAction): number {
  const normalizedLabel = normalizeText(field.label);
  const normalizedId = normalizeText(field.id);
  const labelTokens = new Set(tokenize(field.label));
  let score = 0;

  for (const hint of hints) {
    if (!hint) continue;

    if (hint === normalizedLabel || hint === normalizedId) {
      score += 120;
      continue;
    }

    if (normalizedLabel.includes(hint) || hint.includes(normalizedLabel) ||
        normalizedId.includes(hint) || hint.includes(normalizedId)) {
      score += 75;
    }

    const hintTokens = tokenize(hint);
    if (hintTokens.length > 0) {
      const overlap = hintTokens.filter(token => labelTokens.has(token));
      if (overlap.length > 0) {
        score += overlap.length * 20;
        if (overlap.length === hintTokens.length) {
          score += 30;
        }
      }
    }
  }

  if ((action.element?.tag === 'button' || action.element?.tag === 'a') && field.type === 'action_button') {
    score += 10;
  }

  if (action.type === 'input') {
    if (field.interactionType === 'select' || field.interactionType === 'fill') {
      score += 25;
    }
    if (field.type === 'action_button') {
      score -= 80;
    }
  }

  if (action.type === 'click' && field.type === 'picklist') {
    score -= 10;
  }

  return score;
}

function resolveFieldForAction(
  action: RecordedAction,
  snapshot: CaptureSnapshot | null,
  pageDef: PageDefinition | null,
): ResolvedFieldMatch | null {
  if (!pageDef) return null;

  const indexedFields: IndexedPageField[] = pageDef.page.fields.map(field => ({
    id: field.id,
    label: field.label,
    type: field.type,
    interactionType: field.interaction.type,
    selectors: field.selectors,
  }));

  const matchedElement = snapshot ? matchActionToElement(action, snapshot) : null;
  const exactSelectorMatch = findFieldByExactSelector(indexedFields, action, matchedElement);
  if (exactSelectorMatch) {
    const field = indexedFields.find(candidate => candidate.id === exactSelectorMatch)!;
    return {
      id: field.id,
      label: field.label,
      type: field.type,
      interactionType: field.interactionType,
    };
  }

  const hints = collectActionHints(action, matchedElement);
  let bestField: IndexedPageField | null = null;
  let bestScore = 0;

  for (const field of indexedFields) {
    const score = scoreFieldMatch(field, hints, action);
    if (score > bestScore) {
      bestScore = score;
      bestField = field;
    }
  }

  if (bestScore < 60 || !bestField) {
    return null;
  }

  return {
    id: bestField.id,
    label: bestField.label,
    type: bestField.type,
    interactionType: bestField.interactionType,
  };
}

function isFilterIntent(meta: ToolMetadata): boolean {
  const text = `${meta.name} ${meta.description}`.toLowerCase();
  return text.includes('filter') || text.includes('status');
}

function getFieldIdFromRef(fieldRef: string | undefined): string {
  if (!fieldRef) return '';
  const parts = fieldRef.split('.fields.');
  return parts[1] || '';
}

function hasField(pageDef: PageDefinition | null, fieldId: string): boolean {
  return !!pageDef?.page.fields.some(field => field.id === fieldId);
}

function supportsQuickFilters(pageDef: PageDefinition | null): boolean {
  return hasField(pageDef, 'show_quick_filters') && hasField(pageDef, 'filter_1');
}

function isQuickFilterNoiseFieldId(fieldId: string): boolean {
  return fieldId === 'merge_cases' ||
    fieldId === 'list_view_controls' ||
    fieldId === 'column_sort' ||
    fieldId.endsWith('_column_width') ||
    /^show_.+_column_actions$/.test(fieldId) ||
    /^sort_by_/.test(fieldId);
}

function formatSelectionToken(raw: string): string {
  const normalized = raw.replace(/[_-]+/g, ' ').trim();
  if (!normalized) return '';
  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function extractQuickFilterValueCandidate(
  action: RecordedAction,
  resolved: ResolvedFieldMatch | null,
  slotIndex: number,
): string | null {
  const inputValue = (action.metadata?.inputValue as string | undefined)?.trim();
  if (inputValue) {
    return inputValue;
  }

  if (!resolved) {
    return null;
  }

  if (slotIndex === 1) {
    const showColumnMatch = resolved.id.match(/^show_(.+)_column_actions$/);
    if (showColumnMatch?.[1]) {
      return formatSelectionToken(showColumnMatch[1]);
    }

    const sortMatch = resolved.id.match(/^sort_by_(.+)$/);
    if (sortMatch?.[1]) {
      return formatSelectionToken(sortMatch[1]);
    }
  }

  if (slotIndex >= 2) {
    if (isQuickFilterNoiseFieldId(resolved.id) || resolved.id === 'show_quick_filters') {
      return null;
    }

    const candidate = action.element?.text || action.element?.ariaLabel || resolved.label;
    const normalized = normalizeText(candidate);
    if (!normalized || normalized.includes('show ') || normalized.includes('sort by') || normalized.includes('column')) {
      return null;
    }

    if (candidate && candidate.trim().length <= 32) {
      return candidate.trim();
    }
  }

  return null;
}

export function buildAppDefinition(appId: string, pages: string[]): AppDefinition {
  let baseUrl = '';
  const urlPatterns = new Set<string>();

  for (const url of pages) {
    try {
      const parsed = new URL(url);
      if (!baseUrl) {
        baseUrl = parsed.origin;
      }
      urlPatterns.add(urlToPattern(url));
    } catch {
      // Ignore invalid URLs in partially recorded sessions.
    }
  }

  return {
    app: {
      id: appId,
      name: titleCase(appId),
      base_url: baseUrl,
      url_patterns: Array.from(urlPatterns),
    },
  };
}

// ─── Build Page Definition ──────────────────────────────

export function buildPageDefinition(
  snapshot: CaptureSnapshot,
  appId: string,
  templateVars: Record<string, string>,
): PageDefinition {
  const pageId = urlToPageId(snapshot.url);
  const urlPattern = urlToPattern(snapshot.url);
  const urlTemplate = urlToTemplate(snapshot.url, templateVars);

  const fields: PageField[] = [];
  const outputs: PageOutput[] = [];
  const usedIds = new Set<string>();

  for (const el of snapshot.elements) {
    const fallbackId = `el_${fields.length + outputs.length + 1}`;
    const fieldId = createUniqueId(
      el.label || el.text || el.id || fallbackId,
      usedIds,
      fallbackId,
    );
    const selectors = buildSelectors(el);
    if (selectors.length === 0) continue;

    if (el.type === 'field_value') {
      // This is a read-only field value (from Salesforce .slds-form-element)
      outputs.push({
        id: fieldId,
        label: el.label || el.text || fieldId,
        selectors,
        ...(el.href ? {
          capture_strategies: [{
            type: 'attribute',
            attribute: 'href',
            selectors,
          }],
        } : {
          capture_strategies: [{
            type: 'text_content',
            selectors,
          }],
        }),
      });
    } else if (el.tag === 'button' || el.tag === 'a' || el.tag === 'input' || el.tag === 'select' || el.tag === 'textarea') {
      fields.push({
        id: fieldId,
        label: el.label || el.text || fieldId,
        type: mapFieldType(el),
        selectors,
        interaction: mapInteraction(el),
      });
    }
  }

  return {
    page: {
      id: pageId,
      app: appId,
      url_pattern: urlPattern,
      url_template: urlTemplate,
      wait_for: '.slds-page-header',
      fields,
      outputs,
    },
  };
}

// ─── Build Tool Definition ──────────────────────────────

export function buildToolDefinition(
  actions: RecordedAction[],
  pageSnapshots: Record<string, CaptureSnapshot>,
  meta: ToolMetadata,
  pageDefinitions: PageDefinition[] = [],
): ToolDefinition {
  const steps: Array<Record<string, unknown>> = [];
  const returns: Record<string, string> = {};
  let currentPageId = '';
  let lastUrl = '';
  const quickFilterState: QuickFilterState = {
    active: false,
    nextFilterIndex: 1,
    selectedValues: [],
  };

  for (let idx = 0; idx < actions.length; idx++) {
    const action = actions[idx]!;
    const actionUrl = action.url || (action.metadata?.toUrl as string) || '';

    // Find the matching snapshot for this action's URL
    const snapshot = findSnapshotForUrl(actionUrl, pageSnapshots, action.timestamp);
    const pageId = snapshot ? urlToPageId(snapshot.url) : currentPageId;

    // Detect page change — emit navigate step
    if (actionUrl && actionUrl !== lastUrl && pageId && pageId !== currentPageId) {
      const navigateStep: Record<string, unknown> = {
        navigate: { page: pageId },
      };

      const params: Record<string, string> = {};
      for (const [literal, paramName] of Object.entries(meta.templateVariables)) {
        if (actionUrl.includes(literal)) {
          params[paramName] = `{{${paramName}}}`;
        }
      }
      if (Object.keys(params).length > 0) {
        (navigateStep.navigate as Record<string, unknown>).params = params;
      }

      steps.push(navigateStep);
      steps.push({ wait: 2000 });
      currentPageId = pageId;
      lastUrl = actionUrl;
    } else if (actionUrl && actionUrl !== lastUrl) {
      lastUrl = actionUrl;
    }

    // Build a field reference for this action
    const pageDef = pageDefinitions.find(def => def.page.id === pageId) || null;
    const filterIntent = isFilterIntent(meta);
    const quickFilterSupported = supportsQuickFilters(pageDef);
    const getResolvedField = (): { fieldRef: string; field: ResolvedFieldMatch } | null => {
      const field = resolveFieldForAction(action, snapshot, pageDef);
      if (!field) {
        return null;
      }
      return {
        fieldRef: `${currentPageId || pageId || 'page'}.fields.${field.id}`,
        field,
      };
    };

    // Emit step for EVERY recorded action
    switch (action.type) {
      case 'click': {
        const resolved = getResolvedField();
        if (resolved) {
          if (filterIntent && quickFilterSupported && resolved.field.id === 'show_quick_filters') {
            quickFilterState.active = true;
          } else if (filterIntent && quickFilterSupported && quickFilterState.active) {
            const selectionValue = extractQuickFilterValueCandidate(
              action,
              resolved.field,
              quickFilterState.nextFilterIndex,
            );

            if (selectionValue && hasField(pageDef, `filter_${quickFilterState.nextFilterIndex}`)) {
              if (!quickFilterState.selectedValues.includes(selectionValue)) {
                steps.push({
                  interact: {
                    field: `${currentPageId || pageId || 'page'}.fields.filter_${quickFilterState.nextFilterIndex}`,
                    action: 'select',
                    value: selectionValue,
                  },
                });
                steps.push({ wait: 500 });
                quickFilterState.selectedValues.push(selectionValue);
                quickFilterState.nextFilterIndex += 1;
              }
              break;
            }

            if (isQuickFilterNoiseFieldId(resolved.field.id)) {
              break;
            }
          }

          steps.push({
            interact: { field: resolved.fieldRef, action: 'click' },
          });
          steps.push({ wait: 1000 });
        }
        break;
      }

      case 'input': {
        const inputVal = action.metadata?.inputValue as string || '';
        let value = inputVal;
        for (const [literal, paramName] of Object.entries(meta.templateVariables)) {
          if (inputVal.includes(literal)) {
            value = `{{${paramName}}}`;
          }
        }

        if (filterIntent && quickFilterSupported && quickFilterState.active) {
          if (!value.trim()) {
            break;
          }

          if (hasField(pageDef, `filter_${quickFilterState.nextFilterIndex}`)) {
            if (!quickFilterState.selectedValues.includes(value)) {
              steps.push({
                interact: {
                  field: `${currentPageId || pageId || 'page'}.fields.filter_${quickFilterState.nextFilterIndex}`,
                  action: 'select',
                  value,
                },
              });
              steps.push({ wait: 500 });
              quickFilterState.selectedValues.push(value);
              quickFilterState.nextFilterIndex += 1;
            }
            break;
          }
        }

        const resolved = getResolvedField();
        if (resolved) {
          const actionType = resolved.field.interactionType === 'select'
            ? 'select'
            : resolved.field.interactionType === 'check'
              ? 'check'
              : 'fill';

          steps.push({
            interact: { field: resolved.fieldRef, action: actionType, value },
          });
          steps.push({ wait: 500 });
        }
        break;
      }

      case 'keypress': {
        // Add as a comment-like wait step (keypress not directly supported in schema)
        steps.push({ wait: 500 });
        break;
      }

      case 'navigate': {
        // Already handled above via URL change detection
        // But ensure we don't silently skip — if no navigate was emitted, add one
        if (action.metadata?.toUrl) {
          const toUrl = action.metadata.toUrl as string;
          const navPageId = urlToPageId(toUrl);
          if (navPageId !== currentPageId) {
            const navStep: Record<string, unknown> = { navigate: { page: navPageId } };
            const params: Record<string, string> = {};
            for (const [literal, paramName] of Object.entries(meta.templateVariables)) {
              if (toUrl.includes(literal)) {
                params[paramName] = `{{${paramName}}}`;
              }
            }
            if (Object.keys(params).length > 0) {
              (navStep.navigate as Record<string, unknown>).params = params;
            }
            steps.push(navStep);
            steps.push({ wait: 2000 });
            currentPageId = navPageId;
            lastUrl = toUrl;
          }
        }
        break;
      }

      default:
        // tab_switch or unknown — still emit a wait so nothing is silently dropped
        steps.push({ wait: 500 });
        break;
    }
  }

  const optimizedSteps = optimizeToolSteps(steps, meta);

  // Add returns from template variables
  for (const paramName of Object.values(meta.templateVariables)) {
    returns[paramName] = `{{${paramName}}}`;
  }

  return {
    tool: {
      name: meta.name,
      description: meta.description,
      inputSchema: meta.inputSchema,
      bridge: {
        page: currentPageId || 'unknown_page',
        steps: optimizedSteps,
        returns,
      },
    },
  };
}

function hasNavigateParams(step: Record<string, unknown>): boolean {
  const navigate = step.navigate as { params?: Record<string, string> } | undefined;
  return !!navigate?.params && Object.keys(navigate.params).length > 0;
}

function isInteractStep(step: Record<string, unknown>): step is { interact: { field?: string; action?: string; value?: string } } {
  return 'interact' in step;
}

function interactionKey(step: { interact: { field?: string; action?: string; value?: string } }): string {
  return JSON.stringify([
    step.interact.field ?? '',
    step.interact.action ?? '',
    step.interact.value ?? '',
  ]);
}

function trimLeadingNavigationNoise(steps: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  let startIdx = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    if (!('navigate' in step) || !hasNavigateParams(step)) {
      continue;
    }

    const suffix = steps.slice(i + 1);
    const hasLaterInteract = suffix.some(candidate => isInteractStep(candidate));
    if (!hasLaterInteract) {
      continue;
    }

    const prefix = steps.slice(0, i);
    const prefixIsOnlyNavigationNoise = prefix.every(candidate => {
      if ('wait' in candidate || 'navigate' in candidate) return true;
      if (isInteractStep(candidate)) {
        return (candidate.interact.action ?? 'click') === 'click';
      }
      return false;
    });

    if (prefixIsOnlyNavigationNoise) {
      startIdx = i;
    }
  }

  return steps.slice(startIdx);
}

function compactSteps(steps: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const compacted: Array<Record<string, unknown>> = [];

  for (const step of steps) {
    const previous = compacted[compacted.length - 1];

    if ('wait' in step) {
      if (!previous) {
        continue;
      }
      if ('wait' in previous && typeof previous.wait === 'number' && typeof step.wait === 'number') {
        previous.wait = Math.max(previous.wait, step.wait);
        continue;
      }
      compacted.push(step);
      continue;
    }

    if (isInteractStep(step)) {
      let previousSignificantIndex = compacted.length - 1;
      while (previousSignificantIndex >= 0 && 'wait' in compacted[previousSignificantIndex]!) {
        previousSignificantIndex--;
      }

      const previousSignificant = previousSignificantIndex >= 0 ? compacted[previousSignificantIndex]! : null;
      if (previousSignificant && isInteractStep(previousSignificant) && interactionKey(previousSignificant) === interactionKey(step)) {
        continue;
      }
    }

    compacted.push(step);
  }

  while (compacted.length > 0 && 'wait' in compacted[compacted.length - 1]!) {
    compacted.pop();
  }

  return compacted;
}

function dropPreparatoryClicksBeforeValueChange(steps: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const optimized: Array<Record<string, unknown>> = [];

  for (const step of steps) {
    if (isInteractStep(step) && ['select', 'fill', 'check'].includes(step.interact.action ?? '')) {
      let previousSignificantIndex = optimized.length - 1;
      while (previousSignificantIndex >= 0 && 'wait' in optimized[previousSignificantIndex]!) {
        previousSignificantIndex--;
      }

      const previousSignificant = previousSignificantIndex >= 0 ? optimized[previousSignificantIndex]! : null;
      if (
        previousSignificant &&
        isInteractStep(previousSignificant) &&
        previousSignificant.interact.action === 'click' &&
        previousSignificant.interact.field === step.interact.field
      ) {
        optimized.splice(previousSignificantIndex);
      }
    }

    optimized.push(step);
  }

  return optimized;
}

function dropQuickFilterNoise(
  steps: Array<Record<string, unknown>>,
  meta: ToolMetadata,
): Array<Record<string, unknown>> {
  if (!isFilterIntent(meta)) {
    return steps;
  }

  const hasQuickFilterTrigger = steps.some(step =>
    isInteractStep(step) && getFieldIdFromRef(step.interact.field) === 'show_quick_filters',
  );

  if (!hasQuickFilterTrigger) {
    return steps;
  }

  return steps.filter(step => {
    if (!isInteractStep(step)) {
      return true;
    }

    const fieldId = getFieldIdFromRef(step.interact.field);
    if (!fieldId) {
      return true;
    }

    if (fieldId === 'show_quick_filters' || fieldId === 'filter_1' || fieldId === 'filter_2') {
      return true;
    }

    if (isQuickFilterNoiseFieldId(fieldId)) {
      return false;
    }

    return true;
  });
}

function optimizeToolSteps(steps: Array<Record<string, unknown>>, meta: ToolMetadata): Array<Record<string, unknown>> {
  return compactSteps(
    dropPreparatoryClicksBeforeValueChange(
      dropQuickFilterNoise(
        trimLeadingNavigationNoise(steps),
        meta,
      ),
    ),
  );
}

// ─── Helpers ────────────────────────────────────────────

function findSnapshotForUrl(
  url: string,
  snapshots: Record<string, CaptureSnapshot>,
  actionTimestamp?: number,
): CaptureSnapshot | null {
  const entries = Object.values(snapshots);
  if (entries.length === 0) {
    return null;
  }

  // Try matching by exact URL first, then by pathname.
  let candidates = entries.filter(snapshot => snapshot.url === url);

  try {
    if (candidates.length === 0) {
      const targetPath = new URL(url).pathname;
      candidates = entries.filter(snapshot => {
        try {
          return new URL(snapshot.url).pathname === targetPath;
        } catch {
          return false;
        }
      });
    }
  } catch {
    // Invalid URL
  }

  if (candidates.length === 0) {
    candidates = entries;
  }

  if (typeof actionTimestamp === 'number') {
    return candidates
      .slice()
      .sort((a, b) => {
        const aDistance = Math.abs(a.timestamp - actionTimestamp);
        const bDistance = Math.abs(b.timestamp - actionTimestamp);
        if (aDistance !== bDistance) {
          return aDistance - bDistance;
        }

        const aIsAfter = a.timestamp >= actionTimestamp ? 0 : 1;
        const bIsAfter = b.timestamp >= actionTimestamp ? 0 : 1;
        if (aIsAfter !== bIsAfter) {
          return aIsAfter - bIsAfter;
        }

        return a.timestamp - b.timestamp;
      })[0] || null;
  }

  return candidates.sort((a, b) => a.timestamp - b.timestamp).at(-1) || null;
}

// ─── YAML Serializer ────────────────────────────────────

function yamlScalar(val: unknown): string {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return String(val);
  const s = String(val);
  if (s === '') return '""';
  // Quote if: contains special chars, template syntax, or looks like a number/bool
  if (s.includes('{{') || s.includes('"') || s.includes("'") || s.includes('\n') ||
      s.includes(': ') || s.includes('#') || s.startsWith('*') || s.startsWith('&') ||
      s.startsWith('!') || s.startsWith('{') || s.startsWith('[') ||
      /^[0-9]/.test(s) || s === 'true' || s === 'false' || s === 'null' ||
      s === 'yes' || s === 'no' || s === 'on' || s === 'off') {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  if (/^[a-zA-Z_][a-zA-Z0-9_./ *-]*$/.test(s)) return s;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function yamlLines(obj: unknown, indent: number): string[] {
  const pad = '  '.repeat(indent);

  if (obj === null || obj === undefined || typeof obj === 'string' ||
      typeof obj === 'number' || typeof obj === 'boolean') {
    return [yamlScalar(obj)];
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return ['[]'];
    const result: string[] = [];
    for (const item of obj) {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        // Object in array: first key on same line as -, rest indented under it
        const entries = Object.entries(item as Record<string, unknown>);
        for (let i = 0; i < entries.length; i++) {
          const [key, val] = entries[i]!;
          const prefix = i === 0 ? `${pad}- ` : `${pad}  `;
          if (val === null || val === undefined || typeof val === 'string' ||
              typeof val === 'number' || typeof val === 'boolean') {
            result.push(`${prefix}${key}: ${yamlScalar(val)}`);
          } else {
            result.push(`${prefix}${key}:`);
            for (const line of yamlLines(val, indent + 2)) {
              result.push(line);
            }
          }
        }
      } else {
        result.push(`${pad}- ${yamlScalar(item)}`);
      }
    }
    return result;
  }

  if (typeof obj === 'object') {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return ['{}'];
    const result: string[] = [];
    for (const [key, val] of entries) {
      if (val === null || val === undefined || typeof val === 'string' ||
          typeof val === 'number' || typeof val === 'boolean') {
        result.push(`${pad}${key}: ${yamlScalar(val)}`);
      } else {
        result.push(`${pad}${key}:`);
        for (const line of yamlLines(val, indent + 1)) {
          result.push(line);
        }
      }
    }
    return result;
  }

  return [yamlScalar(obj)];
}

export function toYamlString(obj: unknown): string {
  return yamlLines(obj, 0).join('\n');
}
