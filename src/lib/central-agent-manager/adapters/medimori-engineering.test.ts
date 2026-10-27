import assert from "node:assert/strict";
import test from "node:test";
import { createMediMoriEngineeringAdapter } from "./medimori-engineering";

test("medimori engineering adapter reports disconnected when control plane disabled", async () => {
  const previous = process.env.ENGINEERING_CONTROL_PLANE_ENABLED;
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "false";
  try {
    const snapshot = await createMediMoriEngineeringAdapter().fetchSnapshot();
    assert.equal(snapshot.connection, "disconnected");
    assert.equal(snapshot.tasks.length, 0);
  } finally {
    if (previous === undefined) delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED;
    else process.env.ENGINEERING_CONTROL_PLANE_ENABLED = previous;
  }
});
