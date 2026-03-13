import { describe, it, expect } from 'vitest';

import { createBridgeError, type BridgeError, type BridgeErrorCode } from '../errors.js';

describe('createBridgeError', () => {
  it('creates an error with required fields', () => {
    const error = createBridgeError(
      'SELECTOR_NOT_FOUND',
      'Could not find element',
      'selector',
    );

    expect(error.code).toBe('SELECTOR_NOT_FOUND');
    expect(error.message).toBe('Could not find element');
    expect(error.source).toBe('selector');
    expect(error.timestamp).toBeInstanceOf(Date);
  });

  it('generates a timestamp automatically', () => {
    const before = new Date();
    const error = createBridgeError('UNKNOWN', 'test', 'engine');
    const after = new Date();

    expect(error.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(error.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('merges optional detail fields', () => {
    const error = createBridgeError(
      'TOOL_NOT_FOUND',
      'Tool not found',
      'engine',
      {
        toolName: 'add_todo',
        pageId: 'todo_list',
        stepIndex: 3,
      },
    );

    expect(error.toolName).toBe('add_todo');
    expect(error.pageId).toBe('todo_list');
    expect(error.stepIndex).toBe(3);
  });

  it('supports fieldId detail', () => {
    const error = createBridgeError(
      'SELECTOR_AMBIGUOUS',
      'Multiple matches',
      'selector',
      { fieldId: 'name_input' },
    );
    expect(error.fieldId).toBe('name_input');
  });

  it('supports cause detail', () => {
    const originalError = new Error('network timeout');
    const error = createBridgeError(
      'NAVIGATION_FAILED',
      'Failed to navigate',
      'driver',
      { cause: originalError },
    );
    expect(error.cause).toBe(originalError);
  });

  it('supports screenshot detail', () => {
    const screenshot = Buffer.from('fake-png-data');
    const error = createBridgeError(
      'HEALING_EXHAUSTED',
      'All healing strategies failed',
      'healing',
      { screenshot },
    );
    expect(error.screenshot).toBe(screenshot);
  });

  it('works with all error codes', () => {
    const codes: BridgeErrorCode[] = [
      'SELECTOR_NOT_FOUND',
      'SELECTOR_AMBIGUOUS',
      'ELEMENT_NOT_INTERACTABLE',
      'NAVIGATION_FAILED',
      'NAVIGATION_TIMEOUT',
      'CAPTURE_FAILED',
      'CAPTURE_TIMEOUT',
      'TOOL_NOT_FOUND',
      'PAGE_NOT_FOUND',
      'WORKFLOW_STEP_FAILED',
      'SCHEMA_VALIDATION_ERROR',
      'YAML_PARSE_ERROR',
      'HEALING_EXHAUSTED',
      'FRAME_NOT_FOUND',
      'DIALOG_UNEXPECTED',
      'REGISTRY_ERROR',
      'TIMEOUT',
      'DRIVER_ERROR',
      'UNKNOWN',
    ];

    for (const code of codes) {
      const error = createBridgeError(code, `Test ${code}`, 'engine');
      expect(error.code).toBe(code);
    }
  });

  it('works with all source types', () => {
    const sources: BridgeError['source'][] = [
      'selector',
      'engine',
      'capture',
      'healing',
      'semantic',
      'driver',
      'registry',
    ];

    for (const source of sources) {
      const error = createBridgeError('UNKNOWN', `Test ${source}`, source);
      expect(error.source).toBe(source);
    }
  });
});
