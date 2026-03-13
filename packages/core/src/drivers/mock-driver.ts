/**
 * MockDriver — test double for BridgeDriver.
 * Used by all unit tests in core. Allows recording + asserting calls.
 *
 * Implementation notes for agents:
 * - Every method records the call args and returns configurable responses
 * - Use mockDriver.whenFindElement(selectors).thenReturn(element)
 * - Use mockDriver.whenReadText(selectors).thenReturn("text")
 * - Use mockDriver.calls to inspect what was called
 */
import type { BridgeDriver } from '../types/bridge-driver.js';

export function createMockDriver(overrides?: Partial<BridgeDriver>): BridgeDriver {
  // TODO: Implement full mock — see test helpers pattern in AGENTS.md
  throw new Error('Not implemented — see spec: docs/specs/testing-spec.md');
}
