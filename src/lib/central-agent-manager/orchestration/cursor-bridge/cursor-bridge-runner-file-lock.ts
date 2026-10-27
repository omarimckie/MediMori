import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { CursorBridgeRunnerLockRecord, CursorBridgeRunnerLockStore } from "./cursor-bridge-runner-singleton";

export class FileCursorBridgeRunnerLockStore implements CursorBridgeRunnerLockStore {
  async read(lockPath: string): Promise<CursorBridgeRunnerLockRecord | null> {
    try {
      const raw = await readFile(lockPath, "utf8");
      const parsed = JSON.parse(raw) as CursorBridgeRunnerLockRecord;
      if (
        typeof parsed.runnerId !== "string" ||
        typeof parsed.pid !== "number" ||
        typeof parsed.acquiredAt !== "string"
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async tryAcquire(lockPath: string, record: CursorBridgeRunnerLockRecord): Promise<boolean> {
    await mkdir(dirname(lockPath), { recursive: true });
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(JSON.stringify(record), "utf8");
      await handle.close();
      return true;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
        return false;
      }
      throw error;
    }
  }

  async release(lockPath: string, runnerId: string): Promise<void> {
    const existing = await this.read(lockPath);
    if (existing?.runnerId === runnerId) {
      await unlink(lockPath).catch(() => {});
    }
  }
}
