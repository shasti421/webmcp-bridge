# CLI Specification

## Purpose

The WebMCP Bridge CLI provides command-line tools for developers to validate, test, publish, and manage web application automations. It serves as the primary interface for the local development workflow.

**Key commands:**
- `validate` — Validate YAML files
- `init` — Scaffold new app directory
- `test` — Test tools against live app
- `publish` — Publish to registry
- `pull` — Install from registry
- `list` — List installed apps
- `search` — Search registry

## Commands

### validate

Validate YAML files in a directory against schemas.

**Usage:**
```bash
webmcp-bridge validate [path]
```

**Options:**
- `--path <dir>` — app directory (default: current directory)
- `--strict` — fail on warnings
- `--verbose` — detailed output

**Output:**

```
Validating: /path/to/app

✓ app.yaml
  ├─ id: "my_app"
  ├─ name: "My Application"
  ├─ base_url: "https://myapp.example.com"
  └─ url_patterns: 1 pattern

✓ pages/
  ├─ detail.yaml (6 fields, 3 outputs)
  ├─ list.yaml (2 fields, 1 output)
  └─ form.yaml (8 fields, 2 outputs)

✓ tools/
  ├─ create_item.yaml
  └─ update_item.yaml

✓ workflows/
  └─ bulk_create.yaml

Summary: 6 files validated, 0 errors, 0 warnings
```

**Algorithm:**

```
function validate(path):
  // Step 1: Scan directory for YAML files
  files = findYamlFiles(path)

  // Step 2: Load validator
  validator = YamlSchemaValidator()

  // Step 3: Validate each file
  results = []
  for each file in files:
    content = fs.readFileSync(file, 'utf-8')
    yaml = jsYaml.load(content)

    fileType = determineFileType(file)  // app, page, tool, workflow

    validateResult = switch(fileType):
      case 'app':
        validator.validateApp(yaml)
      case 'page':
        validator.validatePage(yaml)
      case 'tool':
        validator.validateTool(yaml)
      case 'workflow':
        validator.validateWorkflow(yaml)

    results.push({
      file: file,
      ok: isOk(validateResult),
      error: validateResult.error
    })

  // Step 4: Print results
  printValidationResults(results)

  // Step 5: Exit with appropriate code
  if any error:
    return 1
  else:
    return 0
```

### init

Scaffold a new app directory.

**Usage:**
```bash
webmcp-bridge init [app-id]
```

**Options:**
- `--name <string>` — app name
- `--url <url>` — base URL

**Output:**

```
Creating app structure...
✓ app.yaml
✓ pages/
✓ tools/
✓ workflows/

Edit app.yaml and add pages, tools, and workflows.
Run 'webmcp-bridge validate' to check your work.
```

**Generated files:**

```
my_app/
├── app.yaml
├── pages/
│   └── .gitkeep
├── tools/
│   └── .gitkeep
└── workflows/
    └── .gitkeep
```

**app.yaml template:**

```yaml
id: my_app
name: My Application
base_url: https://example.com
url_patterns:
  - /path/{id}
  - /other/*

description: Description of your app
version: 1.0.0

auth:
  type: browser_session

registry:
  publisher: Your Name
  tags:
    - productivity
  license: MIT
```

### test

Test tools against a live application.

**Usage:**
```bash
webmcp-bridge test [app-id] --url <url>
```

**Options:**
- `--app <id>` — app to test
- `--url <url>` — starting URL
- `--headless` — run in headless mode
- `--tool <name>` — test specific tool only
- `--slow-motion <ms>` — add delay between actions
- `--screenshot-on-failure` — capture screenshot on error

**Output:**

```
Testing: my_app

Setup: Launching Playwright browser...
✓ Connected to https://example.com

Tool: create_item
  Input: { title: "Test Item", description: "A test" }
  ✓ Navigate to page 'form' (2.1s)
  ✓ Fill field 'title' (0.3s)
  ✓ Fill field 'description' (0.2s)
  ✓ Click button 'submit' (0.1s)
  ✓ Capture output 'success_message' (0.1s)
  ✓ Tool execution: 9.2s, 1 step failed (recovered via healing)

  Output: { success_message: "Item created successfully" }

Tool: update_item
  ✓ Tool execution: 4.1s

Tool: delete_item
  ✗ Test failed: Healing exhausted (SELECTOR_NOT_FOUND)
    Page: https://example.com/items
    Expected selector: button[aria-label="Delete"]
    Screenshot: /tmp/failure-1.png

Summary:
  ✓ 2 passed
  ✗ 1 failed
  Duration: 23.4s
  Exit code: 1
```

**Algorithm:**

```
function test(appId, options):
  // Step 1: Load app definition
  appResult = semanticStore.getApp(appId)
  if isErr(appResult):
    return err(appResult.error)

  app = appResult.value

  // Step 2: Launch browser
  browser = launchBrowser(headless: options.headless)
  page = browser.newPage()

  driver = PlaywrightDriver(page, browser, context)

  // Step 3: Navigate to test URL
  navigationResult = driver.goto(options.url)
  if isErr(navigationResult):
    print("Failed to navigate to " + options.url)
    return 1

  // Step 4: Get list of tools to test
  toolsToTest = options.tool ? [options.tool] : getAllTools(appId)

  // Step 5: Execute each tool
  results = []

  for each toolName in toolsToTest:
    toolResult = semanticStore.getTool(toolName)
    if isErr(toolResult):
      results.push({ tool: toolName, ok: false, error: toolResult.error })
      continue

    tool = toolResult.value

    // Generate sample inputs based on inputSchema
    inputs = generateSampleInputs(tool.inputSchema)

    // Execute tool
    startTime = now()
    executionResult = executionEngine.executeTool(toolName, inputs)
    duration = now() - startTime

    results.push({
      tool: toolName,
      ok: isOk(executionResult),
      duration: duration,
      steps: executionResult.stepsExecuted,
      output: executionResult.outputs,
      error: executionResult.error
    })

  // Step 6: Print results
  printTestResults(results)

  // Step 7: Cleanup
  browser.close()

  return results.filter(r => !r.ok).length > 0 ? 1 : 0
```

### publish

Publish app to remote registry.

**Usage:**
```bash
webmcp-bridge publish [app-id] --version <version> [--registry <url>]
```

**Options:**
- `--app <id>` — app to publish
- `--version <version>` — semantic version
- `--registry <url>` — remote registry URL
- `--dry-run` — validate without publishing

**Output:**

```
Publishing: my_app@1.0.0

✓ Validated YAML
✓ Created package (1.2 MB)
✓ Authenticated with registry
✓ Uploading...

Published: https://registry.webmcp.dev/apps/my_app/1.0.0

Share your app:
  npm install webmcp-my_app
  webmcp-bridge pull my_app --registry webmcp
```

**Algorithm:**

```
function publish(appId, options):
  // Step 1: Validate
  validationResult = validate(options.path)
  if isErr(validationResult):
    print("Validation failed")
    return 1

  // Step 2: Load registry config
  registryUrl = options.registry or DEFAULT_REGISTRY

  // Step 3: Publish
  publishResult = registry.publish(appPath, registryUrl, appId, options.version)

  if isErr(publishResult):
    print("Publish failed: " + publishResult.error.message)
    return 1

  print("Published successfully")
  return 0
```

### pull

Install app from registry.

**Usage:**
```bash
webmcp-bridge pull [app-id] [--version <version>] [--registry <url>]
```

**Options:**
- `--app <id>` — app to install
- `--version <version>` — specific version (default: latest)
- `--registry <url>` — remote registry URL

**Output:**

```
Pulling: my_app@1.0.0

✓ Found on registry
✓ Downloaded (2.3 MB)
✓ Installed to ~/.webmcp-bridge/registry/my_app/1.0.0/

Ready to use:
  webmcp-bridge test my_app --url https://example.com
```

### list

List installed apps.

**Usage:**
```bash
webmcp-bridge list [--format <format>]
```

**Options:**
- `--format <json|table>` — output format

**Output (table):**

```
ID          Name                    Version  Pages  Tools  Workflows
my_app      My Application          1.0.0    3      5      2
todo_app    Todo Application        1.1.0    5      8      3
crm_app     CRM Integration         2.0.1    12     20     5
```

**Output (JSON):**

```json
{
  "apps": [
    {
      "id": "my_app",
      "name": "My Application",
      "version": "1.0.0",
      "description": "...",
      "pageCount": 3,
      "toolCount": 5,
      "workflowCount": 2,
      "installedAt": "2026-03-13T14:00:00Z"
    }
  ]
}
```

### search

Search registry.

**Usage:**
```bash
webmcp-bridge search [query] [--tags <tag1,tag2>]
```

**Options:**
- `--tags <list>` — filter by tags

**Output:**

```
Searching for "todo"...

Results:

1. Todo App
   ID: todo_app
   Version: 1.2.0 (5 other versions)
   Description: Complete todo management automation
   Pages: 3, Tools: 5, Workflows: 2
   Tags: productivity, web
   Downloads: 1,234

2. Simple Todo
   ID: simple_todo
   Version: 1.0.0
   Description: Basic todo tracking
   Pages: 1, Tools: 2
   Tags: productivity
   Downloads: 42

2 results found
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General failure |
| 2 | Invalid arguments |
| 3 | Validation failed |

## Error Messages

**Validation error:**
```
Error: Validation failed

pages/detail.yaml:
  - Missing required field: wait_for
  - At /fields: must have at least 2 items

Run 'webmcp-bridge validate' for details
```

**Missing file:**
```
Error: app.yaml not found

Expected structure:
  app.yaml
  pages/
  tools/
  workflows/

Run 'webmcp-bridge init my_app' to create
```

**Network error:**
```
Error: Failed to reach registry: https://registry.webmcp.dev

Check:
  - Your internet connection
  - Registry URL is correct
  - You have valid API key (set WEBMCP_API_KEY)
```

## Configuration

CLI reads configuration from:
1. `~/.webmcp-bridge/config.json` (user config)
2. `./.webmcp-bridge.json` (project config)
3. Environment variables

**Example config:**

```json
{
  "registry": "https://registry.webmcp.dev",
  "apiKey": "sk-...",
  "defaultBrowser": "chromium",
  "timeout": 30000,
  "verbose": false
}
```

## Test Scenarios

### 1. Validate valid app

**Setup:** Valid app directory with all required files

**Test:** `webmcp-bridge validate /path/to/app`

**Expected:** Exit 0, "0 errors, 0 warnings"

### 2. Validate missing required field

**Setup:** page.yaml missing wait_for

**Test:** `webmcp-bridge validate`

**Expected:** Exit 3, error message naming missing field

### 3. Init app

**Setup:** Empty directory

**Test:** `webmcp-bridge init my_app`

**Expected:** app.yaml and subdirectories created

### 4. Test tool with sample inputs

**Setup:** Valid app with tools

**Test:** `webmcp-bridge test my_app --url https://example.com`

**Expected:** Tools executed with generated inputs, results printed

### 5. Publish app

**Setup:** Valid app, registry configured

**Test:** `webmcp-bridge publish my_app --version 1.0.0`

**Expected:** App published, success message printed

### 6. Pull app

**Setup:** App available on remote registry

**Test:** `webmcp-bridge pull remote_app --version 1.0.0`

**Expected:** App downloaded and installed locally

### 7. List apps

**Setup:** 3 apps installed locally

**Test:** `webmcp-bridge list`

**Expected:** Table printed with all 3 apps

### 8. Search registry

**Setup:** Registry with apps

**Test:** `webmcp-bridge search todo`

**Expected:** Results matching "todo" displayed
