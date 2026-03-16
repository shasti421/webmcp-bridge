/**
 * Guide Mode — Record + Auto-Capture + Deterministic Build.
 *
 * Flow:
 * 1. User hits Record → recorder captures clicks/navigation
 * 2. On each page navigation, auto-runs page capture (same logic as CaptureMode)
 * 3. User stops recording → clicks Build Tool
 * 4. Builder matches recorded actions to captured elements (real selectors)
 * 5. AI only provides: tool name, description, template variable names
 * 6. YAML is built deterministically — no AI-generated selectors
 */
import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { SidePanelState, SidePanelAction, RecordedAction, CaptureSnapshot } from '../reducer.js';
import { runCapture } from '../utils/run-capture.js';
import {
  buildAppDefinition,
  buildPageDefinition,
  buildToolDefinition,
  deriveTemplateVariables,
  toYamlString,
  type ToolMetadata,
} from '../builders/yaml-builder.js';

const GUIDE_API_URL = 'http://localhost:3456/guide-build';

interface Props {
  state: SidePanelState;
  dispatch: React.Dispatch<SidePanelAction>;
}

// ─── Action helpers ──────────────────────────────────────

function getActionIcon(type: string): string {
  switch (type) {
    case 'click': return '\u{1F5B1}';
    case 'input': return '\u2328';
    case 'navigate': return '\u{1F517}';
    case 'keypress': return '\u2328';
    default: return '\u25CF';
  }
}

function getActionLabel(action: RecordedAction): string {
  const el = action.element;
  switch (action.type) {
    case 'click': {
      const target = el?.nearbyLabel || el?.ariaLabel || el?.text?.substring(0, 40) || el?.tag || 'element';
      return `Click "${target}"`;
    }
    case 'input': {
      const field = el?.nearbyLabel || el?.ariaLabel || el?.placeholder || el?.tag || 'field';
      const val = action.metadata?.inputValue;
      if (action.metadata?.inputKind === 'select') {
        return `Select "${(val as string | undefined)?.substring(0, 25) || 'option'}" in "${field}"`;
      }
      return `Type in "${field}"${val ? `: "${(val as string).substring(0, 25)}"` : ''}`;
    }
    case 'navigate': {
      const to = action.metadata?.toUrl as string | undefined;
      if (to) {
        try { return `Navigate to ${new URL(to).pathname.substring(0, 50)}`; }
        catch { return `Navigate to ${to.substring(0, 50)}`; }
      }
      return 'Page navigation';
    }
    case 'keypress':
      return `Press ${(action.metadata?.key as string) || 'key'}`;
    default:
      return action.type;
  }
}

function getElementDetail(action: RecordedAction): string | null {
  const el = action.element;
  if (!el) return null;
  const parts: string[] = [];
  parts.push(`<${el.tag}>`);
  if (el.ariaRole) parts.push(`role=${el.ariaRole}`);
  if (el.href) parts.push(el.href.substring(0, 70));
  if (el.shadowDepth) parts.push(`shadow:${el.shadowDepth}`);
  return parts.join(' ');
}

function shouldCaptureUiState(action: RecordedAction): boolean {
  if (action.type === 'input') {
    return true;
  }

  if (action.type !== 'click') {
    return false;
  }

  const tag = action.element?.tag || '';
  const label = `${action.element?.nearbyLabel || ''} ${action.element?.ariaLabel || ''} ${action.element?.text || ''}`.toLowerCase();

  if (tag === 'button' || tag === 'input' || tag.startsWith('lightning-') || tag.startsWith('lst-')) {
    return true;
  }

  return /show|filter|apply|more|menu|open|close|available|selected|status|new/.test(label);
}

// ─── Timer ───────────────────────────────────────────────

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

// ─── AI metadata fetcher (naming only, no selectors) ─────

async function fetchToolMetadata(
  pages: string[],
  actionLabels: string[],
  capturedFieldLabels: Record<string, string[]>,
): Promise<ToolMetadata> {
  try {
    const response = await fetch(GUIDE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages, actionLabels, capturedFieldLabels }),
    });

    if (response.ok) {
      return await response.json();
    }
  } catch {
    // AI server not available — fall through to defaults
  }

  // Fallback: derive metadata heuristically
  return deriveMetadataLocally(pages, actionLabels);
}

function deriveMetadataLocally(pages: string[], actionLabels: string[]): ToolMetadata {
  // Extract object type from URLs
  const objectTypes = new Set<string>();
  const templateVars = deriveTemplateVariables(pages);

  for (const url of pages) {
    try {
      const parts = new URL(url).pathname.split('/').filter(Boolean);
      const rIdx = parts.indexOf('r');
      if (rIdx >= 0 && parts[rIdx + 1]) {
        objectTypes.add(parts[rIdx + 1]!.toLowerCase());
      }
    } catch { /* skip invalid URLs */ }
  }

  const objects = Array.from(objectTypes);
  const mainObject = objects[0] || 'page';
  const actionSummary = actionLabels.slice(0, 3).join(', ').toLowerCase();

  // Build a descriptive name
  let name = `${mainObject}_actions`;
  if (actionSummary.includes('navigate')) name = `navigate_${mainObject}`;
  else if (actionSummary.includes('click')) name = `interact_${mainObject}`;
  else if (actionSummary.includes('capture') || actionSummary.includes('type')) name = `capture_${mainObject}_data`;

  const properties: Record<string, { type: string; description: string }> = {};
  const required: string[] = [];
  for (const paramName of Object.values(templateVars)) {
    properties[paramName] = { type: 'string', description: `Salesforce ${paramName.replace(/_/g, ' ')}` };
    required.push(paramName);
  }

  return {
    name,
    description: `Automated tool for ${mainObject}: ${actionLabels.slice(0, 3).join(', ')}`,
    inputSchema: { type: 'object', properties, required },
    templateVariables: templateVars,
  };
}

// ─── Main Component ──────────────────────────────────────

export function GuideMode({ state, dispatch }: Props) {
  const session = state.recordingSession;
  const [building, setBuilding] = useState(false);
  const [builtYaml, setBuiltYaml] = useState<{
    app: string;
    pages: string[];
    tools: string[];
    appId: string;
    savedTo?: string;
  } | null>(null);
  const [globalNote, setGlobalNote] = useState('');
  const feedRef = useRef<HTMLDivElement>(null);
  const isRecording = session?.status === 'recording';
  const actions = session?.actions || [];
  const pageSnapshots = session?.pageSnapshots || {};
  const snapshotCount = Object.keys(pageSnapshots).length;
  const timer = useTimer(session?.startedAt ?? null);

  // Track navigation captures separately from same-page UI-state captures.
  const scannedUrlsRef = useRef<Set<string>>(new Set());
  const pendingCapturesRef = useRef<Set<string>>(new Set());
  const lastStateCaptureAtRef = useRef<Map<string, number>>(new Map());


  // Listen for ACTION_STREAM and auto-capture on page changes
  useEffect(() => {
    const listener = (message: { type: string; payload?: unknown }) => {
      if (message.type === 'ACTION_STREAM' && message.payload) {
        const action = message.payload as RecordedAction;
        dispatch({ type: 'ACTION_RECEIVED', payload: action });

        const url = action.url || (action.metadata?.toUrl as string);
        if (!url) {
          return;
        }

        if (action.type === 'navigate' || !scannedUrlsRef.current.has(url)) {
          scheduleCapture(url, { reason: 'navigation' });
        } else if (shouldCaptureUiState(action)) {
          scheduleCapture(url, { reason: 'state', delayMs: 900 });
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [dispatch]);

  // Schedule a capture after the page settles.
  const scheduleCapture = useCallback((
    url: string,
    options?: { reason?: 'navigation' | 'state'; delayMs?: number },
  ) => {
    const reason = options?.reason || 'navigation';
    const delayMs = options?.delayMs ?? (reason === 'state' ? 900 : 3000);
    const pendingKey = `${reason}:${url}`;

    if (reason === 'navigation' && scannedUrlsRef.current.has(url)) return;
    if (pendingCapturesRef.current.has(pendingKey)) return;

    if (reason === 'state') {
      const lastCapturedAt = lastStateCaptureAtRef.current.get(url) || 0;
      if (Date.now() - lastCapturedAt < 1200) return;
      lastStateCaptureAtRef.current.set(url, Date.now());
    } else {
      scannedUrlsRef.current.add(url);
    }

    pendingCapturesRef.current.add(pendingKey);

    setTimeout(async () => {
      try {
        const snapshot = await runCapture();
        dispatch({
          type: 'PAGE_SNAPSHOT_CAPTURED',
          payload: { url: snapshot.url, snapshot },
        });
      } catch (err) {
        console.warn('Auto-capture failed for', url, err);
      } finally {
        pendingCapturesRef.current.delete(pendingKey);
      }
    }, delayMs);
  }, [dispatch]);

  // Auto-scroll on new actions
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [actions.length]);

  // Initial capture when recording starts
  const handleToggleRecording = useCallback(async () => {
    if (isRecording) {
      await chrome.runtime.sendMessage({ type: 'STOP_RECORDING', payload: {} }).catch(() => {});
      dispatch({ type: 'STOP_RECORDING' });
    } else {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'START_RECORDING', payload: {} });
        if (response?.ok) {
          scannedUrlsRef.current = new Set();
          pendingCapturesRef.current = new Set();
          lastStateCaptureAtRef.current = new Map();
          dispatch({
            type: 'START_RECORDING',
            payload: { id: response.sessionId || `rec_${Date.now()}`, startedAt: Date.now() },
          });
          setBuiltYaml(null);

          // Capture the current page immediately
          scheduleCapture(state.currentPageUrl, { reason: 'navigation' });
        } else {
          dispatch({ type: 'SET_ERROR', payload: response?.error || 'Failed to start recording' });
        }
      } catch (err) {
        dispatch({ type: 'SET_ERROR', payload: `Recording error: ${err}` });
      }
    }
  }, [isRecording, dispatch, state.currentPageUrl, scheduleCapture]);

  // ─── Build Tool (deterministic + AI naming) ───────────

  const handleBuild = useCallback(async () => {
    if (actions.length === 0) return;
    setBuilding(true);
    dispatch({ type: 'CLEAR_ERROR' });

    try {
      // 1. Collect action labels and field labels per page
      const actionLabels = actions.map(getActionLabel);
      const capturedFieldLabels: Record<string, string[]> = {};
      for (const snap of Object.values(pageSnapshots)) {
        const existing = capturedFieldLabels[snap.url] || [];
        const labels = snap.elements
          .filter(e => e.label)
          .map(e => e.label!);
        capturedFieldLabels[snap.url] = Array.from(new Set([...existing, ...labels]));
      }

      // 2. Get naming/metadata from AI (or local fallback)
      const meta = await fetchToolMetadata(
        session?.pages || [],
        actionLabels,
        capturedFieldLabels,
      );
      const derivedTemplateVariables = deriveTemplateVariables(session?.pages || []);
      meta.templateVariables = {
        ...derivedTemplateVariables,
        ...meta.templateVariables,
      };

      for (const [paramName, schema] of Object.entries(
        Object.fromEntries(Object.values(meta.templateVariables).map(name => [name, name])),
      )) {
        if (!meta.inputSchema.properties[paramName]) {
          meta.inputSchema.properties[paramName] = {
            type: 'string',
            description: `Salesforce ${schema.replace(/_/g, ' ')}`,
          };
        }
        if (!meta.inputSchema.required.includes(paramName)) {
          meta.inputSchema.required.push(paramName);
        }
      }

      // If user provided a global note, use it to refine the name
      if (globalNote.trim()) {
        const noteWords = globalNote.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/);
        if (noteWords.length <= 5) {
          meta.name = noteWords.join('_');
        }
        meta.description = globalNote.trim();
      }

      // 3. Build page definitions from captured snapshots
      const appId = deriveAppId(session?.pages || []);
      const capturedUrls = Array.from(new Set(Object.values(pageSnapshots).map(snapshot => snapshot.url)));
      const appDef = buildAppDefinition(appId, session?.pages || capturedUrls);
      const appYaml = toYamlString(appDef);
      const pageDefMap = new Map<string, ReturnType<typeof buildPageDefinition>>();

      for (const snapshot of Object.values(pageSnapshots)) {
        const pageDef = buildPageDefinition(snapshot, appId, meta.templateVariables);
        pageDefMap.set(pageDef.page.id, pageDef);
      }

      const pageDefs = Array.from(pageDefMap.values());
      const pageYamls = pageDefs.map(def => toYamlString(def));

      // 4. Build tool definition from recorded actions + matched elements
      const toolDef = buildToolDefinition(actions, pageSnapshots, meta, pageDefs);
      const toolYaml = toYamlString(toolDef);

      let savedTo: string | undefined;

      // 5. Save to server
      try {
        const response = await fetch('http://localhost:3456/save-definitions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appId,
            app: appDef.app,
            pages: pageYamls,
            tools: [toolYaml],
            captureLabel: meta.name,
            debug: {
              sessionId: session?.id,
              startedAt: session?.startedAt,
              pages: session?.pages || [],
              actionLabels,
              actions,
              pageSnapshots,
              toolMetadata: meta,
              generated: {
                app: appDef,
                pages: pageDefs,
                tool: toolDef,
              },
            },
          }),
        });
        if (response.ok) {
          const payload = await response.json() as { savedTo?: string };
          savedTo = payload.savedTo;
        }
      } catch {
        // Server may not be running — that's OK, user can still export
      }

      setBuiltYaml({ app: appYaml, pages: pageYamls, tools: [toolYaml], appId, savedTo });

      dispatch({
        type: 'SET_GENERATED',
        payload: {
          pages: pageDefs.map(def => def as unknown as Record<string, unknown>),
          tools: [toolDef as unknown as Record<string, unknown>],
          workflows: [],
          suggestions: [],
        },
      });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: `Build failed: ${err instanceof Error ? err.message : err}` });
    } finally {
      setBuilding(false);
    }
  }, [actions, pageSnapshots, session, globalNote, dispatch]);

  const handleReset = () => {
    dispatch({ type: 'GUIDE_CLEAR' });
    dispatch({ type: 'CLEAR_RECORDING' });
    setBuiltYaml(null);
    setGlobalNote('');
    scannedUrlsRef.current = new Set();
    pendingCapturesRef.current = new Set();
    lastStateCaptureAtRef.current = new Map();
  };

  const totalElements = Object.values(pageSnapshots).reduce(
    (sum, s) => sum + s.elements.length, 0,
  );

  // ─── Render: Built result view ────────────────────────

  if (builtYaml) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <div style={{
          background: '#d4edda', padding: '10px', fontSize: '13px',
          borderRadius: '6px', marginBottom: '6px', flexShrink: 0,
        }}>
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>
            Tool Built Successfully
          </div>
          <div style={{ fontSize: '12px', color: '#155724' }}>
            {builtYaml.pages.length} page(s), {builtYaml.tools.length} tool(s)
            {' \u2014 '}{Object.keys(pageSnapshots).length} snapshots captured,{' '}
            {totalElements} elements captured
          </div>
          {builtYaml.savedTo && (
            <div style={{ fontSize: '11px', color: '#155724', marginTop: '4px', wordBreak: 'break-word' }}>
              Saved to {builtYaml.savedTo}
            </div>
          )}
        </div>

        {/* YAML preview */}
        <div ref={feedRef} style={{ flex: 1, overflow: 'auto', padding: '4px' }}>
          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#7c3aed', marginBottom: '2px' }}>
              App Definition
            </div>
            <pre style={{
              background: '#f8f9fa', padding: '8px', borderRadius: '4px',
              fontSize: '10px', overflow: 'auto', whiteSpace: 'pre-wrap',
              border: '1px solid #e0e0e0', lineHeight: '1.4',
            }}>
              {builtYaml.app}
            </pre>
          </div>

          {builtYaml.pages.map((yaml, i) => (
            <div key={`page-${i}`} style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#2563eb', marginBottom: '2px' }}>
                Page Definition {i + 1}
              </div>
              <pre style={{
                background: '#f8f9fa', padding: '8px', borderRadius: '4px',
                fontSize: '10px', overflow: 'auto', whiteSpace: 'pre-wrap',
                border: '1px solid #e0e0e0', lineHeight: '1.4',
              }}>
                {yaml}
              </pre>
            </div>
          ))}

          {builtYaml.tools.map((yaml, i) => (
            <div key={`tool-${i}`} style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#059669', marginBottom: '2px' }}>
                Tool Definition {i + 1}
              </div>
              <pre style={{
                background: '#f8f9fa', padding: '8px', borderRadius: '4px',
                fontSize: '10px', overflow: 'auto', whiteSpace: 'pre-wrap',
                border: '1px solid #e0e0e0', lineHeight: '1.4',
              }}>
                {yaml}
              </pre>
            </div>
          ))}

          {/* Capture summary */}
          <div style={{
            background: '#f0f7ff', padding: '8px', borderRadius: '4px',
            fontSize: '11px', border: '1px solid #c3dafe', marginBottom: '8px',
          }}>
            <div style={{ fontWeight: 600, marginBottom: '4px' }}>Captured Elements</div>
            {Object.entries(pageSnapshots).map(([key, snap]) => (
              <div key={key} style={{ marginBottom: '4px' }}>
                <div style={{ color: '#2563eb', fontSize: '10px' }}>
                  {(() => { try { return new URL(snap.url).pathname.substring(0, 60); } catch { return snap.url; } })()}
                </div>
                <div style={{ color: '#555' }}>
                  {snap.elements.filter(e => e.type !== 'field_value').length} interactive,{' '}
                  {snap.elements.filter(e => e.type === 'field_value').length} field values
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom buttons */}
        <div style={{
          display: 'flex', gap: '6px', flexShrink: 0, padding: '6px 0',
          borderTop: '1px solid #e0e0e0',
        }}>
          <button
            onClick={() => {
              const allYaml = [builtYaml.app, ...builtYaml.pages, ...builtYaml.tools].join('\n---\n');
              const blob = new Blob([allYaml], { type: 'text/yaml' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${builtYaml.appId}_definitions.yaml`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            style={{
              flex: 1, padding: '8px', fontSize: '12px', background: '#0066cc',
              color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            Export YAML
          </button>
          <button
            onClick={handleReset}
            style={{
              padding: '8px 12px', fontSize: '12px', background: '#6c757d',
              color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer',
            }}
          >
            New Session
          </button>
        </div>
      </div>
    );
  }

  // ─── Render: Recording view ───────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '6px 0', borderBottom: '1px solid #e0e0e0', marginBottom: '4px', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => void handleToggleRecording()}
            style={{
              background: isRecording ? '#dc3545' : '#28a745',
              color: 'white', border: 'none', borderRadius: '14px',
              padding: '4px 12px', fontSize: '12px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '4px',
            }}
          >
            <span style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: 'white', display: 'inline-block',
            }} />
            {isRecording ? timer : 'Record'}
          </button>
          <span style={{ fontSize: '11px', color: '#666' }}>
            {actions.length > 0 && `${actions.length} actions`}
            {snapshotCount > 0 && ` \u00B7 ${snapshotCount} snapshots captured`}
            {totalElements > 0 && ` (${totalElements} elements)`}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {actions.length > 0 && !isRecording && (
            <button
              onClick={() => void handleBuild()}
              disabled={building}
              style={{
                fontSize: '11px', padding: '4px 10px',
                background: building ? '#ccc' : '#0066cc',
                color: 'white', border: 'none', borderRadius: '4px',
                cursor: building ? 'wait' : 'pointer', fontWeight: 'bold',
              }}
            >
              {building ? 'Building...' : 'Build Tool'}
            </button>
          )}
          <button
            onClick={handleReset}
            style={{
              fontSize: '11px', padding: '4px 8px', background: '#6c757d', color: 'white',
              border: 'none', borderRadius: '4px', cursor: 'pointer',
            }}
          >
            Reset
          </button>
        </div>
      </div>

      {/* Error */}
      {state.error && (
        <div style={{
          background: '#f8d7da', color: '#721c24', border: '1px solid #f5c6cb',
          borderRadius: '4px', padding: '6px 10px', marginBottom: '4px',
          fontSize: '11px', flexShrink: 0,
        }}>
          {state.error}
          <button onClick={() => dispatch({ type: 'CLEAR_ERROR' })} style={{
            float: 'right', background: 'none', border: 'none', color: '#721c24',
            cursor: 'pointer', fontSize: '11px',
          }}>x</button>
        </div>
      )}

      {/* Page scan badges */}
      {snapshotCount > 0 && (
        <div style={{
          padding: '4px 8px', background: '#e8f4fd', borderRadius: '4px',
          fontSize: '10px', color: '#0c5460', marginBottom: '4px', flexShrink: 0,
        }}>
          {Object.entries(pageSnapshots).map(([key, snap]) => (
            <div key={key} style={{ marginBottom: '2px' }}>
              Scanned: {snap.elements.length} elements on{' '}
              {(() => { try { return new URL(snap.url).pathname.substring(0, 50); } catch { return snap.url; } })()}
            </div>
          ))}
        </div>
      )}

      {/* Action feed */}
      <div ref={feedRef} style={{ flex: 1, overflow: 'auto' }}>
        {actions.length === 0 && (
          <div style={{ color: '#888', fontSize: '13px', textAlign: 'center', marginTop: '30px', lineHeight: '1.8' }}>
            {isRecording ? (
              <>
                Recording... interact with the page.
                <br />
                <span style={{ fontSize: '12px', color: '#aaa' }}>
                  Pages are auto-scanned for elements.<br />
                  Each action appears here in real-time.
                </span>
              </>
            ) : (
              <>
                Click <b>Record</b> and navigate your workflow.
                <br /><br />
                <span style={{ fontSize: '12px', color: '#aaa' }}>
                  1. Record your clicks &amp; navigation<br />
                  2. Pages are auto-scanned for selectors<br />
                  3. Stop, then <b>Build Tool</b> — uses real selectors
                </span>
              </>
            )}
          </div>
        )}

        {actions.map((action, i) => {
          const icon = getActionIcon(action.type);
          const label = getActionLabel(action);
          const detail = getElementDetail(action);

          return (
            <div key={action.id || `action-${i}`} style={{
              borderBottom: '1px solid #eee', padding: '6px 10px',
              display: 'flex', gap: '6px', alignItems: 'flex-start',
            }}>
              <span style={{ fontSize: '13px', flexShrink: 0, marginTop: '1px' }}>{icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '12px', fontWeight: 500, wordBreak: 'break-word' }}>
                  {i + 1}. {label}
                </div>
                {detail && (
                  <div style={{ color: '#999', fontSize: '10px', marginTop: '1px' }}>{detail}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Global context note */}
      {actions.length > 0 && !isRecording && (
        <div style={{
          padding: '6px 0', borderTop: '1px solid #e0e0e0', flexShrink: 0,
        }}>
          <input
            value={globalNote}
            onChange={(e) => setGlobalNote(e.target.value)}
            placeholder="Tool name/description (optional, e.g. 'navigate_to_related_cases')"
            style={{
              width: '100%', padding: '8px', fontSize: '12px',
              border: '1px solid #ccc', borderRadius: '6px', boxSizing: 'border-box',
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────

function deriveAppId(pages: string[]): string {
  for (const url of pages) {
    try {
      const host = new URL(url).hostname;
      // e.g. revance-oce--fulldev.sandbox.lightning.force.com -> revance_oce_fulldev
      const parts = host.split('.')[0]!.replace(/--/g, '_').replace(/-/g, '_');
      return parts;
    } catch { /* skip */ }
  }
  return 'app';
}
