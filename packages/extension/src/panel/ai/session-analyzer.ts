/**
 * AI Session Analyzer — sends recorded session to Bedrock Claude
 * and receives structured semantic definitions (pages, tools, workflows).
 *
 * Runs in the side panel context. Uses the Anthropic Messages API
 * via AWS Bedrock to analyze the recording session and generate
 * YAML-ready JSON definitions.
 */

import type { RecordedAction } from '../reducer.js';

// ─── Types ──────────────────────────────────────────────

export interface AnalyzerConfig {
  region: string;
  modelId: string;
  maxTokens: number;
}

export interface SessionData {
  actions: RecordedAction[];
  pages: string[];
  startedAt: number;
  duration: number;
}

export interface AnalyzerResult {
  pages: Array<Record<string, unknown>>;
  tools: Array<Record<string, unknown>>;
  workflows: Array<Record<string, unknown>>;
  suggestions: string[];
}

// ─── Default config ─────────────────────────────────────

const DEFAULT_CONFIG: AnalyzerConfig = {
  region: 'us-east-1',
  modelId: 'anthropic.claude-sonnet-4-20250514',
  maxTokens: 8192,
};

// ─── Prompt Builder ─────────────────────────────────────

function summarizeAction(action: RecordedAction, index: number): string {
  const parts = [`  ${index + 1}. [${action.type.toUpperCase()}]`];

  if (action.element) {
    const el = action.element;
    const label = el.nearbyLabel || el.ariaLabel || el.text?.substring(0, 40) || el.tag;
    parts.push(`<${el.tag}> "${label}"`);

    if (el.ariaRole) parts.push(`(role=${el.ariaRole})`);
    if (el.href) parts.push(`href=${el.href.substring(0, 80)}`);
    if (el.value) parts.push(`value="${el.value.substring(0, 40)}"`);

    // Selector info
    if (el.selectors.aria) {
      parts.push(`[aria: role=${el.selectors.aria.role}, name="${el.selectors.aria.name}"]`);
    }
    if (el.selectors.css) {
      parts.push(`[css: ${el.selectors.css}]`);
    }
    if (el.shadowPath) {
      parts.push(`[shadow: depth=${el.shadowDepth}]`);
    }
  }

  if (action.metadata?.inputValue) {
    parts.push(`input="${action.metadata.inputValue.substring(0, 40)}"`);
  }
  if (action.metadata?.key) {
    parts.push(`key=${action.metadata.key}`);
  }
  if (action.metadata?.toUrl) {
    parts.push(`→ ${action.metadata.toUrl.substring(0, 80)}`);
  }

  return parts.join(' ');
}

function groupActionsByPage(actions: RecordedAction[]): Map<string, RecordedAction[]> {
  const groups = new Map<string, RecordedAction[]>();
  for (const action of actions) {
    const url = action.url;
    if (!groups.has(url)) groups.set(url, []);
    groups.get(url)!.push(action);
  }
  return groups;
}

function buildPrompt(session: SessionData): string {
  const pageGroups = groupActionsByPage(session.actions);

  let actionSummary = '';
  let globalIndex = 0;

  for (const [url, actions] of pageGroups) {
    actionSummary += `\n### Page: ${url}\n`;
    for (const action of actions) {
      actionSummary += summarizeAction(action, globalIndex++) + '\n';
    }
  }

  return `You are a semantic web automation expert. Analyze this recorded browser session and generate semantic definitions for the WebMCP Bridge framework.

## Semantic Definition Schema

### PageDefinition
Each page has:
- id: kebab-case identifier
- app: app identifier (derive from the domain)
- url_pattern: URL pattern with wildcards (e.g., "/lightning/r/Account/*/view")
- url_template: template with variables (e.g., "{{app.base_url}}/lightning/r/Account/{{account_id}}/view")
- wait_for: CSS selector indicating page is ready (prefer .slds-page-header for Salesforce, or main content selectors)
- fields: interactive elements (buttons, inputs, tabs) — each has id, label, type, selectors, interaction
- outputs: readable values — each has id, label, selectors, capture_strategies

### Selector Strategies (ordered by preference)
1. aria: { strategy: "aria", role: "button", name: "Details", confidence: 0.95 }
2. css: { strategy: "css", selector: "#my-id", confidence: 0.90 }
3. text: { strategy: "text", text: "Submit", exact: true, confidence: 0.85 }
4. js: { strategy: "js", expression: "(() => { ... })()", confidence: 0.80 }

### Field types
text, picklist, lookup, checkbox, date, datetime, number, textarea, file, action_button, radio, toggle

### Interaction types
click, text_input, select, check, fill

### ToolDefinition
Each tool has:
- name: kebab-case
- description: what the tool does
- inputSchema: JSON Schema for inputs
- bridge: { page: "page_id", steps: [...], returns: {...} }

### Tool step types
- navigate: { page: "page_id", params: {} }
- interact: { field: "page_id.fields.field_id", value: "{{input_var}}", action: "click" }
- capture: { from: "page_id.outputs.output_id", store_as: "var_name" }
- wait: 3000

### WorkflowDefinition
Chains multiple tools:
- name, description, input, steps
- Each step: { tool: "tool_name", params: {}, capture: {} }

## Recorded Session (${session.actions.length} actions, ${session.pages.length} pages, ${Math.round(session.duration / 1000)}s)
${actionSummary}

## Instructions

1. Create a PageDefinition for each unique URL pattern (collapse similar URLs into patterns with *)
2. For each page, identify fields (interactive elements the user clicked/typed in) and outputs (values that were read/displayed)
3. Use the element context to pick the best selector strategy:
   - If aria role+name available → use aria strategy
   - If element has unique ID → use css strategy
   - If element is in shadow DOM → use js strategy with an IIFE that walks labels
   - Always include confidence scores
4. Create ToolDefinitions that group logical action sequences (e.g., "click Details tab + capture URLs" = one tool)
5. If multiple tools are used in sequence, create a WorkflowDefinition chaining them
6. Add practical suggestions for improving the definitions

Respond with valid JSON only (no markdown fencing):
{
  "pages": [...],
  "tools": [...],
  "workflows": [...],
  "suggestions": [...]
}`;
}

// ─── Bedrock API Call ───────────────────────────────────

async function callBedrock(
  prompt: string,
  config: AnalyzerConfig,
): Promise<string> {
  // Use the AWS SDK credential chain — works with aws configure, env vars, or IAM roles
  // We dynamically import to avoid bundling issues
  const { BedrockRuntimeClient, InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');

  const client = new BedrockRuntimeClient({ region: config.region });

  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: config.maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });

  const command = new InvokeModelCommand({
    modelId: config.modelId,
    body: new TextEncoder().encode(body),
    contentType: 'application/json',
    accept: 'application/json',
  });

  const response = await client.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  if (responseBody.content && responseBody.content.length > 0) {
    return responseBody.content[0].text;
  }

  throw new Error('Empty response from Bedrock');
}

// ─── Parse Response ─────────────────────────────────────

function parseAnalyzerResponse(text: string): AnalyzerResult {
  // Strip markdown code fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(cleaned);

  return {
    pages: parsed.pages || [],
    tools: parsed.tools || [],
    workflows: parsed.workflows || [],
    suggestions: parsed.suggestions || [],
  };
}

// ─── Public API ─────────────────────────────────────────

export async function analyzeSession(
  session: SessionData,
  config?: Partial<AnalyzerConfig>,
): Promise<AnalyzerResult> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const prompt = buildPrompt(session);

  const responseText = await callBedrock(prompt, mergedConfig);
  return parseAnalyzerResponse(responseText);
}

export { buildPrompt, parseAnalyzerResponse, DEFAULT_CONFIG };
