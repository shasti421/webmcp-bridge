/**
 * Tool Injector — navigator.modelContext polyfill.
 *
 * Injects a polyfill for the W3C WebMCP API (navigator.modelContext)
 * that maps to bridge tool definitions. When a native WebMCP agent
 * calls navigator.modelContext.tools, it gets bridge-generated tools.
 *
 * Also handles graceful handoff: if the page already has native
 * WebMCP tools, bridge defers to native for matching tool names.
 */
// TODO: Implement — see spec: docs/specs/tool-injector-spec.md
export {};
