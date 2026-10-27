import {
  verifySmartUploadIntentForPathname,
  verifySmartUploadPreviewDerivativeIntentForFinalize,
} from "./smart-upload-intent";
import type { SmartUploadFixStrategy, SmartUploadFixTargetRatio } from "./smart-upload-fix";

export type SmartUploadCaptionBlobRef = {
  uploadIntent: string;
  pathname: string;
};

export function verifySmartUploadCaptionImageAccess(input: {
  actorUsername: string | null;
  original: SmartUploadCaptionBlobRef;
  acceptedDerivative: SmartUploadCaptionBlobRef | null;
  finalizeKey?: string | null;
  strategy?: SmartUploadFixStrategy | null;
  targetRatio?: SmartUploadFixTargetRatio | null;
}): SmartUploadCaptionBlobRef {
  verifySmartUploadIntentForPathname(
    input.original.uploadIntent,
    input.actorUsername,
    input.original.pathname,
  );

  if (!input.acceptedDerivative) {
    return input.original;
  }

  const derivative = input.acceptedDerivative;
  const finalizeKey = input.finalizeKey?.trim() ?? "";
  const strategy = input.strategy ?? null;
  const targetRatio = input.targetRatio ?? null;

  if (!finalizeKey || !strategy || !targetRatio) {
    throw new Error(
      "finalizeKey, strategy, and targetRatio are required when using a preview derivative.",
    );
  }

  verifySmartUploadPreviewDerivativeIntentForFinalize(
    derivative.uploadIntent,
    input.actorUsername,
    {
      derivativePathname: derivative.pathname,
      originalPathname: input.original.pathname,
      finalizeKey,
      strategy,
      targetRatio,
    },
  );

  return derivative;
}
