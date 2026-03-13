/**
 * Driver module — re-exports the BridgeDriver interface.
 * Actual implementations live in:
 *   - packages/playwright (PlaywrightDriver)
 *   - packages/extension (ContentScriptDriver)
 *
 * This module also exports a MockDriver factory for testing.
 */
export type { BridgeDriver } from '../types/bridge-driver.js';
export { createMockDriver } from './mock-driver.js';
