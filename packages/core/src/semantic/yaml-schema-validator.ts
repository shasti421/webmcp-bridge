/**
 * YamlSchemaValidator — validates parsed YAML against JSON Schemas using Ajv.
 *
 * Responsibilities:
 * - Define JSON Schemas for: app.yaml, page.yaml, tool.yaml, workflow.yaml
 * - Validate parsed objects against schemas using Ajv
 * - Return structured errors with path to invalid field
 */
import Ajv from 'ajv';
import type { ErrorObject, ValidateFunction } from 'ajv';

import type { Result } from '../types/result.js';
import { ok, err } from '../types/result.js';
import type { BridgeError } from '../types/errors.js';
import { createBridgeError } from '../types/errors.js';
import type {
  AppDefinition,
  PageDefinition,
  ToolDefinition,
  WorkflowDefinition,
} from '../types/semantic-model.js';

export interface ValidationError {
  path: string;
  message: string;
  schemaPath: string;
}

// ─── Shared schema definitions ──────────────────────────

const selectorStrategySchema = {
  oneOf: [
    {
      type: 'object' as const,
      required: ['strategy', 'role'],
      additionalProperties: false,
      properties: {
        strategy: { const: 'aria' },
        role: { type: 'string' as const },
        name: { type: 'string' as const },
        confidence: { type: 'number' as const, minimum: 0, maximum: 1 },
      },
    },
    {
      type: 'object' as const,
      required: ['strategy', 'text'],
      additionalProperties: false,
      properties: {
        strategy: { const: 'label' },
        text: { type: 'string' as const },
        scope: { type: 'string' as const },
        confidence: { type: 'number' as const, minimum: 0, maximum: 1 },
      },
    },
    {
      type: 'object' as const,
      required: ['strategy', 'text'],
      additionalProperties: false,
      properties: {
        strategy: { const: 'text' },
        text: { type: 'string' as const },
        exact: { type: 'boolean' as const },
        confidence: { type: 'number' as const, minimum: 0, maximum: 1 },
      },
    },
    {
      type: 'object' as const,
      required: ['strategy', 'selector'],
      additionalProperties: false,
      properties: {
        strategy: { const: 'css' },
        selector: { type: 'string' as const },
        confidence: { type: 'number' as const, minimum: 0, maximum: 1 },
      },
    },
    {
      type: 'object' as const,
      required: ['strategy', 'expression'],
      additionalProperties: false,
      properties: {
        strategy: { const: 'js' },
        expression: { type: 'string' as const },
        confidence: { type: 'number' as const, minimum: 0, maximum: 1 },
      },
    },
  ],
};

const selectorChainSchema = {
  type: 'array' as const,
  minItems: 1,
  items: selectorStrategySchema,
};

const interactionStepSchema = {
  $id: 'InteractionStep',
  type: 'object' as const,
  required: ['action'],
  additionalProperties: false,
  properties: {
    action: {
      type: 'string' as const,
      enum: ['click', 'type', 'fill', 'select', 'check', 'clear', 'hover', 'wait'],
    },
    target: { type: 'string' as const },
    value: { type: 'string' as const },
    selector: { type: 'string' as const },
    role: { type: 'string' as const },
    name: { type: 'string' as const },
    scope: { type: 'string' as const },
    wait: { oneOf: [{ type: 'number' as const }, { type: 'string' as const }] },
    delay_ms: { type: 'integer' as const, minimum: 0 },
    fallback: { $ref: 'InteractionStep' },
    then: { type: 'array' as const, items: { $ref: 'InteractionStep' } },
    condition: { type: 'string' as const },
  },
};

const errorHandlerSchema = {
  type: 'object' as const,
  required: ['action'],
  additionalProperties: false,
  properties: {
    match: { type: 'string' as const },
    action: { type: 'string' as const, enum: ['retry', 'skip', 'escalate'] },
    params: { type: 'object' as const },
  },
};

const appSchema = {
  $id: 'AppDefinition',
  type: 'object' as const,
  required: ['id', 'name', 'base_url', 'url_patterns'],
  additionalProperties: false,
  properties: {
    id: { type: 'string' as const, minLength: 1, pattern: '^[a-z0-9_-]+$' },
    name: { type: 'string' as const, minLength: 1 },
    base_url: { type: 'string' as const, minLength: 1, format: 'uri' },
    url_patterns: {
      type: 'array' as const,
      minItems: 1,
      items: { type: 'string' as const, minLength: 1 },
    },
    version: { type: 'string' as const, pattern: '^[0-9]+(\\.[0-9]+)*$' },
    description: { type: 'string' as const },
    auth: {
      type: 'object' as const,
      additionalProperties: false,
      properties: {
        type: { type: 'string' as const, enum: ['browser_session', 'oauth', 'api_key', 'saml'] },
        login_url: { type: 'string' as const, format: 'uri' },
        session_check: { type: 'string' as const },
      },
    },
    registry: {
      type: 'object' as const,
      additionalProperties: false,
      properties: {
        publisher: { type: 'string' as const },
        tags: { type: 'array' as const, items: { type: 'string' as const } },
        license: { type: 'string' as const },
      },
    },
  },
};

const pageSchema = {
  $id: 'PageDefinition',
  type: 'object' as const,
  required: ['id', 'app', 'url_pattern', 'wait_for', 'fields', 'outputs'],
  additionalProperties: false,
  properties: {
    id: { type: 'string' as const, minLength: 1, pattern: '^[a-z0-9_-]+$' },
    app: { type: 'string' as const, minLength: 1 },
    url_pattern: { type: 'string' as const, minLength: 1 },
    url_template: { type: 'string' as const },
    wait_for: { type: 'string' as const, minLength: 1 },
    tab: { type: 'string' as const },
    fields: {
      type: 'array' as const,
      minItems: 2,
      items: {
        type: 'object' as const,
        required: ['id', 'label', 'type', 'selectors', 'interaction'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' as const, minLength: 1, pattern: '^[a-z0-9_-]+$' },
          label: { type: 'string' as const, minLength: 1 },
          type: {
            type: 'string' as const,
            enum: [
              'text', 'picklist', 'lookup', 'checkbox', 'date', 'datetime',
              'number', 'textarea', 'file', 'owner_change', 'action_button',
              'radio', 'toggle', 'rich_text', 'color', 'range',
            ],
          },
          options: { type: 'array' as const, items: { type: 'string' as const } },
          depends_on: { type: 'string' as const },
          selectors: selectorChainSchema,
          interaction: {
            type: 'object' as const,
            required: ['type'],
            additionalProperties: false,
            properties: {
              type: {
                type: 'string' as const,
                enum: ['fill', 'click', 'select', 'check', 'multiselect', 'custom', 'text_input', 'type'],
              },
              pattern: { type: 'string' as const },
              steps: {
                type: 'array' as const,
                items: { $ref: 'InteractionStep' },
              },
              on_error: errorHandlerSchema,
            },
          },
        },
      },
    },
    outputs: {
      type: 'array' as const,
      minItems: 1,
      items: {
        type: 'object' as const,
        required: ['id', 'label', 'selectors'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' as const, minLength: 1, pattern: '^[a-z0-9_-]+$' },
          label: { type: 'string' as const, minLength: 1 },
          selectors: selectorChainSchema,
          capture_strategies: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              required: ['type', 'selectors'],
              additionalProperties: false,
              properties: {
                type: { type: 'string' as const, enum: ['text_content', 'pattern_match', 'attribute', 'table'] },
                selectors: selectorChainSchema,
                pattern: { type: 'string' as const },
                group: { type: 'integer' as const, minimum: 0 },
                attribute: { type: 'string' as const },
              },
            },
          },
          transient: { type: 'boolean' as const },
          wait_timeout: { type: 'string' as const, pattern: '^[0-9]+(ms|s)$' },
          retry: { type: 'integer' as const, minimum: 0 },
          capture_on: { type: 'string' as const, enum: ['success', 'failure', 'always'] },
        },
      },
    },
    overlays: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        required: ['id', 'trigger', 'dismiss'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' as const, minLength: 1 },
          trigger: { type: 'string' as const },
          dismiss: {
            type: 'array' as const,
            minItems: 1,
            items: {
              type: 'object' as const,
              required: ['strategy'],
              additionalProperties: false,
              properties: {
                strategy: { type: 'string' as const, enum: ['click_close', 'press_escape', 'remove_element', 'click_text'] },
                selector: { type: 'string' as const },
                text: { type: 'array' as const, items: { type: 'string' as const } },
                wait_after: { type: 'integer' as const, minimum: 0 },
              },
            },
          },
        },
      },
    },
  },
};

const jsonSchemaPropertySchema = {
  $id: 'JsonSchemaProperty',
  type: 'object' as const,
  required: ['type'],
  additionalProperties: false,
  properties: {
    type: { type: 'string' as const, enum: ['object', 'string', 'number', 'integer', 'boolean', 'array'] },
    description: { type: 'string' as const },
    enum: { type: 'array' as const, items: { type: 'string' as const } },
    items: { $ref: 'JsonSchemaInTool' },
  },
};

const jsonSchemaSchema = {
  $id: 'JsonSchemaInTool',
  type: 'object' as const,
  required: ['type'],
  additionalProperties: false,
  properties: {
    type: { type: 'string' as const, enum: ['object', 'string', 'number', 'integer', 'boolean', 'array', 'null'] },
    properties: {
      type: 'object' as const,
      additionalProperties: { $ref: 'JsonSchemaProperty' },
    },
    items: { $ref: 'JsonSchemaInTool' },
    required: { type: 'array' as const, items: { type: 'string' as const } },
    description: { type: 'string' as const },
  },
};

const toolStepSchema = {
  oneOf: [
    {
      type: 'object' as const, required: ['navigate'], additionalProperties: false,
      properties: {
        navigate: {
          type: 'object' as const, required: ['page'], additionalProperties: false,
          properties: {
            page: { type: 'string' as const },
            params: { type: 'object' as const, additionalProperties: { type: 'string' as const } },
          },
        },
        condition: { type: 'string' as const },
      },
    },
    {
      type: 'object' as const, required: ['interact'], additionalProperties: false,
      properties: {
        interact: {
          type: 'object' as const, additionalProperties: false,
          properties: {
            field: { type: 'string' as const },
            action: { type: 'string' as const },
            value: { type: 'string' as const },
            target: { type: 'string' as const },
            dispatch: {
              type: 'array' as const,
              items: {
                type: 'object' as const, required: ['event'], additionalProperties: false,
                properties: { event: { type: 'string' as const }, bubbles: { type: 'boolean' as const } },
              },
            },
            retry: {
              type: 'object' as const, additionalProperties: false,
              properties: {
                attempts: { type: 'integer' as const, minimum: 1 },
                backoff_ms: { type: 'integer' as const, minimum: 0 },
                screenshot_on_failure: { type: 'boolean' as const },
                on_exhausted: { type: 'string' as const, enum: ['escalate', 'fail', 'skip'] },
              },
            },
          },
        },
        condition: { type: 'string' as const },
      },
    },
    {
      type: 'object' as const, required: ['capture'], additionalProperties: false,
      properties: {
        capture: {
          type: 'object' as const, required: ['from', 'store_as'], additionalProperties: false,
          properties: {
            from: { type: 'string' as const }, store_as: { type: 'string' as const },
            wait: { type: 'boolean' as const }, on_failure: { type: 'boolean' as const },
          },
        },
      },
    },
    {
      type: 'object' as const, required: ['wait'], additionalProperties: false,
      properties: { wait: { oneOf: [{ type: 'number' as const }, { type: 'string' as const }] } },
    },
    {
      type: 'object' as const, required: ['tab'], additionalProperties: false,
      properties: { tab: { type: 'string' as const } },
    },
    {
      type: 'object' as const, required: ['auth'], additionalProperties: false,
      properties: { auth: { type: 'string' as const } },
    },
    {
      type: 'object' as const, required: ['evaluate_js'], additionalProperties: false,
      properties: { evaluate_js: { type: 'string' as const } },
    },
  ],
};

const toolSchema = {
  $id: 'ToolDefinition',
  type: 'object' as const,
  required: ['name', 'description', 'inputSchema', 'bridge'],
  additionalProperties: false,
  properties: {
    name: { type: 'string' as const, minLength: 1, pattern: '^[a-z0-9_]+$' },
    description: { type: 'string' as const, minLength: 1 },
    inputSchema: { $ref: 'JsonSchemaInTool' },
    outputSchema: { $ref: 'JsonSchemaInTool' },
    bridge: {
      type: 'object' as const, required: ['page', 'steps'], additionalProperties: false,
      properties: {
        page: { type: 'string' as const, minLength: 1 },
        steps: { type: 'array' as const, minItems: 1, items: toolStepSchema },
        returns: { type: 'object' as const, additionalProperties: { type: 'string' as const } },
      },
    },
  },
};

const workflowParamSchema = {
  type: 'object' as const, required: ['type'], additionalProperties: false,
  properties: {
    type: { type: 'string' as const, enum: ['string', 'number', 'integer', 'boolean', 'array', 'object'] },
    required: { type: 'boolean' as const },
    description: { type: 'string' as const },
  },
};

const workflowStepSchema = {
  $id: 'WorkflowStep',
  oneOf: [
    {
      type: 'object' as const, required: ['tool'], additionalProperties: false,
      properties: {
        tool: { type: 'string' as const }, app: { type: 'string' as const },
        params: { type: 'object' as const, additionalProperties: { type: 'string' as const } },
        capture: { type: 'object' as const, additionalProperties: { type: 'string' as const } },
        on_empty: { type: 'string' as const },
        on_error: { oneOf: [{ type: 'string' as const }, { $ref: 'WorkflowStep' }] },
        confirm: { type: 'boolean' as const },
      },
    },
    {
      type: 'object' as const, required: ['for_each'], additionalProperties: false,
      properties: {
        for_each: { type: 'string' as const }, as: { type: 'string' as const },
        on_error: { type: 'string' as const, enum: ['continue', 'stop'] },
        steps: { type: 'array' as const, minItems: 1, items: { $ref: 'WorkflowStep' } },
      },
    },
    {
      type: 'object' as const, required: ['aggregate'], additionalProperties: false,
      properties: {
        aggregate: { type: 'object' as const, additionalProperties: { type: 'string' as const } },
      },
    },
  ],
};

const workflowSchema = {
  $id: 'WorkflowDefinition',
  type: 'object' as const,
  required: ['name', 'description', 'input', 'steps'],
  additionalProperties: false,
  properties: {
    name: { type: 'string' as const, minLength: 1, pattern: '^[a-z0-9_]+$' },
    description: { type: 'string' as const, minLength: 1 },
    input: { type: 'object' as const, minProperties: 1, additionalProperties: workflowParamSchema },
    output: { type: 'object' as const, additionalProperties: workflowParamSchema },
    steps: { type: 'array' as const, minItems: 1, items: { $ref: 'WorkflowStep' } },
  },
};

// ─── Validator Class ────────────────────────────────────

export class YamlSchemaValidator {
  private readonly ajv: Ajv;
  private readonly appValidate: ValidateFunction;
  private readonly pageValidate: ValidateFunction;
  private readonly toolValidate: ValidateFunction;
  private readonly workflowValidate: ValidateFunction;

  constructor() {
    this.ajv = new Ajv({
      allErrors: true,
      useDefaults: false,
      removeAdditional: false,
      strict: 'log',
    });

    this.ajv.addFormat('uri', {
      type: 'string',
      validate: (x: string) => /^https?:\/\//.test(x),
    });

    this.ajv.addSchema(interactionStepSchema);
    this.ajv.addSchema(jsonSchemaPropertySchema);
    this.ajv.addSchema(jsonSchemaSchema);
    this.ajv.addSchema(workflowStepSchema);

    this.appValidate = this.ajv.compile(appSchema);
    this.pageValidate = this.ajv.compile(pageSchema);
    this.toolValidate = this.ajv.compile(toolSchema);
    this.workflowValidate = this.ajv.compile(workflowSchema);
  }

  validateApp(data: unknown): Result<AppDefinition, BridgeError> {
    return this.runValidation<AppDefinition>(this.appValidate, data);
  }

  validatePage(data: unknown): Result<PageDefinition, BridgeError> {
    return this.runValidation<PageDefinition>(this.pageValidate, data);
  }

  validateTool(data: unknown): Result<ToolDefinition, BridgeError> {
    return this.runValidation<ToolDefinition>(this.toolValidate, data);
  }

  validateWorkflow(data: unknown): Result<WorkflowDefinition, BridgeError> {
    return this.runValidation<WorkflowDefinition>(this.workflowValidate, data);
  }

  private runValidation<T>(validateFn: ValidateFunction, data: unknown): Result<T, BridgeError> {
    const isValid = validateFn(data);
    if (isValid) {
      return ok(data as T);
    }
    const errors = validateFn.errors ?? [];
    return err(this.buildValidationError(errors));
  }

  private buildValidationError(ajvErrors: ErrorObject[]): BridgeError {
    const errorMessages: string[] = [];

    for (const error of ajvErrors) {
      const path = error.instancePath || 'root';
      const keyword = error.keyword;

      if (keyword === 'required') {
        const missingField = (error.params as Record<string, unknown>)['missingProperty'] as string;
        errorMessages.push(`Missing required field: ${missingField}`);
      } else if (keyword === 'type') {
        const expected = (error.params as Record<string, unknown>)['type'] as string;
        errorMessages.push(`At ${path}: expected type ${expected}`);
      } else if (keyword === 'enum') {
        const allowed = (error.params as Record<string, unknown>)['allowedValues'] as string[];
        errorMessages.push(`At ${path}: must be one of [${allowed.join(', ')}]`);
      } else if (keyword === 'minItems') {
        const min = (error.params as Record<string, unknown>)['limit'] as number;
        errorMessages.push(`At ${path}: must have at least ${min} items`);
      } else if (keyword === 'minProperties') {
        const min = (error.params as Record<string, unknown>)['limit'] as number;
        errorMessages.push(`At ${path}: must have at least ${min} properties`);
      } else if (keyword === 'pattern') {
        errorMessages.push(`At ${path}: must match pattern ${error.message ?? ''}`);
      } else if (keyword === 'additionalProperties') {
        const additional = (error.params as Record<string, unknown>)['additionalProperty'] as string;
        errorMessages.push(`At ${path}: unknown property "${additional}"`);
      } else if (keyword === 'format') {
        const format = (error.params as Record<string, unknown>)['format'] as string;
        errorMessages.push(`At ${path}: must match format "${format}"`);
      } else if (keyword === 'oneOf') {
        continue;
      } else {
        const msg = error.message ?? keyword;
        errorMessages.push(`At ${path}: ${msg}`);
      }
    }

    const unique = [...new Set(errorMessages)];
    const message = unique.length > 0 ? unique.join('; ') : 'Unknown validation error';

    return createBridgeError(
      'SCHEMA_VALIDATION_ERROR',
      message,
      'semantic',
      { cause: ajvErrors },
    );
  }
}
