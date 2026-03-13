/**
 * pull command -- install an app from a source into the local registry.
 *
 * Usage: webmcp-bridge pull <app-id> [--version <version>] [--registry <url>]
 *
 * If --registry is provided, downloads from remote first.
 * Otherwise, installs from a local source path.
 */
import { LocalRegistry } from '@webmcp-bridge/registry';

export interface PullOptions {
  appId: string;
  version: string;
  sourcePath?: string;
  registryUrl?: string;
  apiKey?: string;
  localRegistryPath?: string;
}

export interface PullResult {
  success: boolean;
  installPath?: string;
  error?: string;
}

export async function pullCommand(options: PullOptions): Promise<PullResult> {
  // Validate inputs
  if (!options.appId) {
    return { success: false, error: 'App ID is required' };
  }

  const registry = new LocalRegistry(options.localRegistryPath);
  const sourcePath = options.sourcePath;

  if (!sourcePath) {
    return {
      success: false,
      error: 'Source path is required (remote registry pull not yet supported)',
    };
  }

  // Install from source to local registry
  try {
    await registry.install(options.appId, options.version, sourcePath);

    const installPath = await registry.resolve(options.appId, options.version);
    return { success: true, installPath: installPath ?? undefined };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
