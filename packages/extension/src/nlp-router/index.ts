/**
 * NLP Router — maps natural language user commands to tool calls.
 *
 * In Execute Mode, business users type commands like "close case 12345".
 * This module sends the command + available tool schemas to an LLM
 * and receives back a structured tool call.
 *
 * Uses Strands Agents (via a lightweight JS bridge or direct API call)
 * or any LLM provider configured by the user.
 */
// TODO: Implement — see spec: docs/specs/nlp-router-spec.md
export {};
