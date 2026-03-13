/**
 * RemoteRegistry — HTTP client for the public WebMCP Bridge registry.
 *
 * The public registry allows communities to share semantic definitions
 * for common web applications. Think "npm registry" but for page semantics.
 *
 * API endpoints (to be implemented server-side separately):
 * - GET  /api/v1/apps                    → list all published apps
 * - GET  /api/v1/apps/:id                → app metadata + versions
 * - GET  /api/v1/apps/:id/:version       → download semantic bundle (tar.gz)
 * - POST /api/v1/apps                    → publish new app (auth required)
 * - GET  /api/v1/search?q=...&tags=...   → search apps
 *
 * The client:
 * - Fetches metadata and bundles from the remote
 * - Installs to LocalRegistry
 * - Handles authentication for publish
 * - Validates bundles before publish
 */
export class RemoteRegistry {
  constructor(
    private baseUrl: string,
    private authToken?: string,
  ) {}

  async search(query: string, tags?: string[]): Promise<unknown[]> {
    throw new Error('Not implemented — see spec: docs/specs/registry-spec.md');
  }

  async pull(appId: string, version?: string): Promise<string> {
    // Returns path to downloaded bundle
    throw new Error('Not implemented');
  }

  async publish(appId: string, version: string, bundlePath: string): Promise<void> {
    throw new Error('Not implemented');
  }

  async getAppInfo(appId: string): Promise<unknown> {
    throw new Error('Not implemented');
  }
}
