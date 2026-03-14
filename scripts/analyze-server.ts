#!/usr/bin/env npx tsx
/**
 * Local analysis server for Walk & Capture.
 *
 * Receives recorded sessions from the Chrome extension,
 * sends them to Bedrock Claude, and returns generated
 * semantic definitions.
 *
 * Usage: npx tsx scripts/analyze-server.ts
 */
import http from 'node:http';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const PORT = 3456;
const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-20250514-v1:0';
const REGION = process.env.AWS_DEFAULT_REGION || 'us-east-1';

const client = new BedrockRuntimeClient({ region: REGION });

function buildPrompt(session: { actions: unknown[]; pages: string[]; duration: number }): string {
  const actionSummary = (session.actions as Array<Record<string, unknown>>).map((action, i) => {
    const parts = [`  ${i + 1}. [${String(action.type).toUpperCase()}]`];
    const el = action.element as Record<string, unknown> | undefined;

    if (el) {
      const label = el.nearbyLabel || el.ariaLabel || (el.text as string)?.substring(0, 40) || el.tag;
      parts.push(`<${el.tag}> "${label}"`);
      if (el.ariaRole) parts.push(`(role=${el.ariaRole})`);
      if (el.href) parts.push(`href=${(el.href as string).substring(0, 80)}`);

      const selectors = el.selectors as Record<string, unknown> | undefined;
      if (selectors?.aria) {
        const aria = selectors.aria as { role: string; name: string };
        parts.push(`[aria: role=${aria.role}, name="${aria.name}"]`);
      }
      if (selectors?.css) parts.push(`[css: ${selectors.css}]`);
      if (el.shadowDepth) parts.push(`[shadow: depth=${el.shadowDepth}]`);
    }

    const meta = action.metadata as Record<string, unknown> | undefined;
    if (meta?.inputValue) parts.push(`input="${(meta.inputValue as string).substring(0, 40)}"`);
    if (meta?.key) parts.push(`key=${meta.key}`);
    if (meta?.toUrl) parts.push(`-> ${(meta.toUrl as string).substring(0, 80)}`);

    return parts.join(' ');
  }).join('\n');

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
   - If aria role+name available -> use aria strategy
   - If element has unique ID -> use css strategy
   - If element is in shadow DOM -> use js strategy with an IIFE that walks labels
   - Always include confidence scores
4. Create ToolDefinitions that group logical action sequences
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

async function analyzeSession(session: Record<string, unknown>): Promise<unknown> {
  const prompt = buildPrompt(session as { actions: unknown[]; pages: string[]; duration: number });

  console.log(`Sending to Bedrock (${MODEL_ID})...`);
  console.log(`Prompt length: ${prompt.length} chars`);

  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  });

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    body: new TextEncoder().encode(body),
    contentType: 'application/json',
    accept: 'application/json',
  });

  const response = await client.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const text = responseBody.content?.[0]?.text || '';

  // Parse JSON from response
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  return JSON.parse(cleaned);
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/analyze') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const session = JSON.parse(body);
        console.log(`\nAnalyzing session: ${session.actions?.length || 0} actions, ${session.pages?.length || 0} pages`);
        const result = await analyzeSession(session);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        console.log('Analysis complete.');
      } catch (err) {
        console.error('Analysis error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Walk & Capture analysis server running on http://localhost:${PORT}`);
  console.log(`Model: ${MODEL_ID} (region: ${REGION})`);
  console.log('Waiting for sessions from Chrome extension...\n');
});
