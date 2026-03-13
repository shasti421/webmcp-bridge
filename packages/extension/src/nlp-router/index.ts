/**
 * NLP Router — maps natural language user commands to tool calls.
 *
 * In Execute Mode, business users type commands like "close case 12345".
 * This module sends the command + available tool schemas to an LLM API
 * and receives back a structured tool call with name and inputs.
 *
 * The router constructs a prompt that includes the user command and
 * available tool schemas, sends it to the bridge backend's NLP endpoint,
 * and parses the structured response.
 */

// ─── Types ──────────────────────────────────────────────

export interface ToolSummary {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

export interface RoutingResult {
  toolName: string;
  inputs: Record<string, unknown>;
}

export interface NlpRouterConfig {
  bridgeApiUrl: string;
}

export type NlpRouterResult =
  | { ok: true; value: RoutingResult }
  | { ok: false; error: string };

// ─── Prompt building ────────────────────────────────────

export function buildToolSelectionPrompt(
  userCommand: string,
  tools: ToolSummary[],
): string {
  const toolDescriptions = tools.map((t) => {
    const params = t.inputSchema.properties
      ? Object.entries(t.inputSchema.properties)
          .map(([name, schema]) => {
            const required = t.inputSchema.required?.includes(name) ? ' (required)' : '';
            const enumValues = schema.enum ? ` [${schema.enum.join(', ')}]` : '';
            return `    - ${name}: ${schema.type}${enumValues}${required}${schema.description ? ' — ' + schema.description : ''}`;
          })
          .join('\n')
      : '    (no parameters)';

    return `- ${t.name}: ${t.description}\n  Parameters:\n${params}`;
  }).join('\n\n');

  return `You are a web automation assistant. The user has asked:

"${userCommand}"

Available tools:
${toolDescriptions}

Analyze the user's request and determine which tool to use. Extract parameter values from the user's command.

Respond with valid JSON only:
{
  "toolName": "exact_tool_name",
  "inputs": {
    "param1": "value1"
  }
}

Only respond with valid JSON. Do not include any other text.`;
}

// ─── Response parsing ───────────────────────────────────

export function parseRouterResponse(response: string): RoutingResult | null {
  if (!response || response.trim().length === 0) {
    return null;
  }

  // Try to extract JSON from the response
  let jsonStr = response.trim();

  // Remove markdown code blocks if present
  const codeBlockMatch = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/.exec(jsonStr);
  if (codeBlockMatch?.[1]) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // Try to find JSON object in the text
  if (!jsonStr.startsWith('{')) {
    const jsonMatch = /\{[\s\S]*\}/.exec(jsonStr);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    } else {
      return null;
    }
  }

  try {
    const parsed: unknown = JSON.parse(jsonStr);

    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'toolName' in parsed &&
      'inputs' in parsed &&
      typeof (parsed as Record<string, unknown>).toolName === 'string' &&
      typeof (parsed as Record<string, unknown>).inputs === 'object'
    ) {
      return {
        toolName: (parsed as RoutingResult).toolName,
        inputs: (parsed as RoutingResult).inputs,
      };
    }

    return null;
  } catch {
    return null;
  }
}

// ─── Route user command ─────────────────────────────────

export async function routeUserCommand(
  userCommand: string,
  tools: ToolSummary[],
  config: NlpRouterConfig,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<NlpRouterResult> {
  const prompt = buildToolSelectionPrompt(userCommand, tools);

  try {
    const response = await fetchFn(`${config.bridgeApiUrl}/nlp/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, tools }),
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `NLP routing failed: ${response.status} ${response.statusText}`,
      };
    }

    const data = await response.json() as RoutingResult;

    return {
      ok: true,
      value: {
        toolName: data.toolName,
        inputs: data.inputs,
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `NLP routing error: ${message}`,
    };
  }
}
