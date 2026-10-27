import { describe } from "node:test";
import type { CursorBridgePollingConfig } from "./cursor-rest-config";

/** Bounded polling for unit tests — avoids multi-minute hangs on stuck RUNNING fakes. */
export const CURSOR_BRIDGE_TEST_POLLING: CursorBridgePollingConfig = {
  pollIntervalMs: 0,
  pollMaxDurationMs: 5_000,
  heartbeatMinIntervalMs: 0,
};

export const CURSOR_BRIDGE_TEST_TIMEOUT_MS = 45_000;

/** Node test runner has no setDefaultTimeout; suite timeout applies to child tests. */
export function describeCursorBridgeTests(
  suiteName: string,
  fn: () => void,
  timeoutMs: number = CURSOR_BRIDGE_TEST_TIMEOUT_MS,
): void {
  describe(suiteName, { timeout: timeoutMs }, fn);
}
