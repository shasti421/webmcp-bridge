/**
 * LocalRegistry — file-system based semantic definition storage.
 *
 * Default location: ~/.webmcp-bridge/registry/
 * Structure:
 *   ~/.webmcp-bridge/registry/
 *     <app-id>/
 *       <version>/
 *         app.yaml
 *         pages/*.yaml
 *         tools/*.yaml
 *         workflows/*.yaml
 *         metadata.json   <- publisher, tags, created_at
 *     registry-index.json
 *
 * Operations:
 * - install(appId, version, sourcePath) -> copies from source to registry
 * - uninstall(appId, version) -> removes from registry
 * - list() -> all installed apps + versions
 * - listVersions(appId) -> versions for a given app
 * - resolve(appId, version?) -> path to semantic directory
 * - search(query) -> matching entries by name, tags, description
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import * as yaml from 'js-yaml';

export interface RegistryMetadata {
  appId: string;
  name: string;
  version: string;
  description: string;
  publisher: string;
  tags: string[];
  license: string;
  baseUrl: string;
  urlPatterns: string[];
  pageCount: number;
  toolCount: number;
  workflowCount: number;
  installedAt: string;
  lastUpdated: string;
}

export interface RegistryIndexEntry {
  versions: string[];
  latest: string;
  metadata: Partial<RegistryMetadata>;
}

export interface RegistryIndex {
  [appId: string]: RegistryIndexEntry;
}

export interface ListEntry {
  appId: string;
  versions: string[];
  latest: string;
  metadata: Partial<RegistryMetadata>;
}

export interface SearchResult {
  appId: string;
  description: string;
  tags: string[];
  name: string;
  versions: string[];
  latest: string;
}

export class LocalRegistry {
  private readonly basePath: string;

  constructor(basePath?: string) {
    this.basePath =
      basePath ?? path.join(os.homedir(), '.webmcp-bridge', 'registry');
  }

  /**
   * Install an app from a local directory into the registry.
   */
  async install(
    appId: string,
    version: string,
    sourcePath: string,
  ): Promise<void> {
    // Step 1: Validate source directory structure
    this.validateAppDirectory(sourcePath);

    // Step 2: Check if already installed
    const installPath = path.join(this.basePath, appId, version);
    if (fs.existsSync(installPath)) {
      throw new Error(
        `App already installed: ${appId}@${version}`,
      );
    }

    // Step 3: Create install directory and copy files
    fs.mkdirSync(installPath, { recursive: true });
    this.copyRecursive(sourcePath, installPath);

    // Step 4: Build and save metadata
    const metadata = this.buildMetadata(sourcePath, appId, version);
    this.saveMetadata(installPath, metadata);

    // Step 5: Update registry index
    this.updateIndex(appId, version, metadata);
  }

  /**
   * Remove an app version from the registry.
   */
  async uninstall(appId: string, version: string): Promise<void> {
    const installPath = path.join(this.basePath, appId, version);
    if (!fs.existsSync(installPath)) {
      throw new Error(
        `App not found: ${appId}@${version}`,
      );
    }

    // Remove version directory
    fs.rmSync(installPath, { recursive: true, force: true });

    // Update index
    const index = this.loadIndex();
    const entry = index[appId];
    if (entry) {
      entry.versions = entry.versions.filter((v) => v !== version);
      if (entry.versions.length === 0) {
        delete index[appId];
        // Remove app directory if empty
        const appDir = path.join(this.basePath, appId);
        if (fs.existsSync(appDir)) {
          const remaining = fs.readdirSync(appDir);
          if (remaining.length === 0) {
            fs.rmSync(appDir, { recursive: true, force: true });
          }
        }
      } else {
        // Update latest to the most recently added remaining version
        entry.latest = entry.versions[entry.versions.length - 1]!;
      }
      this.saveIndex(index);
    }
  }

  /**
   * List all installed apps with their versions.
   */
  async list(): Promise<ListEntry[]> {
    const index = this.loadIndex();
    const results: ListEntry[] = [];

    for (const [appId, entry] of Object.entries(index)) {
      results.push({
        appId,
        versions: entry.versions,
        latest: entry.latest,
        metadata: entry.metadata,
      });
    }

    return results;
  }

  /**
   * List all versions of a specific app.
   */
  async listVersions(appId: string): Promise<string[]> {
    const index = this.loadIndex();
    const entry = index[appId];
    return entry ? [...entry.versions] : [];
  }

  /**
   * Resolve the filesystem path for an app version.
   * If no version specified, resolves to latest.
   * Returns null if not found.
   */
  async resolve(appId: string, version?: string): Promise<string | null> {
    const index = this.loadIndex();
    const entry = index[appId];

    if (!entry) {
      return null;
    }

    const targetVersion = version ?? entry.latest;
    if (!entry.versions.includes(targetVersion)) {
      return null;
    }

    const resolvedPath = path.join(this.basePath, appId, targetVersion);
    if (!fs.existsSync(resolvedPath)) {
      return null;
    }

    return resolvedPath;
  }

  /**
   * Search for apps by name, description, or app ID.
   */
  async search(
    query: string,
  ): Promise<SearchResult[]> {
    const index = this.loadIndex();
    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();

    for (const [appId, entry] of Object.entries(index)) {
      const metadata = entry.metadata;
      const name = (metadata.name ?? '').toLowerCase();
      const description = (metadata.description ?? '').toLowerCase();
      const appIdLower = appId.toLowerCase();

      if (
        queryLower === '' ||
        name.includes(queryLower) ||
        description.includes(queryLower) ||
        appIdLower.includes(queryLower)
      ) {
        results.push({
          appId,
          name: metadata.name ?? appId,
          description: metadata.description ?? '',
          tags: metadata.tags ?? [],
          versions: entry.versions,
          latest: entry.latest,
        });
      }
    }

    return results;
  }

  // ─── Private helpers ──────────────────────────────────────

  private validateAppDirectory(dirPath: string): void {
    if (!fs.existsSync(path.join(dirPath, 'app.yaml'))) {
      throw new Error('Missing app.yaml in source directory');
    }
    if (!fs.existsSync(path.join(dirPath, 'pages'))) {
      throw new Error('Missing pages/ directory in source');
    }
    if (!fs.existsSync(path.join(dirPath, 'tools'))) {
      throw new Error('Missing tools/ directory in source');
    }
  }

  private copyRecursive(src: string, dest: string): void {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        this.copyRecursive(srcPath, destPath);
      } else if (entry.isFile()) {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  private buildMetadata(
    sourcePath: string,
    appId: string,
    version: string,
  ): RegistryMetadata {
    const appYamlPath = path.join(sourcePath, 'app.yaml');
    const appYaml = yaml.load(
      fs.readFileSync(appYamlPath, 'utf-8'),
    ) as Record<string, unknown>;

    // Handle wrapper key: { app: { ... } } -> { ... }
    const appData =
      appYaml && typeof appYaml === 'object' && 'app' in appYaml
        ? (appYaml['app'] as Record<string, unknown>)
        : appYaml;

    const pagesDir = path.join(sourcePath, 'pages');
    const toolsDir = path.join(sourcePath, 'tools');
    const workflowsDir = path.join(sourcePath, 'workflows');

    const pageCount = this.countYamlFiles(pagesDir);
    const toolCount = this.countYamlFiles(toolsDir);
    const workflowCount = fs.existsSync(workflowsDir)
      ? this.countYamlFiles(workflowsDir)
      : 0;

    const registryMeta = (appData['registry'] ?? {}) as Record<string, unknown>;
    const now = new Date().toISOString();

    return {
      appId,
      name: (appData['name'] as string) ?? appId,
      version,
      description: (appData['description'] as string) ?? '',
      publisher: (registryMeta['publisher'] as string) ?? '',
      tags: (registryMeta['tags'] as string[]) ?? [],
      license: (registryMeta['license'] as string) ?? 'MIT',
      baseUrl: (appData['base_url'] as string) ?? '',
      urlPatterns: (appData['url_patterns'] as string[]) ?? [],
      pageCount,
      toolCount,
      workflowCount,
      installedAt: now,
      lastUpdated: now,
    };
  }

  private countYamlFiles(dirPath: string): number {
    if (!fs.existsSync(dirPath)) return 0;
    return fs
      .readdirSync(dirPath)
      .filter((f) => /\.(yaml|yml)$/i.test(f)).length;
  }

  private saveMetadata(
    installPath: string,
    metadata: RegistryMetadata,
  ): void {
    fs.writeFileSync(
      path.join(installPath, 'metadata.json'),
      JSON.stringify(metadata, null, 2),
      'utf-8',
    );
  }

  private loadIndex(): RegistryIndex {
    const indexPath = path.join(this.basePath, 'registry-index.json');
    if (!fs.existsSync(indexPath)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as RegistryIndex;
  }

  private saveIndex(index: RegistryIndex): void {
    fs.mkdirSync(this.basePath, { recursive: true });
    fs.writeFileSync(
      path.join(this.basePath, 'registry-index.json'),
      JSON.stringify(index, null, 2),
      'utf-8',
    );
  }

  private updateIndex(
    appId: string,
    version: string,
    metadata: RegistryMetadata,
  ): void {
    const index = this.loadIndex();

    if (!index[appId]) {
      index[appId] = { versions: [], latest: version, metadata: {} };
    }

    const entry = index[appId]!;
    if (!entry.versions.includes(version)) {
      entry.versions.push(version);
    }
    entry.latest = version;
    entry.metadata = metadata;

    this.saveIndex(index);
  }
}
