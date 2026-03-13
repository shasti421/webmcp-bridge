/**
 * Content Script — DOM observer + page detector.
 *
 * Responsibilities:
 * - Observe DOM mutations (MutationObserver) to detect page changes
 * - Match current URL against loaded app url_patterns
 * - Take DOM snapshots for capture mode and healing
 * - Execute element interactions on behalf of service worker
 * - Inject navigator.modelContext polyfill (tool-injector)
 *
 * Implementation notes for agents:
 * - Runs in page context (has DOM access)
 * - Communicates with service worker via chrome.runtime.sendMessage
 * - MutationObserver watches for significant DOM changes (not every mutation)
 * - Debounce DOM change notifications (500ms)
 */
// TODO: Implement — see spec: docs/specs/extension-spec.md
export {};
