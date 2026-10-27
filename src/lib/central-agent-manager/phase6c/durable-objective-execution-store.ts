import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { SupervisorContractError } from "../supervisor/types";
import {
  createObjectiveExecutionRecord,
  validateObjectiveExecutionRecord,
  type ObjectiveExecutionRecordV1,
} from "../phase6b/objective-execution-record";
import type { ObjectivePlanV1 } from "../phase6a/objective-plan";
import {
  deserializeClosedLoopManagerState,
  serializeClosedLoopManagerState,
} from "./closed-loop-persistence";
import {
  createObjectiveBudgetLedger,
  type ObjectiveBudgetLedgerV1,
} from "./objective-budget-ledger";
import type {
  ObjectiveExecutionStorePort,
  ObjectivePersistencePutOptions,
  PersistedObjectiveExecutionRecordV2,
} from "./objective-persistence-port";
import type { OwnerProgressReportV1 } from "../phase6a/owner-progress-report";
import type { ObjectiveSqlPort } from "../phase6d/objective-sql-port";

export const OBJECTIVE_STORE_DOCUMENT_VERSION = 2 as const;

export type ObjectiveStoreDocumentV2 = {
  formatVersion: typeof OBJECTIVE_STORE_DOCUMENT_VERSION;
  checksum: string;
  records: PersistedObjectiveExecutionRecordV2[];
};

function checksumForPayload(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/** JSONB round-trip stable checksum for SQL persistence. */
function checksumForObjectiveDocument(documentJson: string): string {
  return checksumForPayload(JSON.stringify(JSON.parse(documentJson)));
}

function runtimeToPersistedRow(
  record: ObjectiveExecutionRecordV1,
  existing: PersistedObjectiveExecutionRecordV2 | undefined,
  nextFence: number,
): PersistedObjectiveExecutionRecordV2 {
  const closedLoop = serializeClosedLoopManagerState(record.closedLoop);
  if (!existing) {
    return {
      contractVersion: "cam-persisted-objective/v2",
      record: { ...record, closedLoop },
      recordFence: nextFence,
      acceptedOutcomeKeys: [],
      budgetLedger: createObjectiveBudgetLedger(record.plan.budgetUsd),
      persistedOwnerReport: null,
    };
  }
  return {
    ...existing,
    record: { ...record, closedLoop },
    recordFence: nextFence,
  };
}

function fromPersisted(row: PersistedObjectiveExecutionRecordV2): ObjectiveExecutionRecordV1 {
  const closedLoop = deserializeClosedLoopManagerState(row.record.closedLoop);
  const runtime: ObjectiveExecutionRecordV1 = {
    ...row.record,
    closedLoop,
  };
  validateObjectiveExecutionRecord(runtime);
  return runtime;
}

export type DurableObjectiveStoreBackend =
  | { kind: "memory" }
  | { kind: "file"; filePath: string }
  | { kind: "sql"; sqlPort: ObjectiveSqlPort };

export class DurableObjectiveExecutionStore implements ObjectiveExecutionStorePort {
  private readonly rows = new Map<string, PersistedObjectiveExecutionRecordV2>();
  private readonly idempotency = new Map<string, string>();
  private readonly backend: DurableObjectiveStoreBackend;
  private dirty = false;
  private flushChain: Promise<void> = Promise.resolve();
  /** Last fence successfully persisted to SQL per objective (optimistic concurrency baseline). */
  private readonly lastPersistedSqlFence = new Map<string, number>();

  constructor(backend: DurableObjectiveStoreBackend | string = { kind: "memory" }) {
    if (typeof backend === "string") {
      this.backend = { kind: "file", filePath: backend };
      return;
    }
    this.backend = backend;
  }

  static async open(filePath: string): Promise<DurableObjectiveExecutionStore> {
    const store = new DurableObjectiveExecutionStore({ kind: "file", filePath });
    await store.loadFromFile();
    return store;
  }

  static async openSql(sqlPort: ObjectiveSqlPort): Promise<DurableObjectiveExecutionStore> {
    const store = new DurableObjectiveExecutionStore({ kind: "sql", sqlPort });
    await store.loadFromSqlPort();
    return store;
  }

  get(objectiveId: string): ObjectiveExecutionRecordV1 | null {
    const row = this.rows.get(objectiveId);
    return row ? fromPersisted(row) : null;
  }

  getFence(objectiveId: string): number | null {
    return this.rows.get(objectiveId)?.recordFence ?? null;
  }

  getAcceptedOutcomeKeys(objectiveId: string): readonly string[] {
    return this.rows.get(objectiveId)?.acceptedOutcomeKeys ?? [];
  }

  markOutcomeAccepted(objectiveId: string, outcomeKey: string, options?: ObjectivePersistencePutOptions): void {
    const row = this.requireRow(objectiveId);
    if (row.acceptedOutcomeKeys.includes(outcomeKey)) return;
    const fence = row.recordFence;
    if (options?.expectedFence !== undefined && options.expectedFence !== fence) {
      throw new SupervisorContractError("Objective record fence mismatch.");
    }
    this.rows.set(objectiveId, {
      ...row,
      acceptedOutcomeKeys: [...row.acceptedOutcomeKeys, outcomeKey],
      recordFence: fence + 1,
    });
    this.dirty = true;
  }

  getBudgetLedger(objectiveId: string): ObjectiveBudgetLedgerV1 | null {
    return this.rows.get(objectiveId)?.budgetLedger ?? null;
  }

  updateBudgetLedger(
    objectiveId: string,
    ledger: ObjectiveBudgetLedgerV1,
    options?: ObjectivePersistencePutOptions,
  ): void {
    const row = this.requireRow(objectiveId);
    const fence = row.recordFence;
    if (options?.expectedFence !== undefined && options.expectedFence !== fence) {
      throw new SupervisorContractError("Objective record fence mismatch.");
    }
    this.rows.set(objectiveId, { ...row, budgetLedger: ledger, recordFence: fence + 1 });
    this.dirty = true;
  }

  getPersistedOwnerReport(objectiveId: string): OwnerProgressReportV1 | null {
    return this.rows.get(objectiveId)?.persistedOwnerReport ?? null;
  }

  setPersistedOwnerReport(
    objectiveId: string,
    report: OwnerProgressReportV1 | null,
    options?: ObjectivePersistencePutOptions,
  ): void {
    const row = this.requireRow(objectiveId);
    const fence = row.recordFence;
    if (options?.expectedFence !== undefined && options.expectedFence !== fence) {
      throw new SupervisorContractError("Objective record fence mismatch.");
    }
    this.rows.set(objectiveId, { ...row, persistedOwnerReport: report, recordFence: fence + 1 });
    this.dirty = true;
  }

  put(record: ObjectiveExecutionRecordV1, options?: ObjectivePersistencePutOptions): void {
    validateObjectiveExecutionRecord(record);
    const existing = this.rows.get(record.objectiveId);
    const fence = existing?.recordFence ?? 0;
    if (options?.expectedFence !== undefined && options.expectedFence !== fence) {
      throw new SupervisorContractError("Objective record fence mismatch.");
    }
    const nextFence = existing ? fence + 1 : 1;
    const row = runtimeToPersistedRow(record, existing, nextFence);
    this.rows.set(record.objectiveId, row);
    this.idempotency.set(record.idempotencyKey, record.objectiveId);
    this.dirty = true;
  }

  submitIdempotent(input: {
    plan: ObjectivePlanV1;
    idempotencyKey: string;
    now: string;
    maxConcurrentTasks?: number;
  }): { record: ObjectiveExecutionRecordV1; created: boolean } {
    const existingId = this.idempotency.get(input.idempotencyKey);
    if (existingId) {
      const existing = this.get(existingId);
      if (!existing) throw new SupervisorContractError("Idempotency index corrupted.");
      return { record: existing, created: false };
    }
    const record = createObjectiveExecutionRecord(input);
    record.lifecycleState = "executing";
    record.updatedAt = input.now;
    this.put(record);
    return { record, created: true };
  }

  async flush(): Promise<void> {
    this.flushChain = this.flushChain.then(() => this.flushOnce());
    await this.flushChain;
  }

  private async flushOnce(): Promise<void> {
    if (!this.dirty) return;
    if (this.backend.kind === "sql") {
      await this.flushToSql();
      return;
    }
    const filePath = this.backend.kind === "file" ? this.backend.filePath : undefined;
    if (!filePath) {
      this.dirty = false;
      return;
    }
    const bodyWithoutChecksum = JSON.stringify({
      formatVersion: OBJECTIVE_STORE_DOCUMENT_VERSION,
      records: [...this.rows.values()].sort((a, b) =>
        a.record.objectiveId.localeCompare(b.record.objectiveId),
      ),
    });
    const checksum = checksumForPayload(bodyWithoutChecksum);
    const document: ObjectiveStoreDocumentV2 = JSON.parse(bodyWithoutChecksum);
    document.checksum = checksum;
    const serialized = JSON.stringify(document);
    const verify = checksumForPayload(
      JSON.stringify({ formatVersion: document.formatVersion, records: document.records }),
    );
    if (verify !== checksum) {
      throw new SupervisorContractError("Objective store checksum generation failed.");
    }
    await mkdir(dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp`;
    await writeFile(tempPath, serialized, "utf8");
    try {
      await rename(tempPath, filePath);
    } catch {
      await writeFile(filePath, serialized, "utf8");
    }
    this.dirty = false;
  }

  private async flushToSql(): Promise<void> {
    if (this.backend.kind !== "sql") return;
    const sql = this.backend.sqlPort;
    for (const row of this.rows.values()) {
      const objectiveId = row.record.objectiveId;
      const documentJson = JSON.stringify(row);
      const checksum = checksumForPayload(JSON.stringify(JSON.parse(documentJson)));
      const lastFence = this.lastPersistedSqlFence.get(objectiveId);
      const expectedFence =
        lastFence !== undefined ? lastFence : row.recordFence === 1 ? null : row.recordFence - 1;
      const ok = await sql.upsertObjective({
        row: {
          objective_id: objectiveId,
          idempotency_key: row.record.idempotencyKey,
          record_fence: row.recordFence,
          document_json: documentJson,
          checksum,
          updated_at: row.record.updatedAt,
        },
        expectedFence,
      });
      if (!ok) {
        throw new SupervisorContractError("Objective SQL fence conflict during flush.");
      }
      this.lastPersistedSqlFence.set(objectiveId, row.recordFence);
    }
    this.dirty = false;
  }

  async reloadFromBackend(): Promise<void> {
    if (this.backend.kind === "sql") {
      await this.loadFromSqlPort();
      return;
    }
    if (this.backend.kind === "file") {
      await this.loadFromFile();
    }
  }

  async loadFromSqlPort(): Promise<void> {
    if (this.backend.kind !== "sql") return;
    const loaded = await this.backend.sqlPort.loadObjectives();
    this.rows.clear();
    this.idempotency.clear();
    for (const sqlRow of loaded) {
      const parsed = JSON.parse(sqlRow.document_json) as PersistedObjectiveExecutionRecordV2;
      const canonicalDocument = JSON.stringify(parsed);
      if (checksumForPayload(canonicalDocument) !== sqlRow.checksum) {
        throw new SupervisorContractError("Objective SQL checksum mismatch — fail-closed.");
      }
      validateObjectiveExecutionRecord(fromPersisted(parsed));
      this.rows.set(parsed.record.objectiveId, parsed);
      this.idempotency.set(parsed.record.idempotencyKey, parsed.record.objectiveId);
      this.lastPersistedSqlFence.set(parsed.record.objectiveId, parsed.recordFence);
    }
    this.dirty = false;
  }

  async loadFromFile(): Promise<void> {
    if (this.backend.kind !== "file") return;
    const filePath = this.backend.filePath;
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as ObjectiveStoreDocumentV2;
      if (parsed.formatVersion !== OBJECTIVE_STORE_DOCUMENT_VERSION) {
        throw new SupervisorContractError("Unsupported objective store format version.");
      }
      const body = JSON.stringify({ formatVersion: parsed.formatVersion, records: parsed.records });
      if (checksumForPayload(body) !== parsed.checksum) {
        throw new SupervisorContractError("Objective store checksum mismatch — fail-closed.");
      }
      this.rows.clear();
      this.idempotency.clear();
      for (const row of parsed.records) {
        validateObjectiveExecutionRecord(fromPersisted(row));
        this.rows.set(row.record.objectiveId, row);
        this.idempotency.set(row.record.idempotencyKey, row.record.objectiveId);
      }
      this.dirty = false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }

  private requireRow(objectiveId: string): PersistedObjectiveExecutionRecordV2 {
    const row = this.rows.get(objectiveId);
    if (!row) throw new SupervisorContractError("Unknown objective.");
    return row;
  }

}

/** In-process durable store without a file path (integration tests). */
export function createMemoryDurableObjectiveStore(): DurableObjectiveExecutionStore {
  return new DurableObjectiveExecutionStore({ kind: "memory" });
}
