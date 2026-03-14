/**
 * AI Session Analyzer — sends recorded session to the local analysis
 * server which calls Bedrock Claude and returns semantic definitions.
 *
 * The analysis server runs at http://localhost:3456 and handles the
 * AWS SDK / Bedrock integration in Node.js (which can't run in a
 * browser extension context).
 *
 * Start the server: npx tsx scripts/analyze-server.ts
 */

import type { RecordedAction } from '../reducer.js';

// ─── Types ──────────────────────────────────────────────

export interface SessionData {
  actions: RecordedAction[];
  pages: string[];
  startedAt: number;
  duration: number;
}

export interface AnalyzerResult {
  pages: Array<Record<string, unknown>>;
  tools: Array<Record<string, unknown>>;
  workflows: Array<Record<string, unknown>>;
  suggestions: string[];
}

// ─── Config ─────────────────────────────────────────────

const ANALYZER_URL = 'http://localhost:3456/analyze';

// ─── Public API ─────────────────────────────────────────

export async function analyzeSession(session: SessionData): Promise<AnalyzerResult> {
  const response = await fetch(ANALYZER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error');
    throw new Error(`Analysis server error (${response.status}): ${errorBody}`);
  }

  const result = await response.json();

  return {
    pages: result.pages || [],
    tools: result.tools || [],
    workflows: result.workflows || [],
    suggestions: result.suggestions || [],
  };
}
