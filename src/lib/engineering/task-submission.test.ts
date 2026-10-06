import { test } from "node:test";
import assert from "node:assert/strict";
import { TaskSubmissionController } from "./task-submission";

test("overlapping submits share one request and key; a later intentional submission gets a new key", async () => {
  const keys = ["key-one", "key-two"];
  const controller = new TaskSubmissionController<{ id: string }>(() => keys.shift()!);
  let calls = 0;
  let release!: (value: { task: { id: string } }) => void;
  const send = async (_request: string, key: string) => {
    calls++;
    assert.equal(key, "key-one");
    return await new Promise<{ task: { id: string } }>(resolve => { release = resolve; });
  };
  const first = controller.submit("same text", send);
  const second = controller.submit("same text", send);
  assert.equal(first, second);
  assert.equal(calls, 1);
  release({ task: { id: "task-1" } });
  assert.deepEqual(await first, { task: { id: "task-1" } });
  const later = await controller.submit("same text", async (_request, key) => {
    assert.equal(key, "key-two");
    return { task: { id: "task-2" } };
  });
  assert.equal(later.task.id, "task-2");
});

test("failed creation preserves the key for a safe same-request retry", async () => {
  let generated = 0;
  const controller = new TaskSubmissionController<{ id: string }>(() => { generated++; return "stable-key"; });
  const seen: string[] = [];
  await assert.rejects(controller.submit("request", async (_request, key) => {
    seen.push(key);
    throw new Error("temporary network failure");
  }));
  await assert.rejects(controller.submit("edited request", async () => ({ task: { id: "wrong" } })), /Retry the unchanged request/);
  const retried = await controller.submit("request", async (_request, key) => {
    seen.push(key);
    return { task: { id: "created" } };
  });
  assert.deepEqual(seen, ["stable-key", "stable-key"]);
  assert.equal(generated, 1);
  assert.equal(retried.task.id, "created");
});
