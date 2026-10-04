export type SmartUploadCaptionMode = "shared" | "per_platform";

export type SmartUploadCaptionSharedDraft = {
  body: string;
  cta: string | null;
  instagramHashtags: string[];
};

export type SmartUploadCaptionPlatformDraft = {
  body: string;
  cta: string | null;
  hashtags?: string[];
};

export type SmartUploadCaptionGenerationResult = {
  mode: SmartUploadCaptionMode;
  shared?: SmartUploadCaptionSharedDraft;
  instagram?: SmartUploadCaptionPlatformDraft;
  facebook?: SmartUploadCaptionPlatformDraft;
  warnings: string[];
  imagePathname: string;
  provider: string;
  model?: string;
  mock: boolean;
};

export type UsedMedicalClaimModelEntry = {
  claimId: string;
  text: string;
};

/** Raw JSON shape from the multimodal model (validated before use). */
export type SmartUploadCaptionModelPayload = {
  mode: SmartUploadCaptionMode;
  usedMedicalClaims: UsedMedicalClaimModelEntry[];
  sharedBody?: string;
  sharedCta?: string | null;
  instagramHashtags?: string[];
  instagramBody?: string;
  instagramCta?: string | null;
  facebookBody?: string;
  facebookCta?: string | null;
};
