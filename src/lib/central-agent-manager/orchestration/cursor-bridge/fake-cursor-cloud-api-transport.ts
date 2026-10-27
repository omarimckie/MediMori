import type { CursorCloudApiTransport } from "./cursor-cloud-api-transport";
import type {
  CursorCloudCreateAgentRequest,
  CursorCloudCreateAgentResult,
  CursorCloudRunSnapshot,
  CursorCloudRunStatus,
} from "./cursor-bridge-types";

type FakeRunRecord = {
  request: CursorCloudCreateAgentRequest;
  status: CursorCloudRunStatus;
  artifactPath: string;
  diagnostic?: string;
  failCreate?: boolean;
};

let fakeAgentSequence = 0;
let fakeRunSequence = 0;

export class FakeCursorCloudApiTransport implements CursorCloudApiTransport {
  readonly runs = new Map<string, FakeRunRecord>();
  createCallCount = 0;
  private createShouldFail = false;
  private pollCountBeforeFinished = 1;

  configureCreateFailure(shouldFail: boolean): void {
    this.createShouldFail = shouldFail;
  }

  configurePollsBeforeFinished(count: number): void {
    this.pollCountBeforeFinished = Math.max(1, count);
  }

  configureImmediateTerminal(status: "ERROR" | "CANCELLED" | "EXPIRED", diagnostic?: string): void {
    this.immediateTerminal = { status, diagnostic };
  }

  private immediateTerminal?: { status: "ERROR" | "CANCELLED" | "EXPIRED"; diagnostic?: string };

  private runKey(agentId: string, runId: string): string {
    return `${agentId}:${runId}`;
  }

  async createAgentWithInitialRun(request: CursorCloudCreateAgentRequest): Promise<CursorCloudCreateAgentResult> {
    this.createCallCount += 1;
    if (this.createShouldFail) {
      throw new Error("Fake Cursor API: createAgentWithInitialRun failed.");
    }
    fakeAgentSequence += 1;
    fakeRunSequence += 1;
    const agentId = `bc-fake-${String(fakeAgentSequence).padStart(8, "0")}`;
    const runId = `run-fake-${String(fakeRunSequence).padStart(8, "0")}`;
    this.runs.set(this.runKey(agentId, runId), {
      request,
      status: "CREATING",
      artifactPath: `artifacts/cursor-bridge/${runId}/outcome.json`,
    });
    return { agentId, runId };
  }

  async getRun(agentId: string, runId: string): Promise<CursorCloudRunSnapshot> {
    const record = this.runs.get(this.runKey(agentId, runId));
    if (!record) {
      throw new Error("Fake Cursor API: unknown run.");
    }
    if (this.immediateTerminal) {
      record.status = this.immediateTerminal.status;
      record.diagnostic = this.immediateTerminal.diagnostic;
      this.immediateTerminal = undefined;
      return {
        agentId,
        runId,
        status: record.status,
        diagnostic: record.diagnostic ?? "Fake terminal failure.",
      };
    }
    if (record.status === "ERROR" || record.status === "CANCELLED" || record.status === "EXPIRED") {
      return {
        agentId,
        runId,
        status: record.status,
        diagnostic: record.diagnostic ?? "Fake terminal failure.",
      };
    }
    if (record.status === "FINISHED") {
      return {
        agentId,
        runId,
        status: "FINISHED",
        artifactPath: record.artifactPath,
        diagnostic: record.diagnostic,
      };
    }
    const polls = (record as FakeRunRecord & { polls?: number }).polls ?? 0;
    const nextPolls = polls + 1;
    (record as FakeRunRecord & { polls?: number }).polls = nextPolls;
    if (nextPolls < this.pollCountBeforeFinished) {
      record.status = "RUNNING";
      return {
        agentId,
        runId,
        status: "RUNNING",
        diagnostic: `Poll ${nextPolls} in progress.`,
      };
    }
    record.status = "FINISHED";
    return {
      agentId,
      runId,
      status: "FINISHED",
      artifactPath: record.artifactPath,
      diagnostic: "Fake run completed.",
    };
  }

  markRunTerminal(agentId: string, runId: string, status: "ERROR" | "CANCELLED" | "EXPIRED", diagnostic?: string): void {
    const record = this.runs.get(this.runKey(agentId, runId));
    if (!record) throw new Error("Fake Cursor API: unknown run.");
    record.status = status;
    record.diagnostic = diagnostic;
  }
}
