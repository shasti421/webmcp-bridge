/**
 * Side Panel state management via useReducer.
 */

import type { RecordedAction, ElementContext } from '../content-script/recorder.js';

export type { RecordedAction, ElementContext };

// ─── Recording Types ────────────────────────────────────

export interface RecordingSessionState {
  id: string;
  startedAt: number;
  actions: RecordedAction[];
  pages: string[];
  status: 'recording' | 'analyzing' | 'complete' | 'error';
}

export interface GeneratedDefinitions {
  pages: Array<Record<string, unknown>>;
  tools: Array<Record<string, unknown>>;
  workflows: Array<Record<string, unknown>>;
  suggestions: string[];
}

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

export interface CapturedElement {
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
}

export interface CaptureSnapshot {
  url: string;
  title: string;
  elements: CapturedElement[];
  timestamp: number;
}

export interface SidePanelState {
  mode: 'capture' | 'execute' | 'record';
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
  snapshot: CaptureSnapshot | null;
  // Recording state
  recordingSession: RecordingSessionState | null;
  generatedDefinitions: GeneratedDefinitions | null;
}

// ─── Actions ────────────────────────────────────────────

export type SidePanelAction =
  | { type: 'SWITCH_MODE'; mode: 'capture' | 'execute' | 'record' }
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
  | { type: 'CLEAR_ERROR' }
  | { type: 'SET_SNAPSHOT'; payload: CaptureSnapshot }
  // Recording actions
  | { type: 'START_RECORDING'; payload: { id: string; startedAt: number } }
  | { type: 'STOP_RECORDING' }
  | { type: 'ACTION_RECEIVED'; payload: RecordedAction }
  | { type: 'SET_ANALYZING' }
  | { type: 'SET_GENERATED'; payload: GeneratedDefinitions }
  | { type: 'CLEAR_RECORDING' };

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
  snapshot: null,
  recordingSession: null,
  generatedDefinitions: null,
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

    case 'SET_SNAPSHOT':
      return { ...state, snapshot: action.payload, capturing: false };

    // ── Recording ──────────────────────────────────────
    case 'START_RECORDING':
      return {
        ...state,
        mode: 'record' as const,
        recordingSession: {
          id: action.payload.id,
          startedAt: action.payload.startedAt,
          actions: [],
          pages: [state.currentPageUrl],
          status: 'recording',
        },
        generatedDefinitions: null,
        error: null,
      };

    case 'STOP_RECORDING':
      if (!state.recordingSession) return state;
      return {
        ...state,
        recordingSession: { ...state.recordingSession, status: 'analyzing' },
      };

    case 'ACTION_RECEIVED':
      if (!state.recordingSession || state.recordingSession.status !== 'recording') return state;
      return {
        ...state,
        recordingSession: {
          ...state.recordingSession,
          actions: [...state.recordingSession.actions, action.payload],
          pages: action.payload.url && !state.recordingSession.pages.includes(action.payload.url)
            ? [...state.recordingSession.pages, action.payload.url]
            : state.recordingSession.pages,
        },
      };

    case 'SET_ANALYZING':
      if (!state.recordingSession) return state;
      return {
        ...state,
        recordingSession: { ...state.recordingSession, status: 'analyzing' },
        loading: true,
      };

    case 'SET_GENERATED':
      return {
        ...state,
        recordingSession: state.recordingSession
          ? { ...state.recordingSession, status: 'complete' }
          : null,
        generatedDefinitions: action.payload,
        loading: false,
      };

    case 'CLEAR_RECORDING':
      return {
        ...state,
        recordingSession: null,
        generatedDefinitions: null,
      };

    default:
      return state;
  }
}
