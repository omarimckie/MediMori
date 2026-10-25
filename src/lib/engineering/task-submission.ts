export type TaskSubmissionResult<T> = { task: T };

/** Keeps one key/request pair across retries and coalesces overlapping submits. */
export class TaskSubmissionController<T> {
  private pending: { request: string; key: string } | undefined;
  private inFlight: { request: string; promise: Promise<TaskSubmissionResult<T>> } | undefined;

  constructor(private readonly makeKey: () => string = () => crypto.randomUUID()) {}

  submit(request: string, send: (request: string, key: string) => Promise<TaskSubmissionResult<T>>) {
    if (this.inFlight) {
      if (this.inFlight.request !== request) return Promise.reject(new Error("Task creation is already in progress."));
      return this.inFlight.promise;
    }
    if (this.pending && this.pending.request !== request) {
      return Promise.reject(new Error("Retry the unchanged request first; its previous result may still have been created."));
    }
    this.pending ??= { request, key: this.makeKey() };
    const key = this.pending.key;
    const promise = send(request, key).then(result => {
      this.pending = undefined;
      return result;
    }).finally(() => {
      this.inFlight = undefined;
    });
    this.inFlight = { request, promise };
    return promise;
  }
}
