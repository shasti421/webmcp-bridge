# Registry System Specification

## Purpose

The Registry system provides a centralized repository for app definitions, enabling users to discover, install, publish, and share web application automations. It includes both local filesystem-based storage and optional remote API integration.

**Key responsibilities:**
- Manage local app registry at `~/.webmcp-bridge/registry/`
- Install apps from local files or remote registry
- Publish apps to remote registry
- Search apps by name, tags, description
- Version management and metadata tracking

## Local Registry Structure

```
~/.webmcp-bridge/registry/
├── app_id_1/
│   ├── 1.0.0/
│   │   ├── app.yaml
│   │   ├── pages/
│   │   ├── tools/
│   │   ├── workflows/
│   │   └── metadata.json
│   └── 1.1.0/
│       └── ...
├── app_id_2/
│   └── 1.0.0/
│       └── ...
└── registry-index.json
```

## Data Structures

```typescript
// ─── Local Registry Class ────────────────────────────

class LocalRegistry {
  private basePath: string = `${process.env.HOME}/.webmcp-bridge/registry`;

  async install(appPath: string, appId: string, version: string): Promise<Result<void, BridgeError>>
  async remove(appId: string, version?: string): Promise<Result<void, BridgeError>>

  async getApp(appId: string, version?: string): Promise<Result<AppDefinition, BridgeError>>
  async listApps(): Promise<Result<AppMetadata[], BridgeError>>
  async listVersions(appId: string): Promise<Result<string[], BridgeError>>

  async search(query: string, tags?: string[]): Promise<Result<AppMetadata[], BridgeError>>

  private async getMetadata(appId: string, version: string): Promise<RegistryMetadata>
  private async saveMetadata(appId: string, version: string, metadata: RegistryMetadata): Promise<void>
}

// ─── Registry Metadata ───────────────────────────────

interface RegistryMetadata {
  appId: string;
  name: string;
  version: string;
  description: string;
  publisher?: string;
  tags: string[];
  license: string;
  baseUrl: string;
  urlPatterns: string[];
  pageCount: number;
  toolCount: number;
  workflowCount: number;
  installedAt: Date;
  lastUpdated: Date;
}

interface RegistryIndex {
  [appId: string]: {
    versions: string[];
    latest: string;
    metadata: Partial<RegistryMetadata>;
  };
}

// ─── Remote API Types ────────────────────────────────

interface RemoteRegistry {
  baseUrl: string;
  apiKey?: string;
}

interface AppPackage {
  id: string;
  version: string;
  content: Buffer;  // tar.gz content
  metadata: RegistryMetadata;
}
```

## Algorithm: install(appPath, appId, version)

**Inputs:**
- `appPath: string` — local directory or remote URL of app
- `appId: string` — app identifier
- `version: string` — semantic version

**Outputs:**
- `Result<void, BridgeError>` — ok(void) on success

**Pseudocode:**

```
function install(appPath, appId, version):
  // Step 1: Validate YAML files
  yamlDir = appPath

  validationResult = validateAppDirectory(yamlDir)
  if isErr(validationResult):
    return err(validationResult.error)

  // Step 2: Load app.yaml to get metadata
  appYaml = loadYaml(`${yamlDir}/app.yaml`)

  // Step 3: Count pages, tools, workflows
  pages = fs.readdirSync(`${yamlDir}/pages`).length
  tools = fs.readdirSync(`${yamlDir}/tools`).length
  workflows = fs.readdirSync(`${yamlDir}/workflows`).length

  // Step 4: Create installation directory
  installPath = `${this.basePath}/${appId}/${version}`

  if fs.existsSync(installPath):
    return err(BridgeError{
      code: 'REGISTRY_ERROR',
      message: `App already installed: ${appId}@${version}`
    })

  fs.mkdirSync(installPath, { recursive: true })

  // Step 5: Copy files
  copyRecursive(yamlDir, installPath)

  // Step 6: Create and save metadata
  metadata = RegistryMetadata{
    appId: appId,
    name: appYaml.name,
    version: version,
    description: appYaml.description,
    publisher: appYaml.registry?.publisher,
    tags: appYaml.registry?.tags or [],
    license: appYaml.registry?.license or 'MIT',
    baseUrl: appYaml.base_url,
    urlPatterns: appYaml.url_patterns,
    pageCount: pages,
    toolCount: tools,
    workflowCount: workflows,
    installedAt: now(),
    lastUpdated: now()
  }

  saveMetadata(appId, version, metadata)

  // Step 7: Update registry index
  index = loadRegistryIndex()
  if not index[appId]:
    index[appId] = { versions: [], latest: version }

  if not index[appId].versions.includes(version):
    index[appId].versions.push(version)

  index[appId].latest = version  // Latest is most recently installed
  index[appId].metadata = metadata

  saveRegistryIndex(index)

  return ok(void)

function validateAppDirectory(path):
  // Check for required files
  if not fs.existsSync(`${path}/app.yaml`):
    return err(REGISTRY_ERROR, "Missing app.yaml")

  if not fs.existsSync(`${path}/pages`):
    return err(REGISTRY_ERROR, "Missing pages/ directory")

  if not fs.existsSync(`${path}/tools`):
    return err(REGISTRY_ERROR, "Missing tools/ directory")

  // Validate YAML files
  return validateYamlDirectory(path)
```

## Algorithm: getApp(appId, version?)

**Inputs:**
- `appId: string`
- `version?: string` — if not provided, use latest

**Outputs:**
- `Result<AppDefinition, BridgeError>`

**Pseudocode:**

```
function getApp(appId, version):
  version = version or getLatestVersion(appId)

  if not version:
    return err(REGISTRY_ERROR, "App not found: " + appId)

  appPath = `${this.basePath}/${appId}/${version}/app.yaml`

  if not fs.existsSync(appPath):
    return err(REGISTRY_ERROR, "Version not found: " + appId + "@" + version)

  yamlContent = fs.readFileSync(appPath, 'utf-8')
  appDef = jsYaml.load(yamlContent)

  return ok(appDef)

function getLatestVersion(appId):
  index = loadRegistryIndex()
  return index[appId]?.latest or null
```

## Algorithm: search(query, tags?)

**Inputs:**
- `query: string` — search term (matches name, description)
- `tags?: string[]` — filter by tags

**Outputs:**
- `Result<AppMetadata[], BridgeError>`

**Pseudocode:**

```
function search(query, tags):
  index = loadRegistryIndex()
  results = []

  for (appId, appEntry) in index:
    metadata = appEntry.metadata

    // Match query against name and description
    queryMatch = query.toLowerCase()
    nameMatch = metadata.name.toLowerCase().includes(queryMatch)
    descMatch = (metadata.description or '').toLowerCase().includes(queryMatch)

    if not (nameMatch or descMatch):
      continue

    // Match tags if provided
    if tags and tags.length > 0:
      hasAllTags = tags.every(tag => metadata.tags.includes(tag))
      if not hasAllTags:
        continue

    results.push({
      appId: appId,
      ...metadata,
      versions: appEntry.versions,
      latest: appEntry.latest
    })

  return ok(results)
```

## Algorithm: publish(appPath, remoteRegistry, appId, version)

**Inputs:**
- `appPath: string` — local app directory
- `remoteRegistry: RemoteRegistry` — remote API config
- `appId: string`
- `version: string`

**Outputs:**
- `Result<void, BridgeError>`

**Pseudocode:**

```
function publish(appPath, remoteRegistry, appId, version):
  // Step 1: Validate locally
  validationResult = validateAppDirectory(appPath)
  if isErr(validationResult):
    return err(validationResult.error)

  // Step 2: Create tar.gz package
  packageBuffer = createTarGz(appPath)

  // Step 3: Load metadata
  appYaml = loadYaml(`${appPath}/app.yaml`)
  metadata = buildMetadata(appYaml, appId, version)

  // Step 4: POST to remote registry
  try:
    response = await fetch(`${remoteRegistry.baseUrl}/api/apps`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${remoteRegistry.apiKey}`,
        'Content-Type': 'application/octet-stream',
        'X-App-ID': appId,
        'X-Version': version,
        'X-Metadata': JSON.stringify(metadata)
      },
      body: packageBuffer
    })

    if response.status == 201:
      return ok(void)
    else:
      return err(REGISTRY_ERROR, "Publish failed: " + response.statusText)

  catch (error):
    return err(REGISTRY_ERROR, "Publish error: " + error.message)
```

## Algorithm: pull(appId, version, remoteRegistry)

**Inputs:**
- `appId: string`
- `version: string`
- `remoteRegistry: RemoteRegistry`

**Outputs:**
- `Result<void, BridgeError>`

**Pseudocode:**

```
function pull(appId, version, remoteRegistry):
  // Step 1: Fetch from remote
  try:
    response = await fetch(`${remoteRegistry.baseUrl}/api/apps/${appId}/${version}`, {
      headers: { 'Authorization': `Bearer ${remoteRegistry.apiKey}` }
    })

    if response.status != 200:
      return err(REGISTRY_ERROR, "App not found on remote registry")

    buffer = await response.arrayBuffer()

  catch (error):
    return err(REGISTRY_ERROR, "Pull failed: " + error.message)

  // Step 2: Extract tar.gz to temporary directory
  tempPath = `/tmp/webmcp-bridge-${appId}-${version}-${Date.now()}`

  extractTarGz(buffer, tempPath)

  // Step 3: Install from temporary directory
  return install(tempPath, appId, version)
```

## Remote API Endpoints

### GET /api/apps

List all apps in remote registry.

**Response:**
```json
{
  "apps": [
    {
      "id": "app_id",
      "name": "App Name",
      "description": "...",
      "versions": ["1.0.0", "1.1.0"],
      "latest": "1.1.0",
      "tags": ["productivity", "web"],
      "downloads": 1234
    }
  ]
}
```

### GET /api/apps/:appId/:version

Get app package.

**Response:** tar.gz binary blob

### GET /api/apps/search

Search apps.

**Query params:**
- `q`: search term
- `tags`: comma-separated tags

**Response:**
```json
{
  "results": [
    { "id": "...", "name": "...", "description": "...", ... }
  ],
  "count": 10
}
```

### POST /api/apps

Publish new app.

**Headers:**
- `Authorization: Bearer <apiKey>`
- `X-App-ID: <appId>`
- `X-Version: <version>`
- `X-Metadata: <json>`

**Body:** tar.gz binary

**Response:**
```json
{
  "success": true,
  "appId": "...",
  "version": "...",
  "url": "https://registry.webmcp.dev/apps/app_id/1.0.0"
}
```

## Error Handling

**Error codes:**
- `REGISTRY_ERROR` — general registry failure
- `VALIDATION_ERROR` — YAML validation failed

**Common scenarios:**
- App not found: "App not found: app_id"
- Version conflict: "App already installed: app_id@version"
- Missing files: "Missing pages/ directory"
- Network error: "Pull failed: connection timeout"

## Test Scenarios

### 1. Install app from local directory

**Setup:** Valid app directory with all YAML files

**Test:** `registry.install('/path/to/app', 'my_app', '1.0.0')`

**Expected:** App installed to `~/.webmcp-bridge/registry/my_app/1.0.0/`

### 2. Get latest version

**Setup:** App with multiple versions installed

**Test:** `registry.getApp('my_app')`

**Expected:** Returns latest version (highest semantic version)

### 3. Search by name

**Setup:** Registry with 3 apps (including "Todo Manager")

**Test:** `registry.search('todo')`

**Expected:** Returns apps matching "todo" (case-insensitive)

### 4. Search by tags

**Setup:** Apps with tags

**Test:** `registry.search('', ['productivity', 'web'])`

**Expected:** Returns apps with both tags

### 5. Install missing required directory

**Setup:** App directory missing `tools/`

**Test:** `registry.install(...)`

**Expected:** err(REGISTRY_ERROR, "Missing tools/ directory")

### 6. Duplicate install

**Setup:** App already installed

**Test:** `registry.install(...)` again

**Expected:** err(REGISTRY_ERROR, "App already installed")

### 7. Publish to remote registry

**Setup:** Valid app, remote API configured

**Test:** `registry.publish('/path/to/app', remoteRegistry, 'my_app', '1.0.0')`

**Expected:** App posted to remote, receives 201 Created

### 8. Pull from remote registry

**Setup:** App available on remote registry

**Test:** `registry.pull('remote_app', '1.0.0', remoteRegistry)`

**Expected:** App downloaded and installed locally

### 9. List all apps

**Setup:** Registry with 3 apps

**Test:** `registry.listApps()`

**Expected:** Returns array of all 3 apps with metadata

### 10. Version management

**Setup:** Install v1.0.0 and v1.1.0 of same app

**Test:** `registry.listVersions('app_id')`

**Expected:** Returns ['1.0.0', '1.1.0'], latest is '1.1.0'
