/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import { CaptureMode } from '../components/CaptureMode.js';
import { ExecuteMode } from '../components/ExecuteMode.js';
import { type SidePanelState, type SidePanelAction, initialState, type ToolSchema } from '../reducer.js';

// ─── Helpers ───────────────────────────────────────────

const sampleTool: ToolSchema = {
  name: 'create_todo',
  description: 'Create a todo item',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Todo title' },
    },
    required: ['title'],
  },
};

// ─── CaptureMode tests ─────────────────────────────────

describe('CaptureMode', () => {
  let dispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dispatch = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders capture button', () => {
    render(<CaptureMode state={initialState} dispatch={dispatch} />);
    expect(screen.getByText('Capture Page')).toBeTruthy();
  });

  it('shows current page URL', () => {
    const state: SidePanelState = {
      ...initialState,
      currentPageUrl: 'https://example.com/todos',
      currentPageTitle: 'Todo App',
    };
    render(<CaptureMode state={state} dispatch={dispatch} />);
    expect(screen.getByText(/example\.com/)).toBeTruthy();
  });

  it('shows capturing state when capturing', () => {
    const state: SidePanelState = { ...initialState, capturing: true };
    render(<CaptureMode state={state} dispatch={dispatch} />);
    expect(screen.getByText('Capturing...')).toBeTruthy();
  });

  it('renders suggested tools when available', () => {
    const state: SidePanelState = {
      ...initialState,
      suggestedTools: [sampleTool],
    };
    render(<CaptureMode state={state} dispatch={dispatch} />);
    expect(screen.getByText('create_todo')).toBeTruthy();
    expect(screen.getByText('Create a todo item')).toBeTruthy();
  });

  it('dispatches SELECT_TOOL when tool card clicked', () => {
    const state: SidePanelState = {
      ...initialState,
      suggestedTools: [sampleTool],
    };
    render(<CaptureMode state={state} dispatch={dispatch} />);
    fireEvent.click(screen.getByText('Use This Tool'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'SELECT_TOOL', payload: sampleTool });
  });
});

// ─── ExecuteMode tests ──────────────────────────────────

describe('ExecuteMode', () => {
  let dispatch: (action: SidePanelAction) => void;

  beforeEach(() => {
    dispatch = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders tool selector', () => {
    const state: SidePanelState = {
      ...initialState,
      tools: [sampleTool],
    };
    render(<ExecuteMode state={state} dispatch={dispatch} />);
    expect(screen.getByText('Select a tool...')).toBeTruthy();
  });

  it('shows tool options in selector', () => {
    const state: SidePanelState = {
      ...initialState,
      tools: [sampleTool],
    };
    render(<ExecuteMode state={state} dispatch={dispatch} />);
    expect(screen.getByText('create_todo')).toBeTruthy();
  });

  it('shows input fields when tool is selected', () => {
    const state: SidePanelState = {
      ...initialState,
      tools: [sampleTool],
      selectedTool: sampleTool,
    };
    render(<ExecuteMode state={state} dispatch={dispatch} />);
    expect(screen.getByLabelText('title')).toBeTruthy();
  });

  it('shows execute button when tool is selected', () => {
    const state: SidePanelState = {
      ...initialState,
      tools: [sampleTool],
      selectedTool: sampleTool,
    };
    render(<ExecuteMode state={state} dispatch={dispatch} />);
    expect(screen.getByText('Execute')).toBeTruthy();
  });

  it('shows loading state on execute button', () => {
    const state: SidePanelState = {
      ...initialState,
      tools: [sampleTool],
      selectedTool: sampleTool,
      loading: true,
    };
    render(<ExecuteMode state={state} dispatch={dispatch} />);
    expect(screen.getByText('Executing...')).toBeTruthy();
  });

  it('dispatches SET_INPUT when input changes', () => {
    const state: SidePanelState = {
      ...initialState,
      tools: [sampleTool],
      selectedTool: sampleTool,
    };
    render(<ExecuteMode state={state} dispatch={dispatch} />);
    const input = screen.getByLabelText('title');
    fireEvent.change(input, { target: { value: 'Buy milk' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_INPUT',
      payload: { field: 'title', value: 'Buy milk' },
    });
  });

  it('shows execution result', () => {
    const state: SidePanelState = {
      ...initialState,
      tools: [sampleTool],
      selectedTool: sampleTool,
      executionResult: { success: true, outputs: { id: '456' } },
    };
    render(<ExecuteMode state={state} dispatch={dispatch} />);
    expect(screen.getByText(/Result/)).toBeTruthy();
    expect(screen.getByText(/456/)).toBeTruthy();
  });

  it('shows error banner', () => {
    const state: SidePanelState = {
      ...initialState,
      error: 'Something went wrong',
    };
    render(<ExecuteMode state={state} dispatch={dispatch} />);
    expect(screen.getByText('Something went wrong')).toBeTruthy();
  });
});
