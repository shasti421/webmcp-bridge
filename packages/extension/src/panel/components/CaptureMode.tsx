/**
 * CaptureMode — Engineer UI for teaching the system.
 *
 * Shows:
 * - Current page info
 * - Capture page button to take DOM snapshot
 * - Suggested tool cards based on captured page
 * - Select tool button for each suggested tool
 */
import React from 'react';

import type { SidePanelState, SidePanelAction, ToolSchema } from '../reducer.js';

interface CaptureModeProps {
  state: SidePanelState;
  dispatch: (action: SidePanelAction) => void;
}

export function CaptureMode({ state, dispatch }: CaptureModeProps): React.JSX.Element {
  return (
    <div className="capture-panel">
      {state.currentPageUrl && (
        <div className="page-info">
          <span className="page-url">{state.currentPageUrl}</span>
          {state.currentPageTitle && (
            <span className="page-title">{state.currentPageTitle}</span>
          )}
        </div>
      )}

      <button
        className="capture-button"
        disabled={state.capturing}
      >
        {state.capturing ? 'Capturing...' : 'Capture Page'}
      </button>

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
