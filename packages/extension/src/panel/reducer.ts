/**
 * Side Panel state management via useReducer.
 */

// ─── Types ──────────────────────────────────────────────

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

export interface ExecutionResult {
  success: boolean;
  outputs: Record<string, unknown>;
  error?: string;
}

export interface SidePanelState {
  mode: 'capture' | 'execute';
  tools: ToolSchema[];
  suggestedTools: ToolSchema[];
  currentPageUrl: string;
  currentPageTitle: string;
  selectedTool: ToolSchema | null;
  toolInputs: Record<string, string>;
  executionResult: ExecutionResult | null;
  loading: boolean;
  capturing: boolean;
  error: string | null;
}

// ─── Actions ────────────────────────────────────────────

export type SidePanelAction =
  | { type: 'SWITCH_MODE'; mode: 'capture' | 'execute' }
  | { type: 'SET_TOOLS'; payload: ToolSchema[] }
  | { type: 'SET_SUGGESTED_TOOLS'; payload: ToolSchema[] }
  | { type: 'UPDATE_PAGE'; payload: { url: string; title: string } }
  | { type: 'SELECT_TOOL'; payload: ToolSchema }
  | { type: 'CLEAR_TOOL' }
  | { type: 'SET_INPUT'; payload: { field: string; value: string } }
  | { type: 'SET_RESULT'; payload: ExecutionResult }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_CAPTURING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string }
  | { type: 'CLEAR_ERROR' };

// ─── Initial state ──────────────────────────────────────

export const initialState: SidePanelState = {
  mode: 'execute',
  tools: [],
  suggestedTools: [],
  currentPageUrl: '',
  currentPageTitle: '',
  selectedTool: null,
  toolInputs: {},
  executionResult: null,
  loading: false,
  capturing: false,
  error: null,
};

// ─── Reducer ────────────────────────────────────────────

export function sidePanelReducer(state: SidePanelState, action: SidePanelAction): SidePanelState {
  switch (action.type) {
    case 'SWITCH_MODE':
      return { ...state, mode: action.mode, error: null };

    case 'SET_TOOLS':
      return { ...state, tools: action.payload };

    case 'SET_SUGGESTED_TOOLS':
      return { ...state, suggestedTools: action.payload };

    case 'UPDATE_PAGE':
      return {
        ...state,
        currentPageUrl: action.payload.url,
        currentPageTitle: action.payload.title,
      };

    case 'SELECT_TOOL':
      return {
        ...state,
        selectedTool: action.payload,
        toolInputs: {},
        executionResult: null,
        error: null,
      };

    case 'CLEAR_TOOL':
      return {
        ...state,
        selectedTool: null,
        toolInputs: {},
        executionResult: null,
      };

    case 'SET_INPUT':
      return {
        ...state,
        toolInputs: { ...state.toolInputs, [action.payload.field]: action.payload.value },
      };

    case 'SET_RESULT':
      return { ...state, executionResult: action.payload, loading: false };

    case 'SET_LOADING':
      return { ...state, loading: action.payload };

    case 'SET_CAPTURING':
      return { ...state, capturing: action.payload };

    case 'SET_ERROR':
      return { ...state, error: action.payload, loading: false };

    case 'CLEAR_ERROR':
      return { ...state, error: null };

    default:
      return state;
  }
}
