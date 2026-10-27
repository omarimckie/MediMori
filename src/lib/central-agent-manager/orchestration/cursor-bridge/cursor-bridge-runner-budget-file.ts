import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  normalizeBudgetState,
  type CursorBridgeRunnerBudgetState,
} from "./cursor-bridge-runner-budget";

export const BUDGET_FILE_UNREADABLE_CODE = "budget_file_unreadable";

export class CursorBridgeRunnerBudgetFileError extends Error {
  readonly code = BUDGET_FILE_UNREADABLE_CODE;

  constructor(message: string) {
    super(message);
    this.name = "CursorBridgeRunnerBudgetFileError";
  }
}

function isBudgetRecord(value: unknown): value is CursorBridgeRunnerBudgetState {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.dayKey === "string" &&
    typeof row.hourKey === "string" &&
    typeof row.createsToday === "number" &&
    Number.isFinite(row.createsToday) &&
    row.createsToday >= 0 &&
    typeof row.cyclesThisHour === "number" &&
    Number.isFinite(row.cyclesThisHour) &&
    row.cyclesThisHour >= 0
  );
}

function parseBudgetFileContents(raw: string): CursorBridgeRunnerBudgetState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CursorBridgeRunnerBudgetFileError("Budget state file contains invalid JSON.");
  }
  if (!isBudgetRecord(parsed)) {
    throw new CursorBridgeRunnerBudgetFileError("Budget state file has an invalid shape.");
  }
  return parsed;
}

/** Missing file → zero usage. Corrupt or unreadable file → throws (fail closed). */
export async function loadBudgetStateFromFile(
  budgetPath: string,
  now: Date,
): Promise<CursorBridgeRunnerBudgetState> {
  try {
    const raw = await readFile(budgetPath, "utf8");
    return normalizeBudgetState(parseBudgetFileContents(raw), now);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return normalizeBudgetState(null, now);
    }
    if (error instanceof CursorBridgeRunnerBudgetFileError) {
      throw error;
    }
    throw new CursorBridgeRunnerBudgetFileError(
      error instanceof Error ? error.message : "Budget state file is unreadable.",
    );
  }
}

export async function saveBudgetStateToFile(
  budgetPath: string,
  state: CursorBridgeRunnerBudgetState,
): Promise<void> {
  await mkdir(dirname(budgetPath), { recursive: true });
  const tempPath = `${budgetPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, JSON.stringify(state), { encoding: "utf8", flag: "w" });
  await rename(tempPath, budgetPath);
}
