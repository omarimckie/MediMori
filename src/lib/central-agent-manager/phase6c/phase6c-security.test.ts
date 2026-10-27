import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { DurableObjectiveExecutionStore } from "./durable-objective-execution-store";
import { SupervisorContractError } from "../supervisor/types";
import { validateExternalExecutionReferences } from "../orchestration/external-execution-refs";

test("objective store rejects checksum tampering", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cam-6c-sec-"));
  const path = join(dir, "objectives.json");
  await writeFile(
    path,
    JSON.stringify({
      formatVersion: 2,
      checksum: "deadbeef",
      records: [],
    }),
    "utf8",
  );
  await assert.rejects(() => DurableObjectiveExecutionStore.open(path), SupervisorContractError);
  await rm(dir, { recursive: true, force: true });
});

test("external execution refs reject secret-like correlation keys", () => {
  assert.throws(() =>
    validateExternalExecutionReferences({
      correlationKey: "sk_" + "SYNTHETIC1234567890",
    }), /Rejected secret-like external reference field: correlationKey\./,
  );
});
