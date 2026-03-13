# TemplateRenderer Specification

## Purpose

The TemplateRenderer processes template strings containing variable references and expressions. It enables dynamic URL construction, parameter passing, and conditional branching throughout the execution pipeline. Templates are lightweight mustache-style syntax with support for nested property access and array indexing.

**Key responsibilities:**
- Find and replace template expressions `{{...}}`
- Resolve nested object properties (e.g., `{{user.profile.name}}`)
- Access array elements (e.g., `{{items[0].id}}`)
- Recursively render objects (walk object graph and render all strings)
- Evaluate boolean conditions for if/skip logic

## Data Structures

```typescript
// ─── TemplateRenderer Class ─────────────────────────────

class TemplateRenderer {
  private expressionRegex = /\{\{([^}]+)\}\}/g;

  // Main methods
  render(template: string, context: Map<string, unknown>): string
  renderObject(obj: unknown, context: Map<string, unknown>): unknown
  evaluateCondition(expression: string, context: Map<string, unknown>): boolean

  // Helpers
  private resolveExpression(expression: string, context: Map<string, unknown>): unknown
  private traverseProperty(obj: unknown, path: string[]): unknown
  private isTruthy(value: unknown): boolean
}
```

## Algorithm: render(template, context)

**Inputs:**
- `template: string` — string containing `{{...}}` expressions
- `context: Map<string, unknown>` — variable bindings

**Outputs:**
- `string` — template with all expressions replaced

**Pseudocode:**

```
function render(template, context):
  if template is not a string:
    return template

  result = template

  // Find all {{...}} expressions
  matches = template.matchAll(/\{\{([^}]+)\}\}/g)

  for each match in matches:
    fullExpression = match[0]  // e.g., "{{user.name}}"
    expression = match[1]      // e.g., "user.name"

    // Resolve expression
    value = resolveExpression(expression, context)

    // Convert to string
    valueStr = valueToString(value)

    // Replace in template
    result = result.replaceAll(fullExpression, valueStr)

  return result

function valueToString(value):
  if value is null or undefined:
    return ''

  if value is a boolean:
    return value ? 'true' : 'false'

  if value is an object or array:
    return JSON.stringify(value)

  return String(value)
```

**Examples:**
- Template: "https://example.com/user/{{userId}}"
- Context: { userId: "123" }
- Result: "https://example.com/user/123"

---

- Template: "Name: {{user.profile.name}}, Age: {{user.age}}"
- Context: { user: { profile: { name: "Alice" }, age: 30 } }
- Result: "Name: Alice, Age: 30"

---

- Template: "Item: {{items[0].title}}"
- Context: { items: [{ title: "Widget" }] }
- Result: "Item: Widget"

## Algorithm: resolveExpression(expression, context)

**Inputs:**
- `expression: string` — expression like "user.name" or "items[0].id" or "config"
- `context: Map<string, unknown>`

**Outputs:**
- `unknown` — resolved value, or null if not found

**Pseudocode:**

```
function resolveExpression(expression, context):
  expression = expression.trim()

  // Parse the expression to extract base name and path
  // Examples:
  //   "config" → base: "config", path: []
  //   "user.name" → base: "user", path: ["name"]
  //   "items[0].id" → base: "items", path: [0, "id"]

  match = expression.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)(.*)/);

  if not match:
    return null

  baseName = match[1]
  pathStr = match[2]

  // Get base value from context
  baseValue = context.get(baseName)

  if baseValue is null or undefined:
    return null

  // Parse path (e.g., ".name[0].id")
  path = parsePath(pathStr)

  // Traverse
  return traverseProperty(baseValue, path)

function parsePath(pathStr):
  // Parse ".name[0].id" into ["name", 0, "id"]
  path = []
  currentPos = 0

  while currentPos < pathStr.length:
    if pathStr[currentPos] == '.':
      // Property access: ".name" or ".id"
      currentPos++
      match = pathStr.substring(currentPos).match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)/)
      if match:
        path.push(match[1])
        currentPos += match[1].length
      else:
        break

    else if pathStr[currentPos] == '[':
      // Array/object index: "[0]" or "[key]"
      closeIdx = pathStr.indexOf(']', currentPos)
      if closeIdx == -1:
        break

      indexStr = pathStr.substring(currentPos + 1, closeIdx)

      // Check if numeric index or string key
      if isNumeric(indexStr):
        path.push(parseInt(indexStr))
      else:
        // Remove quotes if present
        indexStr = indexStr.replace(/^['"]|['"]$/g, '')
        path.push(indexStr)

      currentPos = closeIdx + 1
    else:
      break

  return path

function traverseProperty(obj, path):
  current = obj

  for each segment in path:
    if current is null or undefined:
      return null

    if segment is an integer:
      // Array index
      if not isArray(current):
        return null
      current = current[segment]
    else:
      // Object property
      current = current[segment]

  return current
```

**Examples:**

| Expression | Context | Result |
|---|---|---|
| `user` | `{ user: "Alice" }` | `"Alice"` |
| `user.name` | `{ user: { name: "Alice" } }` | `"Alice"` |
| `items[0]` | `{ items: ["a", "b"] }` | `"a"` |
| `items[0].id` | `{ items: [{ id: 42 }] }` | `42` |
| `config["api_key"]` | `{ config: { api_key: "secret" } }` | `"secret"` |
| `user.name` | `{ user: null }` | `null` |
| `missing` | `{ user: "Alice" }` | `null` |

## Algorithm: renderObject(obj, context)

**Inputs:**
- `obj: unknown` — any JavaScript value (string, object, array, primitive)
- `context: Map<string, unknown>`

**Outputs:**
- `unknown` — same structure with all strings rendered

**Pseudocode:**

```
function renderObject(obj, context):
  if obj is a string:
    return render(obj, context)

  else if obj is an array:
    return obj.map(item => renderObject(item, context))

  else if obj is an object (not null, not array):
    result = {}
    for (key, value) in obj:
      result[key] = renderObject(value, context)
    return result

  else:
    // Primitive (number, boolean, null, undefined)
    return obj
```

**Examples:**

Input: `{ url: "https://example.com/user/{{userId}}", page: 1 }`
Context: `{ userId: "123" }`
Output: `{ url: "https://example.com/user/123", page: 1 }`

---

Input: `["Item {{id}}", { name: "{{title}}" }]`
Context: `{ id: 42, title: "Widget" }`
Output: `["Item 42", { name: "Widget" }]`

## Algorithm: evaluateCondition(expression, context)

**Inputs:**
- `expression: string` — expression to evaluate as boolean
- `context: Map<string, unknown>`

**Outputs:**
- `boolean` — true if expression is truthy, false otherwise

**Pseudocode:**

```
function evaluateCondition(expression, context):
  // Render the expression (in case it contains templates)
  rendered = render(expression, context)

  // Evaluate truthiness
  if rendered is empty string or "null" or "undefined":
    return false

  if rendered == "false" or rendered == "0":
    return false

  return true

function isTruthy(value):
  if value is null or undefined:
    return false

  if value is a boolean:
    return value

  if value is a string:
    return value.length > 0 and value != "null" and value != "undefined"

  if value is a number:
    return value != 0

  if value is an array or object:
    return true

  return Boolean(value)
```

**Examples:**

| Expression | Context | Result |
|---|---|---|
| `{{isActive}}` | `{ isActive: true }` | `true` |
| `{{count}}` | `{ count: 5 }` | `true` |
| `{{count}}` | `{ count: 0 }` | `false` |
| `{{name}}` | `{ name: "Alice" }` | `true` |
| `{{name}}` | `{ name: "" }` | `false` |
| `{{user}}` | `{ user: null }` | `false` |
| `{{items}}` | `{ items: [1, 2] }` | `true` |

## Error Handling

The TemplateRenderer does not throw errors. Instead:

1. **Missing variables:** If a template references a missing variable, replace with empty string.
   - Template: `"User: {{user.name}}"`
   - Context: `{ }`
   - Result: `"User: "`

2. **Invalid path:** If path traversal fails (e.g., accessing property of null), return null/empty.
   - Template: `"{{user.profile.name}}"`
   - Context: `{ user: null }`
   - Result: `""`

3. **Type mismatch:** If trying to access array index on non-array, return null.
   - Template: `"{{user[0]}}"`
   - Context: `{ user: "Alice" }`
   - Result: `""`

4. **Invalid expression syntax:** Silently skip malformed expressions.
   - Template: `"{{user.}}"`  (trailing dot)
   - Result: `"{{user.}}"` (unchanged)

## Edge Cases

1. **Nested templates:** Do not process nested templates recursively.
   - Template: `"{{prefix_{{name}}}}"`
   - Result: No error, but second template not processed. Treat as literal.

2. **Empty template:** If expression is empty `{{}}`, replace with empty string.

3. **Whitespace in expression:** Trim whitespace from expressions.
   - `{{ user . name }}` → parsed as `user.name`

4. **Array bounds:** If accessing out-of-bounds array index, return null.
   - Template: `"{{items[99]}}"`
   - Context: `{ items: ["a"] }`
   - Result: `""`

5. **Object vs array iteration:** Do not auto-iterate. Array access requires explicit index.
   - Template: `"{{users[0].name}}"` works
   - Template: `"{{users.0.name}}"` does not (use [0] syntax)

6. **Special characters in keys:** Use bracket notation for keys with special chars.
   - `{{config["api-key"]}}` works
   - `{{config.api-key}}` does not

7. **Circular references:** If context has circular object references, JSON.stringify will fail. Catch and return "[Object]".

8. **Large objects:** If object is very large, JSON.stringify may be slow. This is acceptable; no optimization required.

9. **Undefined vs null:** Both treated the same (falsy).
   - Template: `"{{value}}"` with value undefined or null → `""`

10. **Boolean false in string:** When rendering boolean false, convert to string "false", not empty.
    - Template: `"Active: {{isActive}}"`
    - Context: `{ isActive: false }`
    - Result: `"Active: false"`

## Test Scenarios

### 1. Simple variable substitution

**Template:** `"Hello {{name}}"`
**Context:** `{ name: "Alice" }`
**Expected:** `"Hello Alice"`

### 2. Multiple variables

**Template:** `"{{greeting}} {{name}}, you are {{age}} years old"`
**Context:** `{ greeting: "Hi", name: "Alice", age: 30 }`
**Expected:** `"Hi Alice, you are 30 years old"`

### 3. Nested property access

**Template:** `"User: {{user.profile.name}}"`
**Context:** `{ user: { profile: { name: "Alice" } } }`
**Expected:** `"User: Alice"`

### 4. Array index access

**Template:** `"First item: {{items[0]}}"`
**Context:** `{ items: ["a", "b", "c"] }`
**Expected:** `"First item: a"`

### 5. Array element with property

**Template:** `"ID: {{items[0].id}}"`
**Context:** `{ items: [{ id: 42 }] }`
**Expected:** `"ID: 42"`

### 6. Missing variable

**Template:** `"User: {{user}}"`
**Context:** `{ }`
**Expected:** `"User: "`

### 7. Null property access

**Template:** `"Name: {{user.name}}"`
**Context:** `{ user: null }`
**Expected:** `"Name: "`

### 8. Out-of-bounds array index

**Template:** `"Item: {{items[5]}}"`
**Context:** `{ items: ["a", "b"] }`
**Expected:** `"Item: "`

### 9. Render object with nested strings

**Input:** `{ url: "/api/{{version}}/users/{{userId}}", headers: { auth: "Bearer {{token}}" } }`
**Context:** `{ version: "v1", userId: "123", token: "abc" }`
**Expected:** `{ url: "/api/v1/users/123", headers: { auth: "Bearer abc" } }`

### 10. Render array of objects

**Input:** `[{ name: "{{user1}}" }, { name: "{{user2}}" }]`
**Context:** `{ user1: "Alice", user2: "Bob" }`
**Expected:** `[{ name: "Alice" }, { name: "Bob" }]`

### 11. Condition true

**Expression:** `"{{isActive}}"`
**Context:** `{ isActive: true }`
**Expected:** `true`

### 12. Condition false

**Expression:** `"{{isActive}}"`
**Context:** `{ isActive: false }`
**Expected:** `false`

### 13. Condition with missing variable

**Expression:** `"{{isActive}}"`
**Context:** `{ }`
**Expected:** `false`

### 14. Condition with non-empty string

**Expression:** `"{{status}}"`
**Context:** `{ status: "pending" }`
**Expected:** `true`

### 15. Condition with zero

**Expression:** `"{{count}}"`
**Context:** `{ count: 0 }`
**Expected:** `false`

### 16. Condition with array

**Expression:** `"{{items}}"`
**Context:** `{ items: [] }`
**Expected:** `true` (non-empty even if array is empty)

### 17. Bracket notation with string key

**Template:** `"{{config["api_key"]}}"`
**Context:** `{ config: { api_key: "secret123" } }`
**Expected:** `"secret123"`

### 18. Render with object value

**Template:** `"Data: {{metadata}}"`
**Context:** `{ metadata: { type: "user", id: 42 } }`
**Expected:** `"Data: {"type":"user","id":42}"`

### 19. Empty template expression

**Template:** `"Value: {{}}"`
**Context:** `{ }`
**Expected:** `"Value: "`

### 20. Whitespace in expression

**Template:** `"{{ user . name }}"`
**Context:** `{ user: { name: "Alice" } }`
**Expected:** `"Alice"` (whitespace trimmed)
