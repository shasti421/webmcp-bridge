/**
 * RecordMode — Walk & Capture AI Assistant.
 *
 * Records user interactions in real-time, shows a live action feed,
 * and sends the session to Bedrock Claude for semantic YAML generation.
 */
import React, { useEffect, useRef, useCallback, useState } from 'react';
import type { SidePanelState, SidePanelAction, RecordedAction } from '../reducer.js';
import { analyzeSession } from '../ai/session-analyzer.js';

interface Props {
  state: SidePanelState;
  dispatch: React.Dispatch<SidePanelAction>;
}

// ─── Action Card ────────────────────────────────────────

function getActionIcon(type: string): string {
  switch (type) {
    case 'click': return '\u{1F5B1}';
    case 'input': return '\u2328';
    case 'navigate': return '\u{1F517}';
    case 'keypress': return '\u2328';
    case 'tab_switch': return '\u{1F4C4}';
    default: return '\u25CF';
  }
}

function getActionLabel(action: RecordedAction): string {
  const el = action.element;

  switch (action.type) {
    case 'click': {
      const target = el?.nearbyLabel || el?.ariaLabel || el?.text?.substring(0, 30) || el?.tag || 'element';
      return `Click "${target}"`;
    }
    case 'input': {
      const field = el?.nearbyLabel || el?.ariaLabel || el?.placeholder || el?.tag || 'field';
      const val = action.metadata?.inputValue;
      return `Type in "${field}"${val ? `: "${val.substring(0, 20)}${val.length > 20 ? '...' : ''}"` : ''}`;
    }
    case 'navigate': {
      const to = action.metadata?.toUrl;
      if (to) {
        try {
          const path = new URL(to).pathname;
          return `Navigate to ${path.substring(0, 40)}`;
        } catch {
          return `Navigate to ${to.substring(0, 40)}`;
        }
      }
      return 'Page navigation';
    }
    case 'keypress':
      return `Press ${action.metadata?.key || 'key'}`;
    default:
      return action.type;
  }
}

function ActionCard({ action, index }: { action: RecordedAction; index: number }) {
  const icon = getActionIcon(action.type);
  const label = getActionLabel(action);
  const el = action.element;

  return (
    <div style={{
      padding: '8px 10px',
      borderBottom: '1px solid #eee',
      fontSize: '12px',
    }}>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
        <span style={{ fontSize: '14px', flexShrink: 0 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, wordBreak: 'break-word' }}>
            {index + 1}. {label}
          </div>
          {el && (
            <div style={{ color: '#666', fontSize: '11px', marginTop: '2px' }}>
              &lt;{el.tag}&gt;
              {el.ariaRole && ` role=${el.ariaRole}`}
              {el.shadowDepth ? ` (shadow depth: ${el.shadowDepth})` : ''}
              {el.href && (
                <div style={{ color: '#0066cc', wordBreak: 'break-all' }}>
                  {el.href.substring(0, 60)}{el.href.length > 60 ? '...' : ''}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Timer ──────────────────────────────────────────────

function useTimer(startedAt: number | null): string {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startedAt) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// ─── YAML Preview ───────────────────────────────────────

function YamlPreview({ data, title }: { data: Record<string, unknown>[]; title: string }) {
  const [expanded, setExpanded] = useState(false);

  if (data.length === 0) return null;

  // Simple YAML-like display
  const yamlText = data.map(item => {
    return Object.entries(item)
      .map(([k, v]) => {
        if (typeof v === 'string') return `  ${k}: "${v}"`;
        if (typeof v === 'number' || typeof v === 'boolean') return `  ${k}: ${v}`;
        if (Array.isArray(v)) return `  ${k}: [${v.length} items]`;
        return `  ${k}: {...}`;
      })
      .join('\n');
  }).join('\n---\n');

  return (
    <div style={{ marginBottom: '8px' }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ cursor: 'pointer', fontWeight: 500, fontSize: '13px', padding: '4px 0' }}
      >
        {expanded ? '\u25BC' : '\u25B6'} {title} ({data.length})
      </div>
      {expanded && (
        <pre style={{
          background: '#f5f5f5',
          padding: '8px',
          fontSize: '11px',
          borderRadius: '4px',
          overflow: 'auto',
          maxHeight: '200px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {yamlText}
        </pre>
      )}
    </div>
  );
}

// ─── Download Helpers ───────────────────────────────────

function toYamlString(obj: Record<string, unknown>, indent = 0): string {
  const pad = '  '.repeat(indent);
  let result = '';

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;

    if (typeof value === 'string') {
      result += `${pad}${key}: "${value}"\n`;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      result += `${pad}${key}: ${value}\n`;
    } else if (Array.isArray(value)) {
      result += `${pad}${key}:\n`;
      for (const item of value) {
        if (typeof item === 'object' && item !== null) {
          result += `${pad}  - ${toYamlString(item as Record<string, unknown>, indent + 2).trimStart()}`;
        } else {
          result += `${pad}  - ${JSON.stringify(item)}\n`;
        }
      }
    } else if (typeof value === 'object') {
      result += `${pad}${key}:\n${toYamlString(value as Record<string, unknown>, indent + 1)}`;
    }
  }

  return result;
}

function downloadYaml(definitions: { pages: Record<string, unknown>[]; tools: Record<string, unknown>[]; workflows: Record<string, unknown>[] }): void {
  const files: Array<{ name: string; content: string }> = [];

  for (const page of definitions.pages) {
    const id = (page['id'] as string) || 'page';
    files.push({
      name: `pages/${id}.yaml`,
      content: `# Page: ${page['id']}\npage:\n${toYamlString(page, 1)}`,
    });
  }

  for (const tool of definitions.tools) {
    const name = (tool['name'] as string) || 'tool';
    files.push({
      name: `tools/${name}.yaml`,
      content: `# Tool: ${tool['name']}\ntool:\n${toYamlString(tool, 1)}`,
    });
  }

  for (const wf of definitions.workflows) {
    const name = (wf['name'] as string) || 'workflow';
    files.push({
      name: `workflows/${name}.yaml`,
      content: `# Workflow: ${wf['name']}\nworkflow:\n${toYamlString(wf, 1)}`,
    });
  }

  // Download as individual files (or combined)
  const combined = files.map(f => `# === ${f.name} ===\n${f.content}`).join('\n\n');
  const blob = new Blob([combined], { type: 'text/yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'semantic-definitions.yaml';
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main Component ─────────────────────────────────────

export function RecordMode({ state, dispatch }: Props) {
  const session = state.recordingSession;
  const generated = state.generatedDefinitions;
  const feedRef = useRef<HTMLDivElement>(null);
  const timer = useTimer(session?.startedAt ?? null);

  // Listen for ACTION_STREAM messages from service worker
  useEffect(() => {
    const listener = (message: { type: string; payload?: unknown }) => {
      if (message.type === 'ACTION_STREAM' && message.payload) {
        dispatch({ type: 'ACTION_RECEIVED', payload: message.payload as RecordedAction });
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [dispatch]);

  // Auto-scroll feed
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [session?.actions.length]);

  // Start recording
  const handleStart = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'START_RECORDING', payload: {} });
      if (response?.ok) {
        dispatch({
          type: 'START_RECORDING',
          payload: { id: response.sessionId || `rec_${Date.now()}`, startedAt: Date.now() },
        });
      } else {
        dispatch({ type: 'SET_ERROR', payload: response?.error || 'Failed to start recording' });
      }
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: `Recording error: ${err}` });
    }
  }, [dispatch]);

  // Stop recording and analyze
  const handleStopAndGenerate = useCallback(async () => {
    if (!session) return;

    // Stop recording
    await chrome.runtime.sendMessage({ type: 'STOP_RECORDING', payload: {} }).catch(() => {});
    dispatch({ type: 'SET_ANALYZING' });

    try {
      const result = await analyzeSession({
        actions: session.actions,
        pages: session.pages,
        startedAt: session.startedAt,
        duration: Date.now() - session.startedAt,
      });

      dispatch({ type: 'SET_GENERATED', payload: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      dispatch({ type: 'SET_ERROR', payload: `AI analysis failed: ${message}` });
      dispatch({ type: 'STOP_RECORDING' });
    }
  }, [session, dispatch]);

  // ─── No active session: show start button ─────────────

  if (!session && !generated) {
    return (
      <div style={{ textAlign: 'center', padding: '20px' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: '15px' }}>Walk & Capture</h3>
        <p style={{ color: '#666', fontSize: '12px', margin: '0 0 16px' }}>
          Record your workflow and let AI generate semantic definitions automatically.
        </p>
        <button
          onClick={handleStart}
          style={{
            background: '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: '20px',
            padding: '10px 24px',
            fontSize: '14px',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: 'white' }} />
          Start Recording
        </button>
        <p style={{ color: '#999', fontSize: '11px', marginTop: '12px' }}>
          Navigate and interact with the page normally. The extension will capture your actions.
        </p>
      </div>
    );
  }

  // ─── Recording in progress ────────────────────────────

  if (session && session.status === 'recording') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Status bar */}
        <div style={{
          background: '#dc3545',
          color: 'white',
          padding: '8px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '13px',
        }}>
          <span>
            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: 'white', marginRight: '6px', animation: 'pulse 1s infinite' }} />
            Recording... ({timer})
          </span>
          <button
            onClick={handleStopAndGenerate}
            disabled={session.actions.length === 0}
            style={{
              background: 'white',
              color: '#dc3545',
              border: 'none',
              borderRadius: '4px',
              padding: '4px 12px',
              fontSize: '12px',
              cursor: session.actions.length > 0 ? 'pointer' : 'not-allowed',
              opacity: session.actions.length > 0 ? 1 : 0.5,
            }}
          >
            Stop & Generate
          </button>
        </div>

        {/* Action feed */}
        <div
          ref={feedRef}
          style={{
            flex: 1,
            overflow: 'auto',
            borderBottom: '1px solid #ddd',
          }}
        >
          {session.actions.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#999', fontSize: '12px' }}>
              Waiting for actions... Interact with the page.
            </div>
          ) : (
            session.actions.map((action, i) => (
              <ActionCard key={action.id} action={action} index={i} />
            ))
          )}
        </div>

        {/* Stats */}
        <div style={{
          padding: '8px 12px',
          fontSize: '11px',
          color: '#666',
          display: 'flex',
          justifyContent: 'space-between',
        }}>
          <span>Actions: {session.actions.length}</span>
          <span>Pages: {session.pages.length}</span>
        </div>
      </div>
    );
  }

  // ─── Analyzing ────────────────────────────────────────

  if (session?.status === 'analyzing' || state.loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: '24px', marginBottom: '12px' }}>
          {'\u2699\uFE0F'}
        </div>
        <p style={{ fontWeight: 500, fontSize: '14px', margin: '0 0 8px' }}>
          AI is analyzing your session...
        </p>
        <p style={{ color: '#666', fontSize: '12px', margin: 0 }}>
          {session?.actions.length || 0} actions across {session?.pages.length || 0} pages
        </p>
      </div>
    );
  }

  // ─── Results / Review ─────────────────────────────────

  if (generated) {
    return (
      <div style={{ padding: '12px' }}>
        <div style={{
          background: '#d4edda',
          border: '1px solid #c3e6cb',
          borderRadius: '6px',
          padding: '10px 12px',
          marginBottom: '12px',
          fontSize: '13px',
        }}>
          Generation Complete:
          {' '}{generated.pages.length} pages,
          {' '}{generated.tools.length} tools,
          {' '}{generated.workflows.length} workflows
        </div>

        <YamlPreview data={generated.pages} title="Pages" />
        <YamlPreview data={generated.tools} title="Tools" />
        <YamlPreview data={generated.workflows} title="Workflows" />

        {generated.suggestions.length > 0 && (
          <div style={{ marginTop: '12px' }}>
            <div style={{ fontWeight: 500, fontSize: '13px', marginBottom: '4px' }}>
              AI Suggestions:
            </div>
            <ul style={{ fontSize: '11px', color: '#666', paddingLeft: '16px', margin: 0 }}>
              {generated.suggestions.map((s, i) => (
                <li key={i} style={{ marginBottom: '4px' }}>{s}</li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
          <button
            onClick={() => downloadYaml(generated as { pages: Record<string, unknown>[]; tools: Record<string, unknown>[]; workflows: Record<string, unknown>[] })}
            style={{
              flex: 1,
              background: '#0066cc',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              padding: '8px',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            Download YAML
          </button>
          <button
            onClick={() => dispatch({ type: 'CLEAR_RECORDING' })}
            style={{
              flex: 1,
              background: '#f8f9fa',
              color: '#333',
              border: '1px solid #ddd',
              borderRadius: '4px',
              padding: '8px',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            New Recording
          </button>
        </div>
      </div>
    );
  }

  // Fallback
  return null;
}
