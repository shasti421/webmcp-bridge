/**
 * ExecuteMode — Business User UI for using captured tools.
 *
 * Shows:
 * - Tool selector dropdown
 * - Dynamic input fields based on selected tool's inputSchema
 * - Execute button
 * - Execution results display
 * - Error banner
 */
import React from 'react';

import type { SidePanelState, SidePanelAction } from '../reducer.js';

interface ExecuteModeProps {
  state: SidePanelState;
  dispatch: (action: SidePanelAction) => void;
}

function mapSchemaTypeToInput(schemaType: string): string {
  switch (schemaType) {
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'checkbox';
    default:
      return 'text';
  }
}

export function ExecuteMode({ state, dispatch }: ExecuteModeProps): React.JSX.Element {
  const handleToolSelect = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const tool = state.tools.find((t) => t.name === e.target.value);
    if (tool) {
      dispatch({ type: 'SELECT_TOOL', payload: tool });
    }
  };

  const handleInputChange = (field: string, value: string): void => {
    dispatch({ type: 'SET_INPUT', payload: { field, value } });
  };

  return (
    <div className="execute-panel">
      <select onChange={handleToolSelect} value={state.selectedTool?.name ?? ''}>
        <option value="">Select a tool...</option>
        {state.tools.map((tool) => (
          <option key={tool.name} value={tool.name}>
            {tool.name}
          </option>
        ))}
      </select>

      {state.selectedTool && (
        <div className="tool-form">
          <p className="tool-description">{state.selectedTool.description}</p>

          {Object.entries(state.selectedTool.inputSchema.properties ?? {}).map(([field, schema]) => (
            <div key={field} className="input-field">
              <label htmlFor={`field-${field}`}>{field}</label>
              <input
                id={`field-${field}`}
                type={mapSchemaTypeToInput(schema.type)}
                value={state.toolInputs[field] ?? ''}
                onChange={(e) => handleInputChange(field, e.target.value)}
                required={state.selectedTool?.inputSchema.required?.includes(field)}
              />
              {schema.description && <small>{schema.description}</small>}
            </div>
          ))}

          <button
            className="execute-button"
            disabled={state.loading}
          >
            {state.loading ? 'Executing...' : 'Execute'}
          </button>
        </div>
      )}

      {state.executionResult && (
        <div className="result">
          <h3>Result</h3>
          <pre>{JSON.stringify(state.executionResult, null, 2)}</pre>
        </div>
      )}

      {state.error && (
        <div className="error-banner" role="alert">
          {state.error}
        </div>
      )}
    </div>
  );
}
