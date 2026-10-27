export type ActiveCursorDispatch = {
  assignmentId: string;
  cursorAgentId: string;
  cursorRunId: string;
};

export class CursorBridgeDispatchRegistry {
  private active: ActiveCursorDispatch | null = null;

  getActive(): ActiveCursorDispatch | null {
    return this.active;
  }

  assertCanDispatch(assignmentId: string): void {
    if (!this.active) return;
    if (this.active.assignmentId === assignmentId) return;
    throw new Error(
      `Cursor bridge already has an active dispatch for assignment ${this.active.assignmentId}.`,
    );
  }

  recordDispatch(assignmentId: string, cursorAgentId: string, cursorRunId: string): void {
    this.assertCanDispatch(assignmentId);
    this.active = { assignmentId, cursorAgentId, cursorRunId };
  }

  clear(assignmentId: string): void {
    if (this.active?.assignmentId === assignmentId) {
      this.active = null;
    }
  }
}
