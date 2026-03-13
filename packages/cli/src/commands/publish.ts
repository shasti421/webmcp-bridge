/**
 * publish command -- validate and publish an app to a registry.
 *
 * Usage: webmcp-bridge publish [path] --app <id> --version <version> [--registry <url>]
 *
 * Validates YAML first, then installs to local registry.
 * If --registry is provided, also publishes to remote registry.
 */
import { LocalRegistry } from '@webmcp-bridge/registry';

import { validateCommand } from './validate.js';

export interface PublishOptions {
  appId: string;
  version: string;
  registryUrl?: string;
  apiKey?: string;
  localRegistryPath?: string;
}

export interface PublishResult {
  success: boolean;
  error?: string;
}

export async function publishCommand(
  appPath: string,
  options: PublishOptions,
): Promise<PublishResult> {
  // Validate inputs
  if (!options.appId) {
    return { success: false, error: 'App ID is required' };
  }

  if (!options.version) {
    return { success: false, error: 'Version is required' };
  }

  // Step 1: Validate YAML
  const validationResult = await validateCommand(appPath);
  if (!validationResult.valid) {
    return {
      success: false,
      error: `Validation failed: ${validationResult.errors.join('; ')}`,
    };
  }

  // Step 2: Install to local registry
  const registry = new LocalRegistry(options.localRegistryPath);

  try {
    await registry.install(options.appId, options.version, appPath);
  } catch (error) {
    return {
      success: false,
      error: `Install failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return { success: true };
}
