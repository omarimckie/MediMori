import assert from "node:assert/strict";
import test from "node:test";
import { SupervisorContractError } from "../supervisor/types";
import {
  consumeReservedBudget,
  createObjectiveBudgetLedger,
  releaseUnusedReservation,
  reserveObjectiveBudget,
} from "./objective-budget-ledger";

test("budget reservation prevents double spend and releases unused", () => {
  let ledger = createObjectiveBudgetLedger(3);
  ledger = reserveObjectiveBudget(ledger, 1);
  ledger = reserveObjectiveBudget(ledger, 0.5);
  assert.throws(() => reserveObjectiveBudget(ledger, 2), SupervisorContractError);
  ledger = consumeReservedBudget(ledger, 0.75);
  ledger = releaseUnusedReservation(ledger, 0.75);
  assert.equal(ledger.consumedUsd, 0.75);
  assert.equal(ledger.reservedUsd, 0);
});

test("concurrent reservation attempts fail closed when exhausted", () => {
  const ledger = createObjectiveBudgetLedger(1);
  const a = reserveObjectiveBudget(ledger, 0.6);
  const b = reserveObjectiveBudget(a, 0.4);
  assert.throws(() => reserveObjectiveBudget(b, 0.01), SupervisorContractError);
});
