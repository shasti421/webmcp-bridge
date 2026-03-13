# SemanticStore Specification

## Purpose

The SemanticStore is the runtime in-memory index of all application definitions (apps, pages, tools, workflows). It loads YAML files from a directory, validates them using YamlSchemaValidator, and provides query APIs to resolve references and match URLs.

**Key responsibilities:**
- Load all YAML files from a given directory
- Validate each YAML against its schema
- Build a normalized in-memory index (Map<id, Definition>)
- Resolve dotted field/output references (e.g., "page_id.fields.field_id")
- Match incoming URLs to page definitions using pattern conversion
- Provide fast lookup of tools, workflows, pages, and fields

## Data Structures

```typescript
// ─── SemanticStore Class ─────────────────────────────────

class SemanticStore {
  // Private index maps
  private appIndex: Map<string, AppDefinition>;
  private pageIndex: Map<string, PageDefinition>;
  private toolIndex: Map<string, ToolDefinition>;
  private workflowIndex: Map<string, WorkflowDefinition>;

  // URL pattern regex cache (compiled from patterns in app.yaml)
  private urlPatternCache: Map<string, RegExp>;

  // Validator instance (injected)
  private validator: YamlSchemaValidator;

  constructor(validator: YamlSchemaValidator)

  // Loading and indexing
  async loadDirectory(directoryPath: string): Promise<Result<void, BridgeError>>

  // Lookup APIs
  getApp(id: string): Result<AppDefinition, BridgeError>
  getPage(id: string): Result<PageDefinition, BridgeError>
  getTool(name: string): Result<ToolDefinition, BridgeError>
  getWorkflow(name: string): Result<WorkflowDefinition, BridgeError>

  // Reference resolution
  resolveFieldRef(ref: string): Result<FieldDefinition, BridgeError>
  resolveOutputRef(ref: string): Result<OutputDefinition, BridgeError>

  // URL matching
  matchPage(url: string): Result<PageDefinition, BridgeError>

  // List APIs (for CLI, registry)
  listApps(): AppDefinition[]
  listPages(): PageDefinition[]
  listTools(): ToolDefinition[]
  listWorkflows(): WorkflowDefinition[]
}
```

## Algorithm: loadDirectory(directoryPath)

**Inputs:**
- `directoryPath: string` — path to directory containing YAML files

**Outputs:**
- `Result<void, BridgeError>` — ok(void) if all files validated and indexed, err(YAML_PARSE_ERROR | SCHEMA_VALIDATION_ERROR) otherwise

**Pseudocode:**

```
function loadDirectory(directoryPath):
  // Step 1: Read all files from directory
  files = fs.readdirSync(directoryPath, { recursive: true })
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))

  // Step 2: Categorize files by type and validate
  for each file in files:
    content = fs.readFileSync(file, 'utf-8')

    try:
      yamlData = jsYaml.load(content)
    catch (parseError):
      return err(BridgeError{
        code: 'YAML_PARSE_ERROR',
        message: `Failed to parse ${file}: ${parseError.message}`,
        source: 'semantic',
        cause: parseError
      })

    // Determine file type by basename:
    // - app.yaml or app_*.yaml → AppDefinition
    // - pages/*.yaml → PageDefinition
    // - tools/*.yaml → ToolDefinition
    // - workflows/*.yaml → WorkflowDefinition

    if file matches 'app.yaml':
      result = validator.validateApp(yamlData)
      if isErr(result):
        return result
      store in appIndex

    else if file in 'pages/':
      result = validator.validatePage(yamlData)
      if isErr(result):
        return result
      store in pageIndex

    else if file in 'tools/':
      result = validator.validateTool(yamlData)
      if isErr(result):
        return result
      store in toolIndex

    else if file in 'workflows/':
      result = validator.validateWorkflow(yamlData)
      if isErr(result):
        return result
      store in workflowIndex

  // Step 3: Compile URL patterns into regexes
  for each app in appIndex:
    for each pattern in app.url_patterns:
      compiledRegex = convertPatternToRegex(pattern)
      urlPatternCache.set(`${app.id}:${pattern}`, compiledRegex)

  return ok(void)
```

## Algorithm: convertPatternToRegex(pattern)

**Inputs:**
- `pattern: string` — URL pattern, e.g. "/path/{id}/view" or "/api/*/users"

**Outputs:**
- `RegExp` — anchored regex that matches the pattern

**Pseudocode:**

```
function convertPatternToRegex(pattern):
  // Escape regex special chars except {} and *
  escaped = pattern
    .replace(/[.+?^$|()[\]\\]/g, '\\$&')

  // Replace {id} and similar with regex groups
  escaped = escaped.replace(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g, '([^/]+)')

  // Replace * wildcard with .*
  escaped = escaped.replace(/\*/g, '.*')

  // Anchor at start and end
  return new RegExp(`^${escaped}$`)

  // Examples:
  // "/path/{id}/view" → /^\/path\/([^/]+)\/view$/
  // "/api/*/users" → /^\/api\/.*\/users$/
  // "/app/*" → /^\/app\/.*$/
```

## Algorithm: resolveFieldRef(ref)

**Inputs:**
- `ref: string` — dotted reference, e.g. "page_id.fields.field_id"

**Outputs:**
- `Result<FieldDefinition, BridgeError>` — the resolved field, or err(PAGE_NOT_FOUND) if page not found

**Pseudocode:**

```
function resolveFieldRef(ref: string):
  parts = ref.split('.')

  if parts.length != 3 or parts[1] != 'fields':
    return err(BridgeError{
      code: 'SCHEMA_VALIDATION_ERROR',
      message: `Invalid field reference format: ${ref}. Expected "page_id.fields.field_id"`,
      source: 'semantic'
    })

  pageId = parts[0]
  fieldId = parts[2]

  pageResult = getPage(pageId)
  if isErr(pageResult):
    return err(createBridgeError(
      'PAGE_NOT_FOUND',
      `Page not found: ${pageId} (from field ref ${ref})`,
      'semantic'
    ))

  page = pageResult.value
  field = page.fields.find(f => f.id == fieldId)

  if not field:
    return err(createBridgeError(
      'SCHEMA_VALIDATION_ERROR',
      `Field not found: ${fieldId} in page ${pageId}`,
      'semantic'
    ))

  return ok(field)
```

## Algorithm: resolveOutputRef(ref)

**Inputs:**
- `ref: string` — dotted reference, e.g. "page_id.outputs.output_id"

**Outputs:**
- `Result<OutputDefinition, BridgeError>` — the resolved output, or err(PAGE_NOT_FOUND)

**Pseudocode:**

```
function resolveOutputRef(ref: string):
  parts = ref.split('.')

  if parts.length != 3 or parts[1] != 'outputs':
    return err(BridgeError{
      code: 'SCHEMA_VALIDATION_ERROR',
      message: `Invalid output reference format: ${ref}. Expected "page_id.outputs.output_id"`,
      source: 'semantic'
    })

  pageId = parts[0]
  outputId = parts[2]

  pageResult = getPage(pageId)
  if isErr(pageResult):
    return err(createBridgeError(
      'PAGE_NOT_FOUND',
      `Page not found: ${pageId} (from output ref ${ref})`,
      'semantic'
    ))

  page = pageResult.value
  output = page.outputs.find(o => o.id == outputId)

  if not output:
    return err(createBridgeError(
      'SCHEMA_VALIDATION_ERROR',
      `Output not found: ${outputId} in page ${pageId}`,
      'semantic'
    ))

  return ok(output)
```

## Algorithm: matchPage(url)

**Inputs:**
- `url: string` — full URL to match, e.g. "https://example.com/app/123/view"

**Outputs:**
- `Result<PageDefinition, BridgeError>` — the first matching page, or err(PAGE_NOT_FOUND)

**Pseudocode:**

```
function matchPage(url):
  // Parse URL to get just the path
  urlObj = new URL(url)
  path = urlObj.pathname

  // Iterate through all pages
  for each page in pageIndex.values():
    pattern = page.url_pattern

    // Try to match using cached regex
    cacheKey = `${page.app}:${pattern}`
    regex = urlPatternCache.get(cacheKey)

    if not regex:
      // Fallback: compile on the fly (shouldn't happen if loadDirectory succeeded)
      regex = convertPatternToRegex(pattern)

    if regex.test(path):
      return ok(page)

  // No match found
  return err(createBridgeError(
    'PAGE_NOT_FOUND',
    `No page definition found for URL: ${url}`,
    'semantic'
  ))
```

## Error Handling

The SemanticStore uses Result<T, BridgeError> for all fallible operations.

**Error codes:**
- `YAML_PARSE_ERROR` — js-yaml failed to parse file
- `SCHEMA_VALIDATION_ERROR` — YAML structure invalid, or reference format wrong
- `PAGE_NOT_FOUND` — page ID not in index, or URL doesn't match any page
- `TOOL_NOT_FOUND` — tool name not found
- `REGISTRY_ERROR` — (if loading from remote registry)

**Error context included:**
- `source: 'semantic'`
- `cause: originalError` — for YAML parse errors
- `message` — human-readable description with context (file name, ref, URL)

## Edge Cases and Constraints

1. **Circular references:** Do not check for cycles. Assume YAML is authored correctly. If A.bridge references B and B references A, the execution engine will detect and fail.

2. **Case sensitivity:** All IDs are case-sensitive. "PageId" ≠ "pageid".

3. **Optional fields:** Some YAML fields are optional (e.g., `auth`, `description`). Initialize with defaults (empty objects, empty strings, false) to avoid null pointer errors.

4. **URL pattern precedence:** If multiple pages match a URL, return the first one found in iteration order. To ensure deterministic matching, pages should be loaded in a stable order (sort by ID).

5. **Whitespace in patterns:** Do not trim whitespace from patterns. "{id}" with spaces is different from "{ id }".

6. **Regex special chars in patterns:** A literal "." in a pattern (e.g., "/file.txt") must be escaped. The algorithm already handles this.

7. **Cached URL patterns:** If the same pattern string appears in multiple apps, each gets its own cache entry (keyed by `appId:pattern`). This is safe; patterns are immutable after load.

8. **Empty directory:** If no YAML files exist, loadDirectory should return ok(void) with empty indices.

9. **Duplicate IDs:** If two files define the same page ID, the second one silently overwrites the first. Log a warning but don't fail.

## Test Scenarios

### 1. Load valid directory structure

**Setup:** Directory with:
```
app.yaml
pages/detail.yaml
pages/list.yaml
tools/create.yaml
workflows/bulk_create.yaml
```

**Expected:** All files indexed, getPage("detail") returns ok, matchPage("https://example.com/items/123") returns ok.

### 2. YAML parse error

**Setup:** `pages/invalid.yaml` contains invalid YAML (bad indentation, unclosed quote).

**Expected:** loadDirectory returns err(YAML_PARSE_ERROR) with clear message and file path in error.

### 3. Schema validation error

**Setup:** `pages/incomplete.yaml` missing required field `wait_for`.

**Expected:** loadDirectory returns err(SCHEMA_VALIDATION_ERROR) with message naming the missing field.

### 4. Resolve field reference — success

**Setup:** Load app with page "detail" containing field "name".

**Test:** resolveFieldRef("detail.fields.name")

**Expected:** ok(FieldDefinition{ id: "name", ... })

### 5. Resolve field reference — page not found

**Test:** resolveFieldRef("nonexistent.fields.name")

**Expected:** err(BridgeError{ code: 'PAGE_NOT_FOUND', ... })

### 6. Resolve field reference — invalid format

**Test:** resolveFieldRef("detail.name")

**Expected:** err(BridgeError{ code: 'SCHEMA_VALIDATION_ERROR', message: contains "Invalid field reference format" })

### 7. Match URL — literal path

**Setup:** App with page url_pattern "/app/home"

**Test:** matchPage("https://example.com/app/home")

**Expected:** ok(PageDefinition)

### 8. Match URL — with {id} parameter

**Setup:** App with page url_pattern "/items/{id}/edit"

**Test:** matchPage("https://example.com/items/42/edit")

**Expected:** ok(PageDefinition)

### 9. Match URL — with wildcard

**Setup:** App with page url_pattern "/api/*/resource"

**Test:** matchPage("https://example.com/api/v1/resource")

**Expected:** ok(PageDefinition)

### 10. Match URL — no match

**Setup:** App with pages for "/users" and "/items"

**Test:** matchPage("https://example.com/admin/dashboard")

**Expected:** err(BridgeError{ code: 'PAGE_NOT_FOUND', ... })

### 11. Duplicate page IDs

**Setup:** Load two files both defining page with id="detail".

**Expected:** Second file overwrites; getPage("detail") returns the second one (last write wins).

### 12. Empty directory

**Setup:** Load from empty directory.

**Expected:** ok(void), all indices are empty, matchPage("https://example.com/any") returns err(PAGE_NOT_FOUND).

### 13. Case-sensitive IDs

**Setup:** Load page with id="Detail".

**Test:** getPage("detail") and getPage("Detail")

**Expected:** First returns err, second returns ok.

### 14. URL with query string and fragment

**Setup:** App with page url_pattern "/search"

**Test:** matchPage("https://example.com/search?q=test#results")

**Expected:** ok(PageDefinition) — query string and fragment are stripped before matching.

### 15. Resolve output reference — success

**Setup:** Load app with page "list" containing output "items".

**Test:** resolveOutputRef("list.outputs.items")

**Expected:** ok(OutputDefinition)

### 16. Pattern with literal special characters

**Setup:** App with page url_pattern "/file.txt"

**Test:** matchPage("https://example.com/file.txt")

**Expected:** ok(PageDefinition). Does not match "/fileXtxt".
