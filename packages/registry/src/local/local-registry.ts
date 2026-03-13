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
 *         metadata.json   ← publisher, tags, created_at
 *
 * Operations:
 * - install(appId, version, sourcePath) → copies from source to registry
 * - uninstall(appId, version) → removes from registry
 * - list() → all installed apps + versions
 * - resolve(appId, version?) → path to semantic directory
 * - search(query) → matching entries by name, tags, description
 */
export class LocalRegistry {
  constructor(private basePath?: string) {
    // Default: ~/.webmcp-bridge/registry/
  }

  async install(appId: string, version: string, sourcePath: string): Promise<void> {
    throw new Error('Not implemented — see spec: docs/specs/registry-spec.md');
  }

  async uninstall(appId: string, version: string): Promise<void> {
    throw new Error('Not implemented');
  }

  async list(): Promise<Array<{ appId: string; versions: string[] }>> {
    throw new Error('Not implemented');
  }

  async resolve(appId: string, version?: string): Promise<string | null> {
    throw new Error('Not implemented');
  }

  async search(query: string): Promise<Array<{ appId: string; description: string; tags: string[] }>> {
    throw new Error('Not implemented');
  }
}
