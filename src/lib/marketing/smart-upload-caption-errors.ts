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

/** Live caption generation requested but platform AI configuration is incomplete. */
export class SmartUploadCaptionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmartUploadCaptionConfigurationError";
  }
}
