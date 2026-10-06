export class PublicationScheduleBlockedError extends Error {
  readonly code = "publication_schedule_blocked";

  constructor(
    message: string,
    readonly publicationId: string,
  ) {
    super(message);
    this.name = "PublicationScheduleBlockedError";
  }
}
