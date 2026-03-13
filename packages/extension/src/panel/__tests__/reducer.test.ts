import { describe, it, expect } from 'vitest';

import { sidePanelReducer, initialState, type SidePanelState, type ToolSchema } from '../reducer.js';

const sampleTool: ToolSchema = {
  name: 'create_todo',
  description: 'Create a todo item',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Todo title' },
      priority: { type: 'string', description: 'Priority', enum: ['low', 'medium', 'high'] },
    },
    required: ['title'],
  },
};

describe('sidePanelReducer', () => {
  it('returns initial state by default', () => {
    const state = sidePanelReducer(initialState, { type: 'CLEAR_ERROR' });
    expect(state.mode).toBe('execute');
  });

  describe('SWITCH_MODE', () => {
    it('switches to capture mode', () => {
      const state = sidePanelReducer(initialState, { type: 'SWITCH_MODE', mode: 'capture' });
      expect(state.mode).toBe('capture');
    });

    it('switches to execute mode', () => {
      const captureState: SidePanelState = { ...initialState, mode: 'capture' };
      const state = sidePanelReducer(captureState, { type: 'SWITCH_MODE', mode: 'execute' });
      expect(state.mode).toBe('execute');
    });

    it('clears error on mode switch', () => {
      const errorState: SidePanelState = { ...initialState, error: 'something went wrong' };
      const state = sidePanelReducer(errorState, { type: 'SWITCH_MODE', mode: 'capture' });
      expect(state.error).toBeNull();
    });
  });

  describe('SET_TOOLS', () => {
    it('sets tool definitions', () => {
      const state = sidePanelReducer(initialState, { type: 'SET_TOOLS', payload: [sampleTool] });
      expect(state.tools).toHaveLength(1);
      expect(state.tools[0]!.name).toBe('create_todo');
    });
  });

  describe('SET_SUGGESTED_TOOLS', () => {
    it('sets suggested tools', () => {
      const state = sidePanelReducer(initialState, { type: 'SET_SUGGESTED_TOOLS', payload: [sampleTool] });
      expect(state.suggestedTools).toHaveLength(1);
    });
  });

  describe('UPDATE_PAGE', () => {
    it('updates current page URL and title', () => {
      const state = sidePanelReducer(initialState, {
        type: 'UPDATE_PAGE',
        payload: { url: 'https://example.com/page', title: 'My Page' },
      });
      expect(state.currentPageUrl).toBe('https://example.com/page');
      expect(state.currentPageTitle).toBe('My Page');
    });
  });

  describe('SELECT_TOOL', () => {
    it('selects a tool', () => {
      const state = sidePanelReducer(initialState, { type: 'SELECT_TOOL', payload: sampleTool });
      expect(state.selectedTool).toEqual(sampleTool);
    });

    it('resets inputs when selecting a tool', () => {
      const withInputs: SidePanelState = { ...initialState, toolInputs: { title: 'old' } };
      const state = sidePanelReducer(withInputs, { type: 'SELECT_TOOL', payload: sampleTool });
      expect(state.toolInputs).toEqual({});
    });

    it('clears previous execution result', () => {
      const withResult: SidePanelState = {
        ...initialState,
        executionResult: { success: true, outputs: {} },
      };
      const state = sidePanelReducer(withResult, { type: 'SELECT_TOOL', payload: sampleTool });
      expect(state.executionResult).toBeNull();
    });
  });

  describe('CLEAR_TOOL', () => {
    it('clears selected tool', () => {
      const withTool: SidePanelState = { ...initialState, selectedTool: sampleTool };
      const state = sidePanelReducer(withTool, { type: 'CLEAR_TOOL' });
      expect(state.selectedTool).toBeNull();
    });
  });

  describe('SET_INPUT', () => {
    it('sets a tool input value', () => {
      const state = sidePanelReducer(initialState, {
        type: 'SET_INPUT',
        payload: { field: 'title', value: 'Buy milk' },
      });
      expect(state.toolInputs['title']).toBe('Buy milk');
    });

    it('preserves other input values', () => {
      const withInputs: SidePanelState = {
        ...initialState,
        toolInputs: { title: 'Test', priority: 'high' },
      };
      const state = sidePanelReducer(withInputs, {
        type: 'SET_INPUT',
        payload: { field: 'title', value: 'Updated' },
      });
      expect(state.toolInputs['title']).toBe('Updated');
      expect(state.toolInputs['priority']).toBe('high');
    });
  });

  describe('SET_RESULT', () => {
    it('sets execution result and clears loading', () => {
      const loadingState: SidePanelState = { ...initialState, loading: true };
      const result = { success: true, outputs: { id: '123' } };
      const state = sidePanelReducer(loadingState, { type: 'SET_RESULT', payload: result });
      expect(state.executionResult).toEqual(result);
      expect(state.loading).toBe(false);
    });
  });

  describe('SET_LOADING', () => {
    it('sets loading state', () => {
      const state = sidePanelReducer(initialState, { type: 'SET_LOADING', payload: true });
      expect(state.loading).toBe(true);
    });
  });

  describe('SET_CAPTURING', () => {
    it('sets capturing state', () => {
      const state = sidePanelReducer(initialState, { type: 'SET_CAPTURING', payload: true });
      expect(state.capturing).toBe(true);
    });
  });

  describe('SET_ERROR', () => {
    it('sets error and clears loading', () => {
      const loadingState: SidePanelState = { ...initialState, loading: true };
      const state = sidePanelReducer(loadingState, { type: 'SET_ERROR', payload: 'Network error' });
      expect(state.error).toBe('Network error');
      expect(state.loading).toBe(false);
    });
  });

  describe('CLEAR_ERROR', () => {
    it('clears error', () => {
      const errorState: SidePanelState = { ...initialState, error: 'Some error' };
      const state = sidePanelReducer(errorState, { type: 'CLEAR_ERROR' });
      expect(state.error).toBeNull();
    });
  });
});
