import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  bindMarketingNotificationBellDismissListeners,
  shouldDismissNotificationPanel,
} from "./MarketingNotificationBell";

function readBellSource(): string {
  return readFileSync(
    path.join(process.cwd(), "src/components/admin/marketing/MarketingNotificationBell.tsx"),
    "utf8",
  );
}

describe("MarketingNotificationBell dismiss behavior", () => {
  it("shouldDismissNotificationPanel ignores outside targets only", () => {
    const inside = { nodeType: 1 };
    const outside = { nodeType: 1 };
    const root = {
      contains(node: unknown) {
        return node === inside;
      },
    } as HTMLElement;

    assert.equal(shouldDismissNotificationPanel(root, inside as unknown as EventTarget), false);
    assert.equal(shouldDismissNotificationPanel(root, outside as unknown as EventTarget), true);
    assert.equal(shouldDismissNotificationPanel(root, null), false);
  });

  it("bindMarketingNotificationBellDismissListeners closes on outside pointerdown and Escape", () => {
    const listeners: Array<{
      type: string;
      handler: EventListener;
      capture?: boolean;
    }> = [];
    const doc = {
      addEventListener(type: string, handler: EventListener, capture?: boolean) {
        listeners.push({ type, handler, capture });
      },
      removeEventListener(type: string, handler: EventListener, capture?: boolean) {
        const index = listeners.findIndex(
          (entry) =>
            entry.type === type && entry.handler === handler && entry.capture === capture,
        );
        if (index >= 0) listeners.splice(index, 1);
      },
      dispatchEvent(event: Event) {
        for (const entry of [...listeners]) {
          if (entry.type !== event.type) continue;
          entry.handler.call(doc, event);
        }
        return true;
      },
    } as Document;

    const previousDocument = globalThis.document;
    globalThis.document = doc;

    const root = {
      contains(node: unknown) {
        return node === insideTarget;
      },
    } as HTMLElement;
    const insideTarget = { nodeType: 1 } as unknown as EventTarget;

    let dismissCount = 0;
    const unbind = bindMarketingNotificationBellDismissListeners(root, () => {
      dismissCount += 1;
    });

    doc.dispatchEvent({
      type: "pointerdown",
      target: { nodeType: 1 },
    } as unknown as PointerEvent);
    assert.equal(dismissCount, 1);

    doc.dispatchEvent({
      type: "pointerdown",
      target: insideTarget,
    } as unknown as PointerEvent);
    assert.equal(dismissCount, 1);

    doc.dispatchEvent({ type: "keydown", key: "Escape", preventDefault() {} } as KeyboardEvent);
    assert.equal(dismissCount, 2);

    unbind();
    assert.equal(listeners.length, 0);

    doc.dispatchEvent({
      type: "pointerdown",
      target: { nodeType: 1 },
    } as unknown as PointerEvent);
    assert.equal(dismissCount, 2);

    globalThis.document = previousDocument;
  });

  it("component keeps bell toggle and dismiss wiring", () => {
    const source = readBellSource();
    assert.match(source, /ref=\{rootRef\}/);
    assert.match(source, /setOpen\(\(value\) => !value\)/);
    assert.match(source, /bindMarketingNotificationBellDismissListeners/);
    assert.match(source, /addEventListener\("pointerdown", handlePointerDown, true\)/);
    assert.match(source, /event\.key === "Escape"/);
    assert.match(source, /removeEventListener\("pointerdown"/);
    assert.match(source, /removeEventListener\("keydown"/);
    assert.match(source, /fixed inset-x-3/);
    assert.match(source, /role="dialog"/);
  });
});
