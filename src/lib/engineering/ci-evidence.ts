import { verify } from "node:crypto";
import { EngineeringInputError } from "./policy";
import { commandArgs } from "./worker-policy";
import type { Ingress } from "./worker";
export type CiEvidence = { runId: string; cycle: number; revision: string; command: string; outcome: "passed" | "failed"; receipt: string; expiresAt: number };
/** Public key is pinned by the host operator, never supplied with the evidence. */
export function verifyCiEvidence(payload: string, signature: string, publicKey: string, expected: { runId: string; cycle: number; revision: string }, now = Date.now()): CiEvidence {
  if (Buffer.byteLength(payload) > 4000 || !verify(null, Buffer.from(payload), publicKey, Buffer.from(signature, "base64"))) throw new EngineeringInputError("CI attestation rejected.");
  const e = JSON.parse(payload) as CiEvidence;
  commandArgs(e.command);
  if (e.runId !== expected.runId || e.cycle !== expected.cycle || e.revision !== expected.revision || !/^[a-f0-9]{40}$/.test(e.revision) || !["passed", "failed"].includes(e.outcome) || !Number.isSafeInteger(e.expiresAt) || e.expiresAt <= now || e.expiresAt > now + 300000 || typeof e.receipt !== "string" || e.receipt.length < 1 || e.receipt.length > 120 || Object.keys(e).sort().join() !== "command,cycle,expiresAt,outcome,receipt,revision,runId") throw new EngineeringInputError("CI attestation scope/expiry rejected.");
  return e;
}
export async function ingestCiEvidence(ingress: Ingress, owner: string, epoch: number, payload: string, signature: string, pinnedPublicKey: string, expected: { runId: string; cycle: number; revision: string }) {
  const e = verifyCiEvidence(payload, signature, pinnedPublicKey, expected);
  return await ingress("validation", owner, epoch, { key: e.receipt, revision: e.revision, command: e.command, outcome: e.outcome, source: "ci", diagnostic: { command:e.command, outcome:e.outcome, exitCode:e.outcome === "passed" ? 0 : 1, containerExitCode:null, containerStatus:null, containerOomKilled:null, signal:null, timedOut:false, category:e.outcome === "passed" ? null : "command_failed", excerpt:[], failedTests:[], failedTestFiles:[] } });
}
