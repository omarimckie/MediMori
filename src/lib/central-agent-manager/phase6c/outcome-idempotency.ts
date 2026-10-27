export function buildTerminalOutcomeKey(jobId: string, terminalState: "completed" | "failed"): string {
  return `job:${jobId}:${terminalState}`;
}

export function hasAcceptedOutcome(keys: readonly string[], outcomeKey: string): boolean {
  return keys.includes(outcomeKey);
}
