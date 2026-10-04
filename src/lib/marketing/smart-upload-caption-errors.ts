export class SmartUploadCaptionGroundingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmartUploadCaptionGroundingError";
  }
}

export class SmartUploadCaptionProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmartUploadCaptionProviderError";
  }
}
