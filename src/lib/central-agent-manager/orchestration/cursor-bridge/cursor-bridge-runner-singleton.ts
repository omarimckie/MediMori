export type CursorBridgeRunnerLockRecord = {
  runnerId: string;
  pid: number;
  acquiredAt: string;
};

export type CursorBridgeRunnerLockStore = {
  read(lockPath: string): Promise<CursorBridgeRunnerLockRecord | null>;
  tryAcquire(lockPath: string, record: CursorBridgeRunnerLockRecord): Promise<boolean>;
  release(lockPath: string, runnerId: string): Promise<void>;
};

export class InMemoryCursorBridgeRunnerLockStore implements CursorBridgeRunnerLockStore {
  private readonly locks = new Map<string, CursorBridgeRunnerLockRecord>();

  async read(lockPath: string): Promise<CursorBridgeRunnerLockRecord | null> {
    return this.locks.get(lockPath) ?? null;
  }

  async tryAcquire(lockPath: string, record: CursorBridgeRunnerLockRecord): Promise<boolean> {
    if (this.locks.has(lockPath)) return false;
    this.locks.set(lockPath, record);
    return true;
  }

  async release(lockPath: string, runnerId: string): Promise<void> {
    const existing = this.locks.get(lockPath);
    if (existing?.runnerId === runnerId) {
      this.locks.delete(lockPath);
    }
  }
}

export async function tryAcquireRunnerLock(input: {
  lockPath: string;
  runnerId: string;
  pid: number;
  now: string;
  store: CursorBridgeRunnerLockStore;
}): Promise<boolean> {
  return input.store.tryAcquire(input.lockPath, {
    runnerId: input.runnerId,
    pid: input.pid,
    acquiredAt: input.now,
  });
}

export async function releaseRunnerLock(input: {
  lockPath: string;
  runnerId: string;
  store: CursorBridgeRunnerLockStore;
}): Promise<void> {
  await input.store.release(input.lockPath, input.runnerId);
}
