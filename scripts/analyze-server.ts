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
import fs from 'node:fs';
import path from 'node:path';
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

## CRITICAL NAMING RULES
- ALL identifiers (page id, field id, tool name, workflow name, app id) MUST use snake_case: lowercase letters, digits, underscores only.
- Pattern: ^[a-z0-9_]+$
- Examples: account_detail, navigate_to_cases, filter_status, case_detail_page
- NEVER use kebab-case (no hyphens). "account-detail" is INVALID, use "account_detail".

## Semantic Definition Schema

### PageDefinition (YAML key: "page:")
\`\`\`yaml
page:
  id: account_detail          # snake_case
  app: my_app_id              # snake_case, must match app.id
  url_pattern: "/lightning/r/Account/*/view"
  url_template: "{{app.base_url}}/lightning/r/Account/{{account_id}}/view"
  wait_for: ".slds-page-header"  # CSS selector for page ready
  fields:                     # interactive elements
    - id: details_tab         # snake_case
      label: "Details"
      type: action_button
      selectors:              # MUST include 2+ strategies from recorded data
        - strategy: aria
          role: tab
          name: "Details"
          confidence: 0.95
        - strategy: css
          selector: "#detailTab__item"
          confidence: 0.85
      interaction:
        type: click
  outputs:                    # readable values
    - id: account_name
      label: "Account Name"
      selectors:
        - strategy: css
          selector: ".slds-page-header__title"
          confidence: 0.90
\`\`\`

### Selector Strategies (ordered by preference)
1. aria: { strategy: "aria", role: "button", name: "Details", confidence: 0.95 }
2. css: { strategy: "css", selector: "#my-id", confidence: 0.90 }
3. text: { strategy: "text", text: "Submit", exact: true, confidence: 0.85 }
4. js: { strategy: "js", expression: "(() => { ... })()", confidence: 0.80 }

IMPORTANT: Use the EXACT selectors from the recorded session data. The recorded [aria:] and [css:] values come from the actual DOM — use them directly. Do NOT invent or guess selectors.

### Field types
text, picklist, lookup, checkbox, date, datetime, number, textarea, file, action_button, radio, toggle

### Interaction types
click, text_input, select, check, fill

### ToolDefinition (YAML key: "tool:")
\`\`\`yaml
tool:
  name: navigate_to_cases     # snake_case
  description: "Navigate to account cases"
  inputSchema:
    type: object
    properties:
      account_id:
        type: string
        description: "Salesforce Account ID"
    required: [account_id]
  bridge:
    page: account_detail      # snake_case page id
    steps:
      - navigate:
          page: account_detail
          params:
            account_id: "{{account_id}}"
      - wait: 2000
      - interact:
          field: account_detail.fields.details_tab
          action: click
    returns:
      account_id: "{{account_id}}"
\`\`\`

### ToolDefinition inputSchema rules
- inputSchema must be a valid JSON Schema with only: type, properties, required, description
- Do NOT use "default" in property definitions — it will fail validation

### WorkflowDefinition (YAML key: "workflow:")
\`\`\`yaml
workflow:
  name: my_workflow              # snake_case
  description: "Does X then Y"
  input:                         # NOTE: "input" not "inputSchema"
    account_id:
      type: string
      description: "Salesforce Account ID"
  steps:
    - tool: first_tool_name
      params:
        account_id: "{{account_id}}"
    - tool: second_tool_name
      params:
        some_param: "{{some_value}}"
\`\`\`

## Recorded Session (${session.actions.length} actions, ${session.pages.length} pages, ${Math.round(session.duration / 1000)}s)
${actionSummary}

## Instructions

1. Create a PageDefinition for each unique URL pattern (collapse similar URLs into patterns with *)
2. For each page, identify fields (interactive elements the user clicked/typed in) and outputs (values displayed)
3. SELECTOR RULES — this is critical for the definitions to work:
   - Use the EXACT aria role+name from the recorded [aria:] data — do not modify or guess
   - Use the EXACT CSS selector from the recorded [css:] data — do not simplify or guess
   - ALWAYS include at least 2 selector strategies per field as fallbacks
   - If element is in shadow DOM (shadow: depth > 0) -> add a js strategy with an IIFE
4. Create ToolDefinitions that group logical action sequences
5. If multiple tools are used in sequence, create a WorkflowDefinition chaining them
6. Add practical suggestions for improving the definitions

## App Definition
Also generate an app definition:
\`\`\`yaml
app:
  id: my_app_id               # snake_case, derived from domain
  name: "Human Readable Name"
  base_url: "https://example.com"  # base URL from session pages
  url_patterns:
    - "/path/pattern/*"
\`\`\`

Respond with valid JSON only (no markdown fencing):
{
  "app": { ... },
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

// ─── YAML Writer ─────────────────────────────────────────

const EXAMPLES_DIR = path.join(process.cwd(), 'semantic-examples');

function sanitizeDirName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'captured_app';
}

function formatTimestamp(date = new Date()): string {
  const pad = (num: number): string => String(num).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function resolveOutputDirectory(appDirName: string, captureLabel?: string): { outDir: string; dirName: string; relativeDir: string } {
  const baseName = sanitizeDirName(appDirName);
  const preferredDir = path.join(EXAMPLES_DIR, baseName);

  if (!fs.existsSync(preferredDir)) {
    return {
      outDir: preferredDir,
      dirName: baseName,
      relativeDir: path.join('semantic-examples', baseName),
    };
  }

  const suffixParts = ['capture', formatTimestamp()];
  const safeLabel = captureLabel ? sanitizeDirName(captureLabel).slice(0, 40) : '';
  if (safeLabel) {
    suffixParts.push(safeLabel);
  }

  let dirName = `${baseName}_${suffixParts.join('_')}`;
  let attempt = 2;
  while (fs.existsSync(path.join(EXAMPLES_DIR, dirName))) {
    dirName = `${baseName}_${suffixParts.join('_')}_${attempt++}`;
  }

  return {
    outDir: path.join(EXAMPLES_DIR, dirName),
    dirName,
    relativeDir: path.join('semantic-examples', dirName),
  };
}

function toYaml(obj: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'boolean') return String(obj);
  if (typeof obj === 'number') return String(obj);
  if (typeof obj === 'string') {
    if (obj.includes('{{') || obj.includes(':') || obj.includes('#') || obj.includes('"') || obj.includes("'") || obj.startsWith('*') || obj === '') {
      return `"${obj.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return obj.map(item => {
      if (typeof item === 'object' && item !== null) {
        const inner = toYaml(item, indent + 1).trimStart();
        return `${pad}- ${inner}`;
      }
      return `${pad}- ${toYaml(item)}`;
    }).join('\n');
  }
  if (typeof obj === 'object') {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return entries.map(([key, val]) => {
      if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        return `${pad}${key}:\n${toYaml(val, indent + 1)}`;
      }
      if (Array.isArray(val)) {
        return `${pad}${key}:\n${toYaml(val, indent + 1)}`;
      }
      return `${pad}${key}: ${toYaml(val)}`;
    }).join('\n');
  }
  return String(obj);
}

function saveDefinitions(
  result: Record<string, unknown>,
  appDirName: string,
  captureLabel?: string,
): { saved: string[]; relativeDir: string; dirName: string } {
  const { outDir, relativeDir, dirName } = resolveOutputDirectory(appDirName, captureLabel);
  const saved: string[] = [];

  // Create directories
  fs.mkdirSync(path.join(outDir, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'tools'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'workflows'), { recursive: true });

  // Save app
  const appDef = result.app as Record<string, unknown> | undefined;
  if (appDef) {
    const yaml = toYaml({ app: appDef });
    const filePath = path.join(outDir, 'app.yaml');
    fs.writeFileSync(filePath, yaml + '\n');
    saved.push(filePath);
  }

  // Save pages
  const pages = result.pages as Array<Record<string, unknown>> | undefined;
  if (pages) {
    for (const pageDef of pages) {
      const id = pageDef.id as string;
      if (!id) continue;
      const yaml = toYaml({ page: pageDef });
      const filePath = path.join(outDir, 'pages', `${id}.yaml`);
      fs.writeFileSync(filePath, yaml + '\n');
      saved.push(filePath);
    }
  }

  // Save tools
  const tools = result.tools as Array<Record<string, unknown>> | undefined;
  if (tools) {
    for (const toolDef of tools) {
      const name = toolDef.name as string;
      if (!name) continue;
      const yaml = toYaml({ tool: toolDef });
      const filePath = path.join(outDir, 'tools', `${name}.yaml`);
      fs.writeFileSync(filePath, yaml + '\n');
      saved.push(filePath);
    }
  }

  // Save workflows
  const workflows = result.workflows as Array<Record<string, unknown>> | undefined;
  if (workflows) {
    for (const wfDef of workflows) {
      const name = wfDef.name as string;
      if (!name) continue;
      const yaml = toYaml({ workflow: wfDef });
      const filePath = path.join(outDir, 'workflows', `${name}.yaml`);
      fs.writeFileSync(filePath, yaml + '\n');
      saved.push(filePath);
    }
  }

  return { saved, relativeDir, dirName };
}

// ─── Guide Mode (Conversational) ─────────────────────────

const GUIDE_SYSTEM_PROMPT = `You are a semantic web automation assistant embedded in a Chrome extension side panel. The user is navigating a web application and describing what they want to automate. You can see the current page's DOM elements.

Your job is to:
1. Understand what the user wants to capture or automate
2. Look at the DOM elements provided and identify the right selectors
3. Build semantic definitions (pages, tools, workflows) incrementally
4. Ask clarifying questions when needed
5. When you have enough info, generate YAML definitions

## Naming Rules
- ALL identifiers must use snake_case: ^[a-z0-9_]+$
- NEVER use kebab-case (no hyphens)

## When generating definitions, output them in a JSON block:
\`\`\`definitions
{
  "pages": [...],
  "tools": [...],
  "workflows": [...]
}
\`\`\`

## Selector Strategy Priority
Use selectors from the actual DOM elements provided:
1. aria: { strategy: "aria", role: "tab", name: "Details", confidence: 0.95 }
2. css with ID: { strategy: "css", selector: "#elementId", confidence: 0.90 }
3. text: { strategy: "text", text: "Button Text", exact: true, confidence: 0.85 }
4. css class: { strategy: "css", selector: ".specific-class", confidence: 0.80 }

Always include 2+ selector strategies per field as fallbacks.

## Response Style
- Be concise and conversational
- When you see DOM elements matching what the user describes, confirm what you found
- Suggest what to capture next based on context
- When you generate definitions, also explain what was generated in plain language`;

// Store conversation context per session
const guideSessions = new Map<string, Array<{ role: string; content: string }>>();

async function handleGuideMessage(
  sessionId: string,
  userMessage: string,
  _history: Array<{ role: string; content: string }>,
  pageContext: { url: string; title: string; elements: Array<Record<string, unknown>> },
  recordedActions?: Array<Record<string, unknown>>,
): Promise<{ reply: string; definitions?: { pages: unknown[]; tools: unknown[]; workflows: unknown[] } }> {

  // Build conversation history
  if (!guideSessions.has(sessionId)) {
    guideSessions.set(sessionId, []);
  }
  const conversation = guideSessions.get(sessionId)!;

  // Add page context to user message
  const elementSummary = (pageContext.elements || []).map((el, i) => {
    const parts = [`${i + 1}. <${el.tag}>`];
    if (el.role) parts.push(`role="${el.role}"`);
    if (el.ariaLabel) parts.push(`aria-label="${el.ariaLabel}"`);
    if (el.text) parts.push(`"${(el.text as string).substring(0, 50)}"`);
    if (el.id) parts.push(`id="${el.id}"`);
    if (el.type) parts.push(`type="${el.type}"`);
    if (el.href) parts.push(`href="${(el.href as string).substring(0, 60)}"`);
    return parts.join(' ');
  }).join('\n');

  // Summarize recorded actions if present
  let actionsSummary = '';
  if (recordedActions && recordedActions.length > 0) {
    const actionLines = recordedActions.map((a, i) => {
      const el = a.element as Record<string, unknown> | undefined;
      const meta = a.metadata as Record<string, unknown> | undefined;
      const parts = [`  ${i + 1}. [${String(a.type).toUpperCase()}]`];
      if (el) {
        const label = el.nearbyLabel || el.ariaLabel || (el.text as string)?.substring(0, 40) || el.tag;
        parts.push(`"${label}"`);
        if (el.ariaRole) parts.push(`(role=${el.ariaRole})`);
        const selectors = el.selectors as Record<string, unknown> | undefined;
        if (selectors?.aria) {
          const aria = selectors.aria as { role: string; name: string };
          parts.push(`[aria: role=${aria.role}, name="${aria.name}"]`);
        }
        if (selectors?.css) parts.push(`[css: ${selectors.css}]`);
      }
      if (meta?.inputValue) parts.push(`input="${(meta.inputValue as string).substring(0, 40)}"`);
      if (meta?.toUrl) parts.push(`-> ${(meta.toUrl as string).substring(0, 80)}`);
      return parts.join(' ');
    }).join('\n');
    actionsSummary = `\n[Recorded Actions (${recordedActions.length} recent):\n${actionLines}]`;
  }

  const contextMessage = `[Current Page: ${pageContext.url}]
[Title: ${pageContext.title}]
[DOM Elements (${pageContext.elements?.length || 0}):
${elementSummary}]${actionsSummary}

User: ${userMessage}`;

  conversation.push({ role: 'user', content: contextMessage });

  // Call Bedrock
  console.log(`  Sending to Bedrock (${conversation.length} messages)...`);

  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 4096,
    system: GUIDE_SYSTEM_PROMPT,
    messages: conversation.map(m => ({ role: m.role, content: m.content })),
  });

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    body: new TextEncoder().encode(body),
    contentType: 'application/json',
    accept: 'application/json',
  });

  const response = await client.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const reply = responseBody.content?.[0]?.text || 'No response from model.';

  // Store assistant reply in conversation
  conversation.push({ role: 'assistant', content: reply });

  // Extract definitions if present
  let definitions: { pages: unknown[]; tools: unknown[]; workflows: unknown[] } | undefined;
  const defMatch = reply.match(/```definitions\s*\n([\s\S]*?)```/);
  if (defMatch) {
    try {
      const parsed = JSON.parse(defMatch[1]);
      definitions = {
        pages: parsed.pages || [],
        tools: parsed.tools || [],
        workflows: parsed.workflows || [],
      };

      // Auto-save definitions
      const appId = 'revance_oce_fulldev'; // Default; could be derived from URL
      try {
          const saveResult = saveDefinitions(parsed, appId, (parsed.tools as Array<Record<string, unknown>> | undefined)?.[0]?.name as string | undefined);
          console.log(`  Saved ${saveResult.saved.length} YAML files to ${saveResult.relativeDir}/`);
        } catch (saveErr) {
          console.error('  Warning: Failed to save YAML files:', saveErr);
        }
    } catch {
      // Definitions block wasn't valid JSON — that's fine
    }
  }

  // Clean reply — remove the definitions block from the displayed message
  const cleanReply = reply.replace(/```definitions\s*\n[\s\S]*?```/g, '').trim();

  console.log(`  Assistant: "${cleanReply.substring(0, 80)}..."`);
  if (definitions) {
    console.log(`  Generated: ${definitions.pages.length} pages, ${definitions.tools.length} tools, ${definitions.workflows.length} workflows`);
  }

  return { reply: cleanReply, definitions };
}

// ─── HTTP Server ─────────────────────────────────────────

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
        const result = await analyzeSession(session) as Record<string, unknown>;

        // Auto-save YAML files
        const appId = ((result.app as Record<string, unknown>)?.id as string) || 'captured_app';
        const appDirName = appId.replace(/[^a-z0-9_]/g, '_');
        try {
          const saveResult = saveDefinitions(
            result,
            appDirName,
            (result.tools as Array<Record<string, unknown>> | undefined)?.[0]?.name as string | undefined,
          );
          console.log(`Saved ${saveResult.saved.length} YAML files to ${saveResult.relativeDir}/`);
          saveResult.saved.forEach(f => console.log(`  → ${path.relative(process.cwd(), f)}`));
          (result as Record<string, unknown>).savedTo = `${saveResult.relativeDir}/`;
          (result as Record<string, unknown>).savedFiles = saveResult.saved.map(f => path.relative(process.cwd(), f));
        } catch (saveErr) {
          console.error('Warning: Failed to save YAML files:', saveErr);
        }

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

  if (req.method === 'POST' && req.url === '/guide') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { sessionId, message, history, pageContext, recordedActions } = JSON.parse(body);
        console.log(`\n[Guide ${sessionId}] User: "${message.substring(0, 80)}"`);
        console.log(`  Page: ${pageContext?.url || 'unknown'} (${pageContext?.elements?.length || 0} elements)`);
        if (recordedActions?.length) console.log(`  Recorded actions: ${recordedActions.length}`);

        const result = await handleGuideMessage(sessionId, message, history || [], pageContext, recordedActions);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error('Guide error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // ─── /guide-build: AI naming only (no selectors) ──────
  if (req.method === 'POST' && req.url === '/guide-build') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { pages, actionLabels, capturedFieldLabels } = JSON.parse(body);
        console.log(`\n[Guide-Build] ${actionLabels?.length || 0} actions, ${pages?.length || 0} pages`);

        const prompt = `You are naming a web automation tool. Given the following info, return a JSON object with tool metadata.

Pages visited: ${JSON.stringify(pages)}
Actions performed: ${JSON.stringify(actionLabels)}
Field labels found on pages: ${JSON.stringify(capturedFieldLabels)}

Return ONLY valid JSON (no markdown, no explanation):
{
  "name": "snake_case_tool_name",
  "description": "One sentence describing what the tool does",
  "inputSchema": {
    "type": "object",
    "properties": { "param_name": { "type": "string", "description": "..." } },
    "required": ["param_name"]
  },
  "templateVariables": { "literal_id_from_url": "param_name" }
}

Rules:
- name must be snake_case
- Look at the URLs to identify Salesforce object IDs (15-18 char alphanumeric) and map them to parameter names
- description should explain the user's workflow based on the actions
- templateVariables maps literal ID values in URLs to parameter names`;

        const apiBody = JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        });

        const command = new InvokeModelCommand({
          modelId: MODEL_ID,
          body: new TextEncoder().encode(apiBody),
          contentType: 'application/json',
          accept: 'application/json',
        });

        const response = await client.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        let text = responseBody.content?.[0]?.text || '';

        // Parse JSON
        let cleaned = text.trim();
        if (cleaned.startsWith('```')) {
          cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }

        const metadata = JSON.parse(cleaned);
        console.log(`  Tool name: ${metadata.name}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(metadata));
      } catch (err) {
        console.error('Guide-build error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // ─── /save-definitions: Save YAML from builder ────────
  if (req.method === 'POST' && req.url === '/save-definitions') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const {
          appId,
          app: appDef,
          pages: pageYamls,
          tools: toolYamls,
          captureLabel,
          debug,
        } = JSON.parse(body) as {
          appId: string;
          app?: Record<string, unknown>;
          pages: string[];
          tools: string[];
          captureLabel?: string;
          debug?: Record<string, unknown>;
        };
        const { outDir: appDir, relativeDir } = resolveOutputDirectory(appId, captureLabel);
        fs.mkdirSync(path.join(appDir, 'pages'), { recursive: true });
        fs.mkdirSync(path.join(appDir, 'tools'), { recursive: true });

        const saved: string[] = [];
        const debugSaved: string[] = [];

        if (appDef) {
          const appYaml = toYaml({ app: appDef });
          const appPath = path.join(appDir, 'app.yaml');
          fs.writeFileSync(appPath, appYaml + '\n');
          saved.push(appPath);
        }

        (pageYamls as string[]).forEach((yaml: string, i: number) => {
          // Extract page id from yaml
          const idMatch = yaml.match(/id:\s*(\S+)/);
          const filename = idMatch ? `${idMatch[1]}.yaml` : `page_${i}.yaml`;
          const filePath = path.join(appDir, 'pages', filename);
          fs.writeFileSync(filePath, yaml);
          saved.push(filePath);
        });

        (toolYamls as string[]).forEach((yaml: string, i: number) => {
          const nameMatch = yaml.match(/name:\s*(\S+)/);
          const filename = nameMatch ? `${nameMatch[1]}.yaml` : `tool_${i}.yaml`;
          const filePath = path.join(appDir, 'tools', filename);
          fs.writeFileSync(filePath, yaml);
          saved.push(filePath);
        });

        if (debug) {
          const debugDir = path.join(appDir, 'debug');
          fs.mkdirSync(debugDir, { recursive: true });

          const debugBundlePath = path.join(debugDir, 'guide-session.json');
          fs.writeFileSync(debugBundlePath, `${JSON.stringify(debug, null, 2)}\n`);
          debugSaved.push(debugBundlePath);

          const actions = Array.isArray(debug.actions) ? debug.actions : [];
          const actionsPath = path.join(debugDir, 'recorded-actions.json');
          fs.writeFileSync(actionsPath, `${JSON.stringify(actions, null, 2)}\n`);
          debugSaved.push(actionsPath);

          const pageSnapshots = debug.pageSnapshots && typeof debug.pageSnapshots === 'object'
            ? debug.pageSnapshots
            : {};
          const snapshotsPath = path.join(debugDir, 'page-snapshots.json');
          fs.writeFileSync(snapshotsPath, `${JSON.stringify(pageSnapshots, null, 2)}\n`);
          debugSaved.push(snapshotsPath);
        }

        console.log(`\n[Save] Saved ${saved.length} files to ${relativeDir}/`);
        saved.forEach(f => console.log(`  -> ${path.relative(process.cwd(), f)}`));
        if (debugSaved.length > 0) {
          console.log(`[Save] Saved ${debugSaved.length} debug files to ${relativeDir}/debug/`);
          debugSaved.forEach(f => console.log(`  -> ${path.relative(process.cwd(), f)}`));
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          saved,
          debugSaved,
          savedTo: `${relativeDir}/`,
        }));
      } catch (err) {
        console.error('Save error:', err);
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

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
