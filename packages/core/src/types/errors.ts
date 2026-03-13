/**
 * Structured error types. Every error carries context for diagnostics + healing.
 */
export type BridgeErrorCode =
  | 'SELECTOR_NOT_FOUND'
  | 'SELECTOR_AMBIGUOUS'
  | 'ELEMENT_NOT_INTERACTABLE'
  | 'NAVIGATION_FAILED'
  | 'NAVIGATION_TIMEOUT'
  | 'CAPTURE_FAILED'
  | 'CAPTURE_TIMEOUT'
  | 'TOOL_NOT_FOUND'
  | 'PAGE_NOT_FOUND'
  | 'WORKFLOW_STEP_FAILED'
  | 'SCHEMA_VALIDATION_ERROR'
  | 'YAML_PARSE_ERROR'
  | 'HEALING_EXHAUSTED'
  | 'FRAME_NOT_FOUND'
  | 'DIALOG_UNEXPECTED'
  | 'REGISTRY_ERROR'
  | 'TIMEOUT'
  | 'DRIVER_ERROR'
  | 'UNKNOWN';

export interface BridgeError {
  code: BridgeErrorCode;
  message: string;
  source: 'selector' | 'engine' | 'capture' | 'healing' | 'semantic' | 'driver' | 'registry';
  pageId?: string;
  fieldId?: string;
  toolName?: string;
  stepIndex?: number;
  screenshot?: Buffer;
  cause?: unknown;
  timestamp: Date;
}

export function createBridgeError(
  code: BridgeErrorCode,
  message: string,
  source: BridgeError['source'],
  details?: Partial<Omit<BridgeError, 'code' | 'message' | 'source' | 'timestamp'>>,
): BridgeError {
  return { code, message, source, timestamp: new Date(), ...details };
}
