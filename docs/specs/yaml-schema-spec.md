# YAML Schema Specification

## Purpose

The YamlSchemaValidator validates all YAML documents against strict JSON schemas before they are indexed. It ensures that YAML structure, required fields, and field types are correct. All validation uses the AJV library (JSON Schema validator for JavaScript).

**Key responsibilities:**
- Validate AppDefinition YAML
- Validate PageDefinition YAML
- Validate ToolDefinition YAML
- Validate WorkflowDefinition YAML
- Return structured ValidationError[] with paths and messages
- Support strict mode (fail on unknown fields)

## Data Structures

```typescript
// ─── Validator Class ─────────────────────────────────────

class YamlSchemaValidator {
  private validator: AjvInstance;

  constructor()

  validateApp(data: unknown): Result<AppDefinition, BridgeError>
  validatePage(data: unknown): Result<PageDefinition, BridgeError>
  validateTool(data: unknown): Result<ToolDefinition, BridgeError>
  validateWorkflow(data: unknown): Result<WorkflowDefinition, BridgeError>

  private buildValidationError(ajvErrors: ErrorObject[]): BridgeError
}

// ─── Internal: AJV Error format ──────────────────────────

interface AjvError {
  instancePath: string;     // e.g., "/fields/0/selectors"
  schemaPath: string;       // e.g., "#/properties/fields/items/required/0"
  keyword: string;          // e.g., "required", "type"
  params: Record<string, unknown>;
  message: string;
}
```

## JSON Schemas

### 1. AppDefinition Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "title": "Application Definition",
  "required": ["id", "name", "base_url", "url_patterns"],
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "minLength": 1,
      "pattern": "^[a-z0-9_-]+$",
      "description": "Unique application identifier (lowercase, no spaces)"
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "description": "Human-readable app name"
    },
    "base_url": {
      "type": "string",
      "minLength": 1,
      "format": "uri",
      "description": "Root URL of the application"
    },
    "url_patterns": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "string",
        "minLength": 1,
        "description": "URL pattern (e.g. /path/{id}/view or /api/*)"
      },
      "description": "Supported URL patterns for pages"
    },
    "version": {
      "type": "string",
      "pattern": "^[0-9]+(\\.[0-9]+)*$",
      "description": "Semantic version (optional)"
    },
    "description": {
      "type": "string",
      "description": "App description (optional)"
    },
    "auth": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "type": {
          "type": "string",
          "enum": ["browser_session", "oauth", "api_key", "saml"]
        },
        "login_url": {
          "type": "string",
          "format": "uri"
        },
        "session_check": {
          "type": "string"
        }
      },
      "description": "Authentication config (optional)"
    },
    "registry": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "publisher": { "type": "string" },
        "tags": {
          "type": "array",
          "items": { "type": "string" }
        },
        "license": { "type": "string" }
      },
      "description": "Registry metadata (optional)"
    }
  }
}
```

### 2. PageDefinition Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "title": "Page Definition",
  "required": ["id", "app", "url_pattern", "wait_for", "fields", "outputs"],
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "minLength": 1,
      "pattern": "^[a-z0-9_-]+$",
      "description": "Unique page identifier within app"
    },
    "app": {
      "type": "string",
      "minLength": 1,
      "description": "Reference to AppDefinition.id"
    },
    "url_pattern": {
      "type": "string",
      "minLength": 1,
      "description": "URL pattern to match this page"
    },
    "url_template": {
      "type": "string",
      "description": "Template for constructing URLs (optional, e.g. /users/{userId})"
    },
    "wait_for": {
      "type": "string",
      "minLength": 1,
      "description": "CSS selector or network condition to wait for page readiness"
    },
    "tab": {
      "type": "string",
      "description": "Named tab identifier (optional)"
    },
    "fields": {
      "type": "array",
      "minItems": 2,
      "items": {
        "$ref": "#/definitions/FieldDefinition"
      },
      "description": "Editable fields on this page (minimum 2)"
    },
    "outputs": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/definitions/OutputDefinition"
      },
      "description": "Capturable outputs from this page"
    },
    "overlays": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/OverlayDefinition"
      },
      "description": "Dialog/overlay definitions (optional)"
    }
  },
  "definitions": {
    "FieldDefinition": {
      "type": "object",
      "required": ["id", "label", "type", "selectors", "interaction"],
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1,
          "pattern": "^[a-z0-9_-]+$"
        },
        "label": {
          "type": "string",
          "minLength": 1,
          "description": "UI label for this field"
        },
        "type": {
          "type": "string",
          "enum": [
            "text", "picklist", "lookup", "checkbox", "date", "datetime",
            "number", "textarea", "file", "owner_change", "action_button",
            "radio", "toggle", "rich_text", "color", "range"
          ]
        },
        "options": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Picklist/radio options (optional)"
        },
        "depends_on": {
          "type": "string",
          "description": "Field ID this field depends on (optional)"
        },
        "selectors": {
          "$ref": "#/definitions/SelectorChain",
          "description": "How to find this field element"
        },
        "interaction": {
          "$ref": "#/definitions/InteractionDefinition"
        }
      }
    },
    "OutputDefinition": {
      "type": "object",
      "required": ["id", "label", "selectors"],
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1,
          "pattern": "^[a-z0-9_-]+$"
        },
        "label": {
          "type": "string",
          "minLength": 1
        },
        "selectors": {
          "$ref": "#/definitions/SelectorChain"
        },
        "capture_strategies": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/CaptureStrategy"
          },
          "description": "How to capture this output (optional)"
        },
        "transient": {
          "type": "boolean",
          "description": "If true, poll for this output (optional)"
        },
        "wait_timeout": {
          "type": "string",
          "pattern": "^[0-9]+(ms|s)$",
          "description": "Timeout for transient polling (optional, e.g. 5s)"
        },
        "retry": {
          "type": "integer",
          "minimum": 0,
          "description": "Number of retries (optional)"
        },
        "capture_on": {
          "type": "string",
          "enum": ["success", "failure", "always"],
          "description": "When to capture (optional, default: success)"
        }
      }
    },
    "CaptureStrategy": {
      "type": "object",
      "required": ["type", "selectors"],
      "additionalProperties": false,
      "properties": {
        "type": {
          "type": "string",
          "enum": ["text_content", "pattern_match", "attribute", "table"]
        },
        "selectors": {
          "$ref": "#/definitions/SelectorChain"
        },
        "pattern": {
          "type": "string",
          "description": "Regex pattern for pattern_match strategy"
        },
        "group": {
          "type": "integer",
          "minimum": 0,
          "description": "Regex group index (optional)"
        },
        "attribute": {
          "type": "string",
          "description": "Attribute name for attribute strategy"
        }
      }
    },
    "OverlayDefinition": {
      "type": "object",
      "required": ["id", "trigger", "dismiss"],
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1
        },
        "trigger": {
          "type": "string",
          "description": "CSS selector that triggers overlay detection"
        },
        "dismiss": {
          "type": "array",
          "minItems": 1,
          "items": {
            "$ref": "#/definitions/OverlayDismiss"
          }
        }
      }
    },
    "OverlayDismiss": {
      "type": "object",
      "required": ["strategy"],
      "additionalProperties": false,
      "properties": {
        "strategy": {
          "type": "string",
          "enum": ["click_close", "press_escape", "remove_element", "click_text"]
        },
        "selector": {
          "type": "string"
        },
        "text": {
          "type": "array",
          "items": { "type": "string" }
        },
        "wait_after": {
          "type": "integer",
          "minimum": 0,
          "description": "Milliseconds to wait after dismiss"
        }
      }
    },
    "InteractionDefinition": {
      "type": "object",
      "required": ["type"],
      "additionalProperties": false,
      "properties": {
        "type": {
          "type": "string",
          "enum": ["fill", "click", "select", "check", "multiselect", "custom"]
        },
        "pattern": {
          "type": "string",
          "description": "Pattern name reference (optional)"
        },
        "steps": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/InteractionStep"
          },
          "description": "Custom steps (optional)"
        },
        "on_error": {
          "$ref": "#/definitions/ErrorHandler",
          "description": "Error handling (optional)"
        }
      }
    },
    "InteractionStep": {
      "type": "object",
      "required": ["action"],
      "additionalProperties": false,
      "properties": {
        "action": {
          "type": "string",
          "enum": ["click", "type", "select", "check", "clear", "hover", "wait"]
        },
        "target": { "type": "string" },
        "value": { "type": "string" },
        "selector": { "type": "string" },
        "role": { "type": "string" },
        "name": { "type": "string" },
        "scope": { "type": "string" },
        "wait": { "oneOf": [{ "type": "number" }, { "type": "string" }] },
        "delay_ms": { "type": "integer", "minimum": 0 },
        "fallback": { "$ref": "#/definitions/InteractionStep" },
        "then": {
          "type": "array",
          "items": { "$ref": "#/definitions/InteractionStep" }
        },
        "condition": { "type": "string" }
      }
    },
    "ErrorHandler": {
      "type": "object",
      "required": ["action"],
      "additionalProperties": false,
      "properties": {
        "match": {
          "type": "string",
          "description": "Error pattern to match"
        },
        "action": {
          "type": "string",
          "enum": ["retry", "skip", "escalate"]
        },
        "params": {
          "type": "object"
        }
      }
    },
    "SelectorChain": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/definitions/SelectorStrategy"
      }
    },
    "SelectorStrategy": {
      "oneOf": [
        {
          "type": "object",
          "required": ["strategy", "role"],
          "additionalProperties": false,
          "properties": {
            "strategy": { "const": "aria" },
            "role": { "type": "string" },
            "name": { "type": "string" },
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
          }
        },
        {
          "type": "object",
          "required": ["strategy", "text"],
          "additionalProperties": false,
          "properties": {
            "strategy": { "const": "label" },
            "text": { "type": "string" },
            "scope": { "type": "string" },
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
          }
        },
        {
          "type": "object",
          "required": ["strategy", "text"],
          "additionalProperties": false,
          "properties": {
            "strategy": { "const": "text" },
            "text": { "type": "string" },
            "exact": { "type": "boolean" },
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
          }
        },
        {
          "type": "object",
          "required": ["strategy", "selector"],
          "additionalProperties": false,
          "properties": {
            "strategy": { "const": "css" },
            "selector": { "type": "string" },
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
          }
        },
        {
          "type": "object",
          "required": ["strategy", "expression"],
          "additionalProperties": false,
          "properties": {
            "strategy": { "const": "js" },
            "expression": { "type": "string" },
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
          }
        }
      ]
    }
  }
}
```

### 3. ToolDefinition Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "title": "Tool Definition",
  "required": ["name", "description", "inputSchema", "bridge"],
  "additionalProperties": false,
  "properties": {
    "name": {
      "type": "string",
      "minLength": 1,
      "pattern": "^[a-z0-9_]+$",
      "description": "Unique tool name (lowercase, no spaces)"
    },
    "description": {
      "type": "string",
      "minLength": 1
    },
    "inputSchema": {
      "$ref": "#/definitions/JsonSchema",
      "description": "Input parameter schema"
    },
    "outputSchema": {
      "$ref": "#/definitions/JsonSchema",
      "description": "Output schema (optional)"
    },
    "bridge": {
      "type": "object",
      "required": ["page", "steps"],
      "additionalProperties": false,
      "properties": {
        "page": {
          "type": "string",
          "minLength": 1,
          "description": "Reference to PageDefinition.id"
        },
        "steps": {
          "type": "array",
          "minItems": 1,
          "items": {
            "$ref": "#/definitions/ToolStep"
          }
        },
        "returns": {
          "type": "object",
          "additionalProperties": { "type": "string" },
          "description": "Output mapping (optional)"
        }
      }
    }
  },
  "definitions": {
    "JsonSchema": {
      "type": "object",
      "required": ["type"],
      "additionalProperties": false,
      "properties": {
        "type": {
          "type": "string",
          "enum": ["object", "string", "number", "integer", "boolean", "array", "null"]
        },
        "properties": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/definitions/JsonSchemaProperty"
          }
        },
        "items": {
          "$ref": "#/definitions/JsonSchema"
        },
        "required": {
          "type": "array",
          "items": { "type": "string" }
        },
        "description": {
          "type": "string"
        }
      }
    },
    "JsonSchemaProperty": {
      "type": "object",
      "required": ["type"],
      "additionalProperties": false,
      "properties": {
        "type": {
          "type": "string",
          "enum": ["object", "string", "number", "integer", "boolean", "array"]
        },
        "description": { "type": "string" },
        "enum": {
          "type": "array",
          "items": { "type": "string" }
        },
        "items": {
          "$ref": "#/definitions/JsonSchema"
        }
      }
    },
    "ToolStep": {
      "oneOf": [
        {
          "type": "object",
          "required": ["navigate"],
          "additionalProperties": false,
          "properties": {
            "navigate": {
              "type": "object",
              "required": ["page"],
              "additionalProperties": false,
              "properties": {
                "page": { "type": "string" },
                "params": {
                  "type": "object",
                  "additionalProperties": { "type": "string" }
                }
              }
            },
            "condition": { "type": "string" }
          }
        },
        {
          "type": "object",
          "required": ["interact"],
          "additionalProperties": false,
          "properties": {
            "interact": {
              "type": "object",
              "required": ["field"],
              "additionalProperties": false,
              "properties": {
                "field": { "type": "string" },
                "action": { "type": "string" },
                "value": { "type": "string" },
                "target": { "type": "string" },
                "dispatch": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": ["event"],
                    "additionalProperties": false,
                    "properties": {
                      "event": { "type": "string" },
                      "bubbles": { "type": "boolean" }
                    }
                  }
                },
                "retry": {
                  "type": "object",
                  "additionalProperties": false,
                  "properties": {
                    "attempts": { "type": "integer", "minimum": 1 },
                    "backoff_ms": { "type": "integer", "minimum": 0 },
                    "screenshot_on_failure": { "type": "boolean" },
                    "on_exhausted": {
                      "type": "string",
                      "enum": ["escalate", "fail", "skip"]
                    }
                  }
                }
              }
            },
            "condition": { "type": "string" }
          }
        },
        {
          "type": "object",
          "required": ["capture"],
          "additionalProperties": false,
          "properties": {
            "capture": {
              "type": "object",
              "required": ["from", "store_as"],
              "additionalProperties": false,
              "properties": {
                "from": { "type": "string" },
                "store_as": { "type": "string" },
                "wait": { "type": "boolean" },
                "on_failure": { "type": "boolean" }
              }
            }
          }
        },
        {
          "type": "object",
          "required": ["wait"],
          "additionalProperties": false,
          "properties": {
            "wait": { "oneOf": [{ "type": "number" }, { "type": "string" }] }
          }
        },
        {
          "type": "object",
          "required": ["tab"],
          "additionalProperties": false,
          "properties": {
            "tab": { "type": "string" }
          }
        },
        {
          "type": "object",
          "required": ["auth"],
          "additionalProperties": false,
          "properties": {
            "auth": { "type": "string" }
          }
        },
        {
          "type": "object",
          "required": ["evaluate_js"],
          "additionalProperties": false,
          "properties": {
            "evaluate_js": { "type": "string" }
          }
        }
      ]
    }
  }
}
```

### 4. WorkflowDefinition Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "title": "Workflow Definition",
  "required": ["name", "description", "input", "steps"],
  "additionalProperties": false,
  "properties": {
    "name": {
      "type": "string",
      "minLength": 1,
      "pattern": "^[a-z0-9_]+$"
    },
    "description": {
      "type": "string",
      "minLength": 1
    },
    "input": {
      "type": "object",
      "minProperties": 1,
      "additionalProperties": {
        "$ref": "#/definitions/WorkflowParam"
      }
    },
    "output": {
      "type": "object",
      "additionalProperties": {
        "$ref": "#/definitions/WorkflowParam"
      },
      "description": "Output schema (optional)"
    },
    "steps": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/definitions/WorkflowStep"
      }
    }
  },
  "definitions": {
    "WorkflowParam": {
      "type": "object",
      "required": ["type"],
      "additionalProperties": false,
      "properties": {
        "type": {
          "type": "string",
          "enum": ["string", "number", "integer", "boolean", "array", "object"]
        },
        "required": {
          "type": "boolean"
        },
        "description": {
          "type": "string"
        }
      }
    },
    "WorkflowStep": {
      "oneOf": [
        {
          "type": "object",
          "required": ["tool"],
          "additionalProperties": false,
          "properties": {
            "tool": { "type": "string" },
            "app": { "type": "string" },
            "params": {
              "type": "object",
              "additionalProperties": { "type": "string" }
            },
            "capture": {
              "type": "object",
              "additionalProperties": { "type": "string" }
            },
            "on_empty": { "type": "string" },
            "on_error": {
              "oneOf": [
                { "type": "string" },
                { "$ref": "#/definitions/WorkflowStep" }
              ]
            },
            "confirm": { "type": "boolean" }
          }
        },
        {
          "type": "object",
          "required": ["for_each"],
          "additionalProperties": false,
          "properties": {
            "for_each": { "type": "string" },
            "as": { "type": "string" },
            "on_error": {
              "type": "string",
              "enum": ["continue", "stop"]
            },
            "steps": {
              "type": "array",
              "minItems": 1,
              "items": {
                "$ref": "#/definitions/WorkflowStep"
              }
            }
          }
        },
        {
          "type": "object",
          "required": ["aggregate"],
          "additionalProperties": false,
          "properties": {
            "aggregate": {
              "type": "object",
              "additionalProperties": { "type": "string" }
            }
          }
        }
      ]
    }
  }
}
```

## Algorithm: Validation Flow

**Inputs:**
- `data: unknown` — parsed YAML data
- `schema: JsonSchema` — the appropriate JSON schema (app, page, tool, or workflow)

**Outputs:**
- `Result<T, BridgeError>` — ok(data as T) if valid, err(SCHEMA_VALIDATION_ERROR) if invalid

**Pseudocode:**

```
function validateSchema(data: unknown, schema: JsonSchema):
  // Compile schema with AJV if not cached
  validate = ajvInstance.compile(schema)

  // Run validation
  isValid = validate(data)

  if isValid:
    return ok(data as T)

  // Collect errors
  errors = validate.errors or []

  // Build human-readable error message
  errorMessages = []
  for each error in errors:
    path = error.instancePath or 'root'
    keyword = error.keyword
    message = error.message

    if keyword == 'required':
      missingField = error.params.missingProperty
      errorMessages.append(`Missing required field: ${missingField}`)

    else if keyword == 'type':
      expected = error.params.type
      errorMessages.append(`At ${path}: expected type ${expected}, got ${typeof data[path]}`)

    else if keyword == 'enum':
      allowed = error.params.allowedValues
      errorMessages.append(`At ${path}: must be one of [${allowed.join(', ')}]`)

    else if keyword == 'minItems':
      min = error.params.limit
      errorMessages.append(`At ${path}: must have at least ${min} items`)

    else:
      errorMessages.append(`At ${path}: ${message}`)

  return err(BridgeError{
    code: 'SCHEMA_VALIDATION_ERROR',
    message: errorMessages.join('; '),
    source: 'semantic'
  })
```

## Error Handling

**Error code:** `SCHEMA_VALIDATION_ERROR`

**Error format:**
```typescript
BridgeError {
  code: 'SCHEMA_VALIDATION_ERROR',
  message: 'Semi-colon-separated list of validation failures',
  source: 'semantic',
  cause: AjvError[] (AJV error array)
}
```

**Message examples:**
- "Missing required field: wait_for"
- "At /fields/0/selectors: must have at least 1 items; At /outputs: must have at least 1 items"
- "At /url_patterns: expected type array, got string"

## Implementation Notes

### AJV Configuration

```typescript
const ajv = new Ajv({
  allErrors: true,           // Collect ALL errors, not just first
  useDefaults: false,        // Don't auto-fill defaults
  removeAdditional: false,   // Don't remove extra properties (report them)
  strict: 'log'              // Warn on unknown keywords
});

// Add format validators
ajv.addFormat('uri', { validate: (x) => /^https?:\/\//.test(x) });
```

### Field Constraints

**Fields must have minimum 2 selectors/strategies:**
- A PageDefinition.fields array must have at least 2 FieldDefinitions
- Each FieldDefinition.selectors must have at least 1 strategy
- This ensures the page is not trivial and requires real multi-field interaction

**Pattern validation:**
- AppDefinition.id, PageDefinition.id, ToolDefinition.name: lowercase with hyphens/underscores only (regex: `^[a-z0-9_-]+$`)
- ToolDefinition.name must be unique across all tools
- WorkflowDefinition.name must be unique across all workflows

## Edge Cases

1. **Extra fields in YAML:** If `additionalProperties: false`, extra fields are flagged as errors. This is intentional to catch typos.

2. **Null/undefined values:** JSON Schema treats null as a type. To allow null, use `"type": ["string", "null"]`.

3. **Nested references:** For SelectorChain and InteractionStep, we use `oneOf` with `discriminator` patterns (e.g., strategy field). Validate that each strategy has exactly the required fields.

4. **Circular references in steps:** JSON Schema cannot detect circular references. The execution engine will detect and fail.

5. **Version format:** Semantic versioning (1.0.0, 1.2.3-beta) is validated by regex.

## Test Scenarios

### 1. Valid app.yaml
**Input:** All required fields present, correct types, valid URL format.
**Expected:** ok(AppDefinition)

### 2. Missing required field in app.yaml
**Input:** Missing `url_patterns` field.
**Expected:** err(SCHEMA_VALIDATION_ERROR) with message containing "Missing required field: url_patterns"

### 3. Invalid field type in app.yaml
**Input:** `url_patterns: "/path"` (string instead of array)
**Expected:** err(SCHEMA_VALIDATION_ERROR) with message containing "expected type array"

### 4. Invalid URL format in base_url
**Input:** `base_url: "not-a-url"`
**Expected:** err(SCHEMA_VALIDATION_ERROR) mentioning format validation

### 5. PageDefinition with only 1 field
**Input:** `fields: [{ ... }]` (array length 1)
**Expected:** err(SCHEMA_VALIDATION_ERROR) with message "must have at least 2 items"

### 6. Field with empty selectors
**Input:** `selectors: []`
**Expected:** err(SCHEMA_VALIDATION_ERROR) with message "must have at least 1 items"

### 7. Invalid selector strategy
**Input:** `selectors: [{ strategy: "invalid", ... }]`
**Expected:** err(SCHEMA_VALIDATION_ERROR)

### 8. OutputDefinition without capture_strategies
**Input:** Output with only `id`, `label`, `selectors` (no capture_strategies).
**Expected:** ok(PageDefinition) — capture_strategies is optional, default to text_content

### 9. Valid ToolDefinition
**Input:** All required fields, valid inputSchema and bridge.
**Expected:** ok(ToolDefinition)

### 10. Tool with invalid page reference
**Input:** `bridge.page: "nonexistent"` — reference to page that doesn't exist.
**Expected:** ok(ToolDefinition) at validation stage (SemanticStore will validate references later)

### 11. Valid WorkflowDefinition
**Input:** All required fields, valid input/steps.
**Expected:** ok(WorkflowDefinition)

### 12. Workflow with no steps
**Input:** `steps: []`
**Expected:** err(SCHEMA_VALIDATION_ERROR) with message "must have at least 1 items"

### 13. Extra fields in YAML
**Input:** `{ id: "app", name: "My App", ..., unknown_field: "value" }`
**Expected:** err(SCHEMA_VALIDATION_ERROR) mentioning "additionalProperties"

### 14. Multiple validation errors
**Input:** Missing `wait_for`, fields.length=1, outputs.length=0
**Expected:** err(SCHEMA_VALIDATION_ERROR) with message listing all three errors separated by semicolons

### 15. Invalid pattern ID
**Input:** `id: "MyPage"` (contains uppercase)
**Expected:** err(SCHEMA_VALIDATION_ERROR) mentioning pattern constraint

### 16. InteractionStep with invalid action
**Input:** `{ action: "invalid_action" }`
**Expected:** err(SCHEMA_VALIDATION_ERROR)
