/**
 * Semantic Model Types — TypeScript representations of the YAML data model.
 * These are GENERIC — they describe the schema for ANY web application.
 * App-specific data lives only in YAML files, never in code.
 */
import type { SelectorChain } from './bridge-driver.js';

// ─── Application ─────────────────────────────────────
export interface AppDefinition {
  id: string;
  name: string;
  base_url: string;
  url_patterns: string[];
  auth?: AuthConfig;
  version?: string;
  description?: string;
  /** Registry metadata */
  registry?: { publisher?: string; tags?: string[]; license?: string };
}

export interface AuthConfig {
  type: 'browser_session' | 'oauth' | 'api_key' | 'saml';
  login_url?: string;
  session_check?: string;
}

// ─── Page (Primary Capture Unit) ─────────────────────
export interface PageDefinition {
  id: string;
  app: string;
  url_pattern: string;
  url_template?: string;
  wait_for: string;
  tab?: string;
  fields: FieldDefinition[];
  outputs: OutputDefinition[];
  overlays?: OverlayDefinition[];
}

export interface FieldDefinition {
  id: string;
  label: string;
  type: FieldType;
  options?: string[];
  depends_on?: string;
  selectors: SelectorChain;
  interaction: InteractionDefinition;
}

export type FieldType =
  | 'text' | 'picklist' | 'lookup' | 'checkbox' | 'date' | 'datetime'
  | 'number' | 'textarea' | 'file' | 'owner_change' | 'action_button'
  | 'radio' | 'toggle' | 'rich_text' | 'color' | 'range';

export interface InteractionDefinition {
  type: string;
  pattern?: string;
  steps?: InteractionStep[];
  on_error?: ErrorHandler;
}

export interface InteractionStep {
  action: string;
  target?: string;
  value?: string;
  selector?: string;
  role?: string;
  name?: string;
  scope?: string;
  wait?: number | string;
  delay_ms?: number;
  fallback?: InteractionStep;
  then?: InteractionStep[];
  condition?: string;
}

export interface ErrorHandler {
  match?: string;
  action: string;
  params?: Record<string, unknown>;
}

// ─── Output (Result Capture) ─────────────────────────
export interface OutputDefinition {
  id: string;
  label: string;
  selectors: SelectorChain;
  capture_strategies?: CaptureStrategy[];
  transient?: boolean;
  wait_timeout?: string;
  retry?: number;
  capture_on?: 'success' | 'failure' | 'always';
}

export interface CaptureStrategy {
  type: 'text_content' | 'pattern_match' | 'attribute' | 'table';
  selectors: SelectorChain;
  pattern?: string;
  group?: number;
  attribute?: string;
}

// ─── Overlay ─────────────────────────────────────────
export interface OverlayDefinition {
  id: string;
  trigger: string;
  dismiss: OverlayDismiss[];
}

export interface OverlayDismiss {
  strategy: 'click_close' | 'press_escape' | 'remove_element' | 'click_text';
  selector?: string;
  text?: string[];
  wait_after?: number;
}

// ─── Tool ────────────────────────────────────────────
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  bridge: ToolBridge;
}

export interface ToolBridge {
  page: string;
  steps: ToolStep[];
  returns?: Record<string, string>;
}

export type ToolStep =
  | NavigateStep | InteractStep | CaptureStep | ClickStep
  | WaitStep | TabStep | AuthStep | EvaluateStep;

export interface NavigateStep { navigate: { page: string; params?: Record<string, string> }; condition?: string }
export interface InteractStep { interact: { field: string; action?: string; value?: string; target?: string; dispatch?: DispatchEvent[]; retry?: RetryConfig }; condition?: string }
export interface CaptureStep { capture: { from: string; store_as: string; wait?: boolean; on_failure?: boolean } }
export interface ClickStep { interact: { action: 'click'; target: string } }
export interface WaitStep { wait: number | string }
export interface TabStep { tab: string }
export interface AuthStep { auth: string }
export interface EvaluateStep { evaluate_js: string }

export interface DispatchEvent { event: string; bubbles?: boolean }
export interface RetryConfig { attempts: number; backoff_ms: number; screenshot_on_failure?: boolean; on_exhausted?: 'escalate' | 'fail' | 'skip' }

// ─── Workflow ────────────────────────────────────────
export interface WorkflowDefinition {
  name: string;
  description: string;
  input: Record<string, WorkflowParam>;
  output?: Record<string, WorkflowParam>;
  steps: WorkflowStep[];
}

export interface WorkflowParam { type: string; required?: boolean; description?: string }
export type WorkflowStep = WorkflowToolStep | WorkflowForEachStep | WorkflowAggregateStep | AuthStep;
export interface WorkflowToolStep { tool: string; app?: string; params: Record<string, string>; capture?: Record<string, string>; on_empty?: string; on_error?: WorkflowToolStep | string; confirm?: boolean }
export interface WorkflowForEachStep { for_each: string; as: string; on_error?: 'continue' | 'stop'; steps: WorkflowStep[] }
export interface WorkflowAggregateStep { aggregate: Record<string, string> }

// ─── JSON Schema (subset) ────────────────────────────
export interface JsonSchema { type: string; properties?: Record<string, JsonSchemaProperty>; required?: string[]; items?: JsonSchema }
export interface JsonSchemaProperty { type: string; description?: string; enum?: string[]; items?: JsonSchema }

// ─── Interaction Patterns (reusable composites) ──────
export interface InteractionPatternLibrary {
  [patternName: string]: {
    steps: InteractionStep[];
    description?: string;
  };
}
