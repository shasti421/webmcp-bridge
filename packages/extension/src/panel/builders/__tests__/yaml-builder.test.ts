import { describe, expect, it } from 'vitest';

import type { CaptureSnapshot } from '../../reducer.js';
import type { RecordedAction } from '../../../content-script/recorder.js';
import {
  buildAppDefinition,
  buildPageDefinition,
  buildToolDefinition,
  deriveTemplateVariables,
} from '../yaml-builder.js';

function createClickAction(
  url: string,
  overrides: Partial<RecordedAction['element']> = {},
): RecordedAction {
  return {
    id: `act_${Math.random().toString(36).slice(2)}`,
    type: 'click',
    timestamp: Date.now(),
    url,
    element: {
      tag: 'button',
      classes: [],
      selectors: {},
      ...overrides,
    },
  };
}

function createInputAction(
  url: string,
  value: string,
  overrides: Partial<RecordedAction['element']> = {},
  metadata: Partial<NonNullable<RecordedAction['metadata']>> = {},
): RecordedAction {
  return {
    id: `act_${Math.random().toString(36).slice(2)}`,
    type: 'input',
    timestamp: Date.now(),
    url,
    metadata: { inputValue: value, ...metadata },
    element: {
      tag: 'input',
      classes: [],
      selectors: {},
      ...overrides,
    },
  };
}

describe('yaml-builder', () => {
  it('builds an app definition from recorded pages', () => {
    const appDef = buildAppDefinition('revance_oce_fulldev', [
      'https://revance.example/lightning/r/Account/001ABCDEF123456/view',
      'https://revance.example/lightning/r/Account/001ABCDEF123456/related/Cases/view',
    ]);

    expect(appDef).toEqual({
      app: {
        id: 'revance_oce_fulldev',
        name: 'Revance Oce Fulldev',
        base_url: 'https://revance.example',
        url_patterns: [
          '/lightning/r/Account/*/view',
          '/lightning/r/Account/*/related/Cases/view',
        ],
      },
    });
  });

  it('derives template variables from record page URLs deterministically', () => {
    expect(deriveTemplateVariables([
      'https://revance.example/lightning/r/Account/001ABCDEF123456/view',
      'https://revance.example/lightning/r/Case/500ABCDEF123456/view',
    ])).toEqual({
      '001ABCDEF123456': 'account_id',
      '500ABCDEF123456': 'case_id',
    });
  });

  it('deduplicates repeated field labels when building a page definition', () => {
    const snapshot: CaptureSnapshot = {
      url: 'https://revance.example/lightning/r/Account/001ABCDEF123456/view',
      title: 'Account',
      timestamp: Date.now(),
      elements: [
        {
          id: 'details-tab-1',
          tag: 'button',
          text: 'Details',
          ariaLabel: 'Details',
          xPath: '//*[@id="details-tab-1"]',
          cssSelector: '#details-tab-1',
          label: 'Details',
        },
        {
          id: 'details-tab-2',
          tag: 'button',
          text: 'Details',
          ariaLabel: 'Details',
          xPath: '//*[@id="details-tab-2"]',
          cssSelector: '#details-tab-2',
          label: 'Details',
        },
      ],
    };

    const pageDef = buildPageDefinition(snapshot, 'revance_oce_fulldev', {});

    expect(pageDef.page.fields.map(field => field.id)).toEqual(['details', 'details_2']);
  });

  it('maps partial action labels back to real page field ids', () => {
    const url = 'https://revance.example/lightning/r/Account/001ABCDEF123456/related/Cases/view';
    const snapshot: CaptureSnapshot = {
      url,
      title: 'Related Cases',
      timestamp: Date.now(),
      elements: [
        {
          id: 'more-actions',
          tag: 'button',
          ariaLabel: 'Show more actions',
          text: 'Show more actions',
          xPath: '//*[@id="more-actions"]',
          cssSelector: '#more-actions',
          label: 'Show more actions',
        },
        {
          id: 'quick-filters',
          tag: 'button',
          ariaLabel: 'Show quick filters',
          text: 'Show quick filters',
          xPath: '//*[@id="quick-filters"]',
          cssSelector: '#quick-filters',
          label: 'Show quick filters',
        },
      ],
    };

    const pageDef = buildPageDefinition(snapshot, 'revance_oce_fulldev', {
      '001ABCDEF123456': 'account_id',
    });

    const toolDef = buildToolDefinition([
      createClickAction(url, {
        ariaLabel: 'Show more actions',
        selectors: { css: '#more-actions', aria: { role: 'button', name: 'Show more actions' } },
      }),
      createClickAction(url, {
        nearbyLabel: 'Filters',
        text: 'Filters',
        selectors: { css: 'button.filters-toggle' },
      }),
    ], {
      [url]: snapshot,
    }, {
      name: 'salesforce_account_cases_navigator',
      description: 'Navigate account cases',
      inputSchema: {
        type: 'object',
        properties: {
          account_id: { type: 'string', description: 'Account ID' },
        },
        required: ['account_id'],
      },
      templateVariables: {
        '001ABCDEF123456': 'account_id',
      },
    }, [pageDef]);

    const interactFields = toolDef.tool.bridge.steps
      .filter(step => 'interact' in step)
      .map(step => (step.interact as { field: string }).field);

    expect(interactFields).toEqual([
      'account_related_cases_view.fields.show_more_actions',
      'account_related_cases_view.fields.show_quick_filters',
    ]);
  });

  it('skips unresolved actions instead of inventing placeholder field ids', () => {
    const url = 'https://revance.example/lightning/r/Account/001ABCDEF123456/view';
    const snapshot: CaptureSnapshot = {
      url,
      title: 'Account',
      timestamp: Date.now(),
      elements: [
        {
          id: 'details-tab',
          tag: 'button',
          ariaLabel: 'Details',
          text: 'Details',
          xPath: '//*[@id="details-tab"]',
          cssSelector: '#details-tab',
          label: 'Details',
        },
      ],
    };

    const pageDef = buildPageDefinition(snapshot, 'revance_oce_fulldev', {
      '001ABCDEF123456': 'account_id',
    });

    const toolDef = buildToolDefinition([
      createClickAction(url, {
        text: 'Something ambiguous',
        selectors: { css: 'button.unknown' },
      }),
    ], {
      [url]: snapshot,
    }, {
      name: 'ambiguous_click',
      description: 'Skip ambiguous click',
      inputSchema: { type: 'object', properties: {}, required: [] },
      templateVariables: {
        '001ABCDEF123456': 'account_id',
      },
    }, [pageDef]);

    const interactSteps = toolDef.tool.bridge.steps.filter(step => 'interact' in step);

    expect(interactSteps).toHaveLength(0);
    expect(JSON.stringify(toolDef)).not.toContain('.fields.el_');
  });

  it('uses select actions for captured picklist input and trims earlier navigation noise', () => {
    const accountUrl = 'https://revance.example/lightning/r/Account/001ABCDEF123456/view';
    const relatedCasesUrl = 'https://revance.example/lightning/r/Account/001ABCDEF123456/related/Cases/view';

    const accountSnapshot: CaptureSnapshot = {
      url: accountUrl,
      title: 'Account',
      timestamp: Date.now(),
      elements: [
        {
          id: 'details-tab',
          tag: 'button',
          ariaLabel: 'Details',
          text: 'Details',
          xPath: '//*[@id="details-tab"]',
          cssSelector: '#details-tab',
          label: 'Details',
        },
      ],
    };

    const relatedSnapshot: CaptureSnapshot = {
      url: relatedCasesUrl,
      title: 'Related Cases',
      timestamp: Date.now(),
      elements: [
        {
          id: 'quick-filters',
          tag: 'button',
          ariaLabel: 'Show quick filters',
          text: 'Show quick filters',
          xPath: '//*[@id="quick-filters"]',
          cssSelector: '#quick-filters',
          label: 'Show quick filters',
        },
        {
          id: 'filter-one',
          tag: 'select',
          ariaLabel: 'Filter 1',
          text: 'Status',
          xPath: '//*[@id="filter-one"]',
          cssSelector: '#filter-one',
          label: 'Filter 1',
          value: '',
        },
        {
          id: 'filter-two',
          tag: 'select',
          ariaLabel: 'Filter 2',
          text: 'New',
          xPath: '//*[@id="filter-two"]',
          cssSelector: '#filter-two',
          label: 'Filter 2',
          value: '',
        },
      ],
    };

    const accountPageDef = buildPageDefinition(accountSnapshot, 'revance_oce_fulldev', {
      '001ABCDEF123456': 'account_id',
    });
    const relatedPageDef = buildPageDefinition(relatedSnapshot, 'revance_oce_fulldev', {
      '001ABCDEF123456': 'account_id',
    });

    const toolDef = buildToolDefinition([
      createClickAction(accountUrl, {
        ariaLabel: 'Details',
        selectors: { css: '#details-tab', aria: { role: 'button', name: 'Details' } },
      }),
      createClickAction(relatedCasesUrl, {
        ariaLabel: 'Show quick filters',
        selectors: { css: '#quick-filters', aria: { role: 'button', name: 'Show quick filters' } },
      }),
      createInputAction(relatedCasesUrl, 'Status', {
        tag: 'select',
        ariaLabel: 'Filter 1',
        selectors: { css: '#filter-one', aria: { role: 'combobox', name: 'Filter 1' } },
      }, { inputKind: 'select' }),
      createInputAction(relatedCasesUrl, 'New', {
        tag: 'select',
        ariaLabel: 'Filter 2',
        selectors: { css: '#filter-two', aria: { role: 'combobox', name: 'Filter 2' } },
      }, { inputKind: 'select' }),
    ], {
      [accountUrl]: accountSnapshot,
      [relatedCasesUrl]: relatedSnapshot,
    }, {
      name: 'salesforce_filter_cases',
      description: 'Filter cases by status',
      inputSchema: {
        type: 'object',
        properties: {
          account_id: { type: 'string', description: 'Account ID' },
        },
        required: ['account_id'],
      },
      templateVariables: {
        '001ABCDEF123456': 'account_id',
      },
    }, [accountPageDef, relatedPageDef]);

    expect(toolDef.tool.bridge.steps).toEqual([
      {
        navigate: {
          page: 'account_related_cases_view',
          params: { account_id: '{{account_id}}' },
        },
      },
      { wait: 2000 },
      {
        interact: {
          field: 'account_related_cases_view.fields.show_quick_filters',
          action: 'click',
        },
      },
      { wait: 1000 },
      {
        interact: {
          field: 'account_related_cases_view.fields.filter_1',
          action: 'select',
          value: 'Status',
        },
      },
      { wait: 500 },
      {
        interact: {
          field: 'account_related_cases_view.fields.filter_2',
          action: 'select',
          value: 'New',
        },
      },
    ]);
  });

  it('drops redundant click steps before selecting a value on the same field', () => {
    const relatedCasesUrl = 'https://revance.example/lightning/r/Account/001ABCDEF123456/related/Cases/view';

    const relatedSnapshot: CaptureSnapshot = {
      url: relatedCasesUrl,
      title: 'Related Cases',
      timestamp: Date.now(),
      elements: [
        {
          id: 'filter-one',
          tag: 'select',
          ariaLabel: 'Filter 1',
          text: 'Status',
          xPath: '//*[@id="filter-one"]',
          cssSelector: '#filter-one',
          label: 'Filter 1',
          value: '',
        },
      ],
    };

    const relatedPageDef = buildPageDefinition(relatedSnapshot, 'revance_oce_fulldev', {
      '001ABCDEF123456': 'account_id',
    });

    const toolDef = buildToolDefinition([
      createClickAction(relatedCasesUrl, {
        tag: 'select',
        ariaLabel: 'Filter 1',
        selectors: { css: '#filter-one', aria: { role: 'combobox', name: 'Filter 1' } },
      }),
      createInputAction(relatedCasesUrl, 'Status', {
        tag: 'select',
        ariaLabel: 'Filter 1',
        selectors: { css: '#filter-one', aria: { role: 'combobox', name: 'Filter 1' } },
      }, { inputKind: 'select' }),
    ], {
      [relatedCasesUrl]: relatedSnapshot,
    }, {
      name: 'salesforce_filter_cases',
      description: 'Filter cases by status',
      inputSchema: {
        type: 'object',
        properties: {
          account_id: { type: 'string', description: 'Account ID' },
        },
        required: ['account_id'],
      },
      templateVariables: {
        '001ABCDEF123456': 'account_id',
      },
    }, [relatedPageDef]);

    expect(toolDef.tool.bridge.steps).toEqual([
      {
        navigate: {
          page: 'account_related_cases_view',
          params: { account_id: '{{account_id}}' },
        },
      },
      { wait: 2000 },
      {
        interact: {
          field: 'account_related_cases_view.fields.filter_1',
          action: 'select',
          value: 'Status',
        },
      },
    ]);
  });

  it('prefers quick-filter semantics over nearby list controls in filter flows', () => {
    const relatedCasesUrl = 'https://revance.example/lightning/r/Account/001ABCDEF123456/related/Cases/view';

    const relatedSnapshot: CaptureSnapshot = {
      url: relatedCasesUrl,
      title: 'Related Cases',
      timestamp: Date.now(),
      elements: [
        {
          id: 'merge-cases',
          tag: 'button',
          ariaLabel: 'Merge Cases',
          text: 'Merge Cases',
          xPath: '//*[@id="merge-cases"]',
          cssSelector: '#merge-cases',
          label: 'Merge Cases',
        },
        {
          id: 'sort-by-case',
          tag: 'a',
          ariaLabel: 'Sort by:Case',
          text: 'Sort by:Case',
          xPath: '//*[@id="sort-by-case"]',
          cssSelector: '#sort-by-case',
          label: 'Sort by:Case',
        },
        {
          id: 'quick-filters',
          tag: 'button',
          ariaLabel: 'Show quick filters',
          text: 'Show quick filters',
          xPath: '//*[@id="quick-filters"]',
          cssSelector: '#quick-filters',
          label: 'Show quick filters',
        },
        {
          id: 'status-actions',
          tag: 'button',
          ariaLabel: 'Show Status column actions',
          text: 'Show Status column actions',
          xPath: '//*[@id="status-actions"]',
          cssSelector: '#status-actions',
          label: 'Show Status column actions',
        },
        {
          id: 'status-width',
          tag: 'input',
          ariaLabel: 'Status column width',
          text: '',
          xPath: '//*[@id="status-width"]',
          cssSelector: '#status-width',
          label: 'Status column width',
          value: '',
        },
        {
          id: 'new-status',
          tag: 'button',
          ariaLabel: 'New',
          text: 'New',
          xPath: '//*[@id="new-status"]',
          cssSelector: '#new-status',
          label: 'New',
        },
        {
          id: 'filter-one',
          tag: 'select',
          ariaLabel: 'Filter 1',
          text: '',
          xPath: '//*[@id="filter-one"]',
          cssSelector: '#filter-one',
          label: 'Filter 1',
          value: '',
        },
        {
          id: 'filter-two',
          tag: 'select',
          ariaLabel: 'Filter 2',
          text: '',
          xPath: '//*[@id="filter-two"]',
          cssSelector: '#filter-two',
          label: 'Filter 2',
          value: '',
        },
      ],
    };

    const relatedPageDef = buildPageDefinition(relatedSnapshot, 'revance_oce_fulldev', {
      '001ABCDEF123456': 'account_id',
    });

    const toolDef = buildToolDefinition([
      createClickAction(relatedCasesUrl, {
        tag: 'button',
        ariaLabel: 'Merge Cases',
        selectors: { css: '#merge-cases', aria: { role: 'button', name: 'Merge Cases' } },
      }),
      createClickAction(relatedCasesUrl, {
        tag: 'a',
        ariaLabel: 'Sort by:Case',
        text: 'Sort by:Case',
        selectors: { css: '#sort-by-case', aria: { role: 'link', name: 'Sort by:Case' } },
      }),
      createClickAction(relatedCasesUrl, {
        tag: 'button',
        ariaLabel: 'Show quick filters',
        selectors: { css: '#quick-filters', aria: { role: 'button', name: 'Show quick filters' } },
      }),
      createClickAction(relatedCasesUrl, {
        tag: 'button',
        ariaLabel: 'Show Status column actions',
        selectors: { css: '#status-actions', aria: { role: 'button', name: 'Show Status column actions' } },
      }),
      createInputAction(relatedCasesUrl, '', {
        tag: 'input',
        ariaLabel: 'Status column width',
        selectors: { css: '#status-width', aria: { role: 'textbox', name: 'Status column width' } },
      }, { inputKind: 'text' }),
      createClickAction(relatedCasesUrl, {
        tag: 'button',
        ariaLabel: 'New',
        text: 'New',
        selectors: { css: '#new-status', aria: { role: 'button', name: 'New' } },
      }),
    ], {
      [relatedCasesUrl]: relatedSnapshot,
    }, {
      name: 'salesforce_filter_account_cases',
      description: 'Filter related cases by status',
      inputSchema: {
        type: 'object',
        properties: {
          account_id: { type: 'string', description: 'Account ID' },
        },
        required: ['account_id'],
      },
      templateVariables: {
        '001ABCDEF123456': 'account_id',
      },
    }, [relatedPageDef]);

    expect(toolDef.tool.bridge.steps).toEqual([
      {
        navigate: {
          page: 'account_related_cases_view',
          params: { account_id: '{{account_id}}' },
        },
      },
      { wait: 2000 },
      {
        interact: {
          field: 'account_related_cases_view.fields.show_quick_filters',
          action: 'click',
        },
      },
      { wait: 1000 },
      {
        interact: {
          field: 'account_related_cases_view.fields.filter_1',
          action: 'select',
          value: 'Status',
        },
      },
      { wait: 500 },
      {
        interact: {
          field: 'account_related_cases_view.fields.filter_2',
          action: 'select',
          value: 'New',
        },
      },
    ]);
  });

  it('uses the closest timestamped snapshot when multiple captures exist for the same URL', () => {
    const relatedCasesUrl = 'https://revance.example/lightning/r/Account/001ABCDEF123456/related/Cases/view';

    const baseSnapshot: CaptureSnapshot = {
      url: relatedCasesUrl,
      title: 'Related Cases',
      timestamp: 1000,
      elements: [
        {
          id: 'quick-filters',
          tag: 'button',
          ariaLabel: 'Show quick filters',
          text: 'Show quick filters',
          xPath: '//*[@id="quick-filters"]',
          cssSelector: '#quick-filters',
          label: 'Show quick filters',
        },
      ],
    };

    const overlaySnapshot: CaptureSnapshot = {
      url: relatedCasesUrl,
      title: 'Related Cases',
      timestamp: 2000,
      elements: [
        ...baseSnapshot.elements,
        {
          id: 'status-actions',
          tag: 'button',
          ariaLabel: 'Show Status column actions',
          text: 'Show Status column actions',
          xPath: '//*[@id="status-actions"]',
          cssSelector: '#status-actions',
          label: 'Show Status column actions',
        },
        {
          id: 'new-status',
          tag: 'button',
          ariaLabel: 'New',
          text: 'New',
          xPath: '//*[@id="new-status"]',
          cssSelector: '#new-status',
          label: 'New',
        },
        {
          id: 'filter-one',
          tag: 'select',
          ariaLabel: 'Filter 1',
          text: '',
          xPath: '//*[@id="filter-one"]',
          cssSelector: '#filter-one',
          label: 'Filter 1',
          value: '',
        },
        {
          id: 'filter-two',
          tag: 'select',
          ariaLabel: 'Filter 2',
          text: '',
          xPath: '//*[@id="filter-two"]',
          cssSelector: '#filter-two',
          label: 'Filter 2',
          value: '',
        },
      ],
    };

    const relatedPageDef = buildPageDefinition(overlaySnapshot, 'revance_oce_fulldev', {
      '001ABCDEF123456': 'account_id',
    });

    const toolDef = buildToolDefinition([
      {
        ...createClickAction(relatedCasesUrl, {
          tag: 'button',
          ariaLabel: 'Show quick filters',
          selectors: { css: '#quick-filters', aria: { role: 'button', name: 'Show quick filters' } },
        }),
        timestamp: 1100,
      },
      {
        ...createClickAction(relatedCasesUrl, {
          tag: 'button',
          ariaLabel: 'Show Status column actions',
          selectors: { css: '#status-actions', aria: { role: 'button', name: 'Show Status column actions' } },
        }),
        timestamp: 1500,
      },
      {
        ...createClickAction(relatedCasesUrl, {
          tag: 'button',
          ariaLabel: 'New',
          text: 'New',
          selectors: { css: '#new-status', aria: { role: 'button', name: 'New' } },
        }),
        timestamp: 2100,
      },
    ], {
      [`${relatedCasesUrl}#base`]: baseSnapshot,
      [`${relatedCasesUrl}#overlay`]: overlaySnapshot,
    }, {
      name: 'salesforce_account_case_filter',
      description: 'Filter related cases by status',
      inputSchema: {
        type: 'object',
        properties: {
          account_id: { type: 'string', description: 'Account ID' },
        },
        required: ['account_id'],
      },
      templateVariables: {
        '001ABCDEF123456': 'account_id',
      },
    }, [relatedPageDef]);

    expect(toolDef.tool.bridge.steps).toEqual([
      {
        navigate: {
          page: 'account_related_cases_view',
          params: { account_id: '{{account_id}}' },
        },
      },
      { wait: 2000 },
      {
        interact: {
          field: 'account_related_cases_view.fields.show_quick_filters',
          action: 'click',
        },
      },
      { wait: 1000 },
      {
        interact: {
          field: 'account_related_cases_view.fields.filter_1',
          action: 'select',
          value: 'Status',
        },
      },
      { wait: 500 },
      {
        interact: {
          field: 'account_related_cases_view.fields.filter_2',
          action: 'select',
          value: 'New',
        },
      },
    ]);
  });
});
