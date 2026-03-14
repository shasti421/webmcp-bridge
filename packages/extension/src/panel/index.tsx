import React, { useReducer, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CaptureMode } from './components/CaptureMode.js';
import { ExecuteMode } from './components/ExecuteMode.js';
import { RecordMode } from './components/RecordMode.js';
import { sidePanelReducer, initialState } from './reducer.js';

type Mode = 'capture' | 'execute' | 'record';

const TAB_STYLE = (active: boolean) => ({
  fontWeight: active ? 'bold' as const : 'normal' as const,
  background: active ? '#0066cc' : '#f0f0f0',
  color: active ? 'white' : '#333',
  border: 'none',
  borderRadius: '4px',
  padding: '6px 12px',
  fontSize: '12px',
  cursor: 'pointer' as const,
});

function App() {
  const [state, dispatch] = useReducer(sidePanelReducer, initialState);
  const [mode, setMode] = useState<Mode>('record');

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '12px', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexShrink: 0 }}>
        <button onClick={() => setMode('record')} style={TAB_STYLE(mode === 'record')}>
          Record
        </button>
        <button onClick={() => setMode('capture')} style={TAB_STYLE(mode === 'capture')}>
          Capture
        </button>
        <button onClick={() => setMode('execute')} style={TAB_STYLE(mode === 'execute')}>
          Execute
        </button>
      </header>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {mode === 'record' && <RecordMode state={state} dispatch={dispatch} />}
        {mode === 'capture' && <CaptureMode state={state} dispatch={dispatch} />}
        {mode === 'execute' && <ExecuteMode state={state} dispatch={dispatch} />}
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App />);
}
