/**
 * Extension Service Worker — background orchestrator.
 *
 * Responsibilities:
 * - Listen for content script messages (page detected, DOM snapshot)
 * - Manage SemanticStore (load YAML from extension storage or remote)
 * - Run ExecutionEngine with ContentScriptDriver
 * - Handle side panel communication (capture mode, execute mode)
 * - Manage tool injection lifecycle
 *
 * Implementation notes for agents:
 * - NO DOM access — all DOM operations go through content script messaging
 * - Use chrome.runtime.onMessage for content script ↔ service worker
 * - Use chrome.sidePanel API for panel management
 * - SemanticStore and ExecutionEngine run here
 */
// TODO: Implement — see spec: docs/specs/extension-spec.md
export {};
