"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import booksData from "@/data/books.json";
import { MAX_MARKETING_IMAGE_BYTES } from "@/lib/marketing/upload-limits";
import {
  resourceBlobStorageUnavailableMessage,
  shouldUseResourceMultipartFallbackWhenBlobUnavailable,
} from "@/lib/marketing/resource-multipart-fallback";
import {
  canStartPreviewGeneration,
  invalidateAcceptedBeforePreviewRegeneration,
} from "@/lib/marketing/smart-upload-preview-client";
import { smartUploadStagedImageUrl } from "@/lib/marketing/smart-upload-staged-image-url";
import {
  createSmartUploadSessionBatchId,
  SMART_UPLOAD_SESSION_BATCH_ID_UNASSIGNED,
} from "@/lib/marketing/smart-upload-session-batch";
import {
  acknowledgeStaleCaption,
  composeSharedCaptionPreview,
  createDefaultCaptionAssistantState,
  findSubmitValidCaptionPreflightIssue,
  hasReviewedDraftContent,
  refreshCaptionAssistantStale,
  type CaptionAssistantState,
  type CaptionFingerprintContext,
  type SubmitValidCaptionPreflightEntry,
} from "@/lib/marketing/smart-upload-caption-client-state";
import {
  applyFailedCaptionGeneration,
  applySuccessfulCaptionGeneration,
  assessCaptionGenerationReadiness,
  beginCaptionGeneration,
  buildGenerateCaptionsImageContextFromFile,
  buildGenerateCaptionsRequestBody,
  buildGenerationSnapshotForRequest,
  GENERATE_CAPTIONS_URL,
  mapCaptionGenerationHttpError,
  nextCaptionGenerationRequestSeq,
  parseGenerateCaptionsResponse,
  shouldApplyCaptionGenerationResponse,
} from "@/lib/marketing/smart-upload-caption-client";
import {
  ensureStagedForCaptionGeneration,
  type CaptionGenerationFileSnapshot,
} from "@/lib/marketing/smart-upload-caption-one-click";
import {
  formatStaleCaptionSubmitPreflightMessage,
  reconcileStaleCaptionSubmitSessionMessage,
} from "@/lib/marketing/smart-upload-caption-submit-message";
import { SmartUploadCaptionAssistant } from "./SmartUploadCaptionAssistant";
import { Card, PrimaryButton, SecondaryButton } from "./ui";

const UPLOAD_INTENT_URL = "/api/admin/marketing/smart-upload/upload-intent";
const UPLOAD_URL = "/api/admin/marketing/smart-upload/upload-url";
const VALIDATE_URL = "/api/admin/marketing/smart-upload/validate";
const FINALIZE_URL = "/api/admin/marketing/smart-upload/finalize";
const PREVIEW_FIX_URL = "/api/admin/marketing/smart-upload/preview-fix";
const DISCARD_PREVIEW_URL = "/api/admin/marketing/smart-upload/discard-preview";

const BOOKS = booksData.books as Array<{ id: string; title: string }>;

type FileStatus =
  | "ready"
  | "uploading"
  | "validating"
  | "needs_attention"
  | "failed"
  | "submitted";

type FixStrategy = "pad" | "crop";
type FixTargetRatio = "4:5" | "1:1";

type PreviewState = {
  uploadIntent: string;
  pathname: string;
  publicUrl: string;
  strategy: FixStrategy;
  targetRatio: FixTargetRatio;
  width: number;
  height: number;
};

type SmartUploadFile = {
  id: string;
  file: File;
  status: FileStatus;
  error: string | null;
  validationIssues: Array<{ code: string; message: string; platform?: string }>;
  uploadIntent: string | null;
  pathname: string | null;
  publicUrl: string | null;
  finalizeKey: string;
  fixPanelOpen: boolean;
  fixStrategy: FixStrategy;
  fixTargetRatio: FixTargetRatio;
  preview: PreviewState | null;
  acceptedPreview: PreviewState | null;
  captionAssistant: CaptionAssistantState;
};

type WeeklyPlanOption = { id: string; weekStart: string; campaignId: string };
type CampaignOption = { id: string; name: string };

function newFileEntry(file: File): SmartUploadFile {
  return {
    id: crypto.randomUUID(),
    file,
    status: "ready",
    error: null,
    validationIssues: [],
    uploadIntent: null,
    pathname: null,
    publicUrl: null,
    finalizeKey: crypto.randomUUID(),
    fixPanelOpen: false,
    fixStrategy: "pad",
    fixTargetRatio: "4:5",
    preview: null,
    acceptedPreview: null,
    captionAssistant: createDefaultCaptionAssistantState(),
  };
}

function captionGenerationFileSnapshot(item: SmartUploadFile): CaptionGenerationFileSnapshot {
  return {
    uploadIntent: item.uploadIntent,
    pathname: item.pathname,
    publicUrl: item.publicUrl,
    status: item.status,
    error: item.error,
    finalizeKey: item.finalizeKey,
    fixStrategy: item.fixStrategy,
    fixTargetRatio: item.fixTargetRatio,
    acceptedPreview: item.acceptedPreview
      ? {
          uploadIntent: item.acceptedPreview.uploadIntent,
          pathname: item.acceptedPreview.pathname,
          strategy: item.acceptedPreview.strategy,
          targetRatio: item.acceptedPreview.targetRatio,
        }
      : null,
    preview: item.preview
      ? { strategy: item.preview.strategy, targetRatio: item.preview.targetRatio }
      : null,
  };
}

function captionFingerprintContext(
  item: SmartUploadFile,
  bookId: string,
  campaignId: string,
): CaptionFingerprintContext {
  return {
    mode: item.captionAssistant.mode,
    instructions: item.captionAssistant.instructions,
    bookId: bookId.trim() || null,
    campaignId: campaignId.trim() || null,
    advanced: item.captionAssistant.advanced,
    originalPathname: item.pathname,
    originalUploadIntent: item.uploadIntent,
    acceptedDerivative: item.acceptedPreview
      ? {
          pathname: item.acceptedPreview.pathname,
          uploadIntent: item.acceptedPreview.uploadIntent,
        }
      : null,
    fixStrategy: item.fixStrategy,
    fixTargetRatio: item.fixTargetRatio,
    finalizeKey: item.finalizeKey,
  };
}

function isAspectRatioFixable(item: SmartUploadFile): boolean {
  if (!item.validationIssues.length) return false;
  if (!item.uploadIntent || !item.pathname || !item.publicUrl) return false;
  if (item.uploadIntent === "local-multipart") return false;
  return item.validationIssues.every((issue) => issue.code === "invalid_aspect_ratio");
}

function previewMatchesSettings(
  preview: PreviewState | null,
  strategy: FixStrategy,
  targetRatio: FixTargetRatio,
): boolean {
  return Boolean(preview && preview.strategy === strategy && preview.targetRatio === targetRatio);
}

function statusLabel(status: FileStatus): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "uploading":
      return "Uploading";
    case "validating":
      return "Validating";
    case "needs_attention":
      return "Needs attention";
    case "failed":
      return "Failed";
    case "submitted":
      return "Submitted";
    default:
      return status;
  }
}

function statusTone(status: FileStatus): string {
  switch (status) {
    case "submitted":
      return "bg-brand-green-deep text-white";
    case "needs_attention":
      return "bg-brand-orange/40 text-brand-navy";
    case "failed":
      return "bg-brand-orange-deep text-white";
    case "uploading":
    case "validating":
      return "bg-brand-sky/40 text-brand-navy";
    default:
      return "bg-cream-deep text-brand-charcoal";
  }
}

async function parseApiError(response: Response): Promise<string> {
  const raw = await response.text();
  if (!raw) return `Request failed (${response.status}).`;
  try {
    const payload = JSON.parse(raw) as { error?: string };
    return payload.error ?? `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

export function SmartUploadClient() {
  const [batchId, setBatchId] = useState<string | null>(SMART_UPLOAD_SESSION_BATCH_ID_UNASSIGNED);
  const [weeklyPlanId, setWeeklyPlanId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [bookId, setBookId] = useState("");
  const [files, setFiles] = useState<SmartUploadFile[]>([]);
  const filesRef = useRef<SmartUploadFile[]>([]);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    setBatchId(createSmartUploadSessionBatchId());
  }, []);
  const [plans, setPlans] = useState<WeeklyPlanOption[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewGeneratingEntryId, setPreviewGeneratingEntryId] = useState<string | null>(null);
  const [generatingCaptionFileId, setGeneratingCaptionFileId] = useState<string | null>(null);
  const captionGenerationSeqRef = useRef<Map<string, number>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);

  const loadMeta = useCallback(async () => {
    const [settingsRes, campaignsRes] = await Promise.all([
      fetch("/api/admin/marketing/settings"),
      fetch("/api/admin/marketing/campaigns"),
    ]);
    if (settingsRes.ok) {
      const json = (await settingsRes.json()) as { plans?: WeeklyPlanOption[] };
      setPlans(json.plans ?? []);
    }
    if (campaignsRes.ok) {
      const json = (await campaignsRes.json()) as { campaigns?: CampaignOption[] };
      setCampaigns(json.campaigns ?? []);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await loadMeta();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load selectors once on mount
  }, []);

  useEffect(() => {
    setFiles((prev) => {
      const next = prev.map((item) => ({
        ...item,
        captionAssistant: refreshCaptionAssistantStale(
          item.captionAssistant,
          captionFingerprintContext(item, bookId, campaignId),
        ),
      }));
      filesRef.current = next;
      return next;
    });
    reconcileSessionMessageAfterCaptionPreflightState();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reconcile after batch stale refresh
  }, [bookId, campaignId]);

  const summary = useMemo(() => {
    const counts: Record<FileStatus, number> = {
      ready: 0,
      uploading: 0,
      validating: 0,
      needs_attention: 0,
      failed: 0,
      submitted: 0,
    };
    for (const item of files) counts[item.status] += 1;
    return counts;
  }, [files]);

  function addFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    const next: SmartUploadFile[] = [];
    for (const file of Array.from(fileList)) {
      if (file.size > MAX_MARKETING_IMAGE_BYTES) {
        next.push({
          ...newFileEntry(file),
          status: "needs_attention",
          error: `Image exceeds ${MAX_MARKETING_IMAGE_BYTES / (1024 * 1024)} MB.`,
        });
        continue;
      }
      const type = file.type.toLowerCase();
      if (!["image/jpeg", "image/png", "image/webp"].includes(type)) {
        next.push({
          ...newFileEntry(file),
          status: "needs_attention",
          error: "File must be PNG, JPEG, or WebP.",
        });
        continue;
      }
      next.push(newFileEntry(file));
    }
    setFiles((prev) => [...prev, ...next]);
  }

  function mergeSmartUploadFile(
    item: SmartUploadFile,
    patch: Partial<SmartUploadFile>,
  ): SmartUploadFile {
    const merged = { ...item, ...patch };
    return {
      ...merged,
      captionAssistant: refreshCaptionAssistantStale(
        merged.captionAssistant,
        captionFingerprintContext(merged, bookId, campaignId),
      ),
    };
  }

  function reconcileSessionMessageAfterCaptionPreflightState() {
    setSessionMessage((prev) =>
      reconcileStaleCaptionSubmitSessionMessage(
        prev,
        filesRef.current.map((entry) => captionPreflightEntry(entry)),
      ),
    );
  }

  function commitFile(id: string, patch: Partial<SmartUploadFile>): SmartUploadFile {
    const item = filesRef.current.find((f) => f.id === id);
    if (!item) {
      throw new Error("Smart Upload file not found.");
    }
    const merged = mergeSmartUploadFile(item, patch);
    const next = filesRef.current.map((f) => (f.id === id ? merged : f));
    filesRef.current = next;
    setFiles(next);
    reconcileSessionMessageAfterCaptionPreflightState();
    return merged;
  }

  function updateFile(id: string, patch: Partial<SmartUploadFile>) {
    commitFile(id, patch);
  }

  function updateCaptionAssistant(id: string, nextAssistant: CaptionAssistantState) {
    commitFile(id, { captionAssistant: nextAssistant });
  }

  function getFileById(id: string): SmartUploadFile | undefined {
    return filesRef.current.find((item) => item.id === id);
  }

  function captionPreflightEntry(entry: SmartUploadFile): SubmitValidCaptionPreflightEntry {
    const captionAssistant = refreshCaptionAssistantStale(
      entry.captionAssistant,
      captionFingerprintContext(entry, bookId, campaignId),
    );
    return {
      fileName: entry.file.name,
      status: entry.status,
      uploadIntent: entry.uploadIntent,
      acceptedDerivative: entry.acceptedPreview
        ? {
            strategy: entry.acceptedPreview.strategy,
            targetRatio: entry.acceptedPreview.targetRatio,
          }
        : null,
      previewDerivative: entry.preview
        ? { strategy: entry.preview.strategy, targetRatio: entry.preview.targetRatio }
        : null,
      fixStrategy: entry.fixStrategy,
      fixTargetRatio: entry.fixTargetRatio,
      shared: captionAssistant.shared,
      generatedFrom: captionAssistant.generatedFrom,
      stale: captionAssistant.stale,
      staleAcknowledged: captionAssistant.staleAcknowledged,
    };
  }

  function captionGenerationUi(item: SmartUploadFile): { ready: boolean; reason?: string } {
    if (item.status === "submitted" || item.status === "failed") {
      return { ready: false, reason: "This image cannot be used for caption generation." };
    }
    if (item.status === "needs_attention") {
      return { ready: false, reason: "Fix image validation issues before generating a caption." };
    }
    if (!item.uploadIntent || !item.pathname) {
      return { ready: true };
    }
    const assessed = assessCaptionGenerationReadiness({
      status: item.status,
      uploadIntent: item.uploadIntent,
      pathname: item.pathname,
      acceptedPreview: item.acceptedPreview
        ? {
            strategy: item.acceptedPreview.strategy,
            targetRatio: item.acceptedPreview.targetRatio,
          }
        : null,
      preview: item.preview
        ? { strategy: item.preview.strategy, targetRatio: item.preview.targetRatio }
        : null,
      fixStrategy: item.fixStrategy,
      fixTargetRatio: item.fixTargetRatio,
    });
    return assessed.ready ? { ready: true } : { ready: false, reason: assessed.reason };
  }

  async function runCaptionGeneration(fileId: string) {
    if (generatingCaptionFileId === fileId) return;

    const initial = getFileById(fileId);
    if (!initial) return;

    if (initial.uploadIntent && initial.pathname) {
      const readinessBefore = captionGenerationUi(initial);
      if (!readinessBefore.ready && readinessBefore.reason) {
        updateCaptionAssistant(
          fileId,
          applyFailedCaptionGeneration(initial.captionAssistant, readinessBefore.reason),
        );
        return;
      }
    }

    if (hasReviewedDraftContent(initial.captionAssistant.shared)) {
      const confirmed = window.confirm(
        "Replace the current caption draft with a generated draft?",
      );
      if (!confirmed) return;
    }

    setGeneratingCaptionFileId(fileId);
    const requestSeq = nextCaptionGenerationRequestSeq(captionGenerationSeqRef.current, fileId);

    const started = getFileById(fileId);
    if (started) {
      updateCaptionAssistant(fileId, beginCaptionGeneration(started.captionAssistant));
    }

    let file = getFileById(fileId);
    if (!file) {
      setGeneratingCaptionFileId(null);
      return;
    }

    const fileForStaging = file;
    const prepared = await ensureStagedForCaptionGeneration(
      captionGenerationFileSnapshot(fileForStaging),
      async () => {
        const latest = getFileById(fileId) ?? fileForStaging;
        const staged = await uploadAndValidateOne(latest);
        return captionGenerationFileSnapshot(staged);
      },
    );

    if (!prepared.ok) {
      if (shouldApplyCaptionGenerationResponse(captionGenerationSeqRef.current, fileId, requestSeq)) {
        const current = getFileById(fileId) ?? file;
        updateCaptionAssistant(
          fileId,
          applyFailedCaptionGeneration(current.captionAssistant, prepared.message),
        );
        setGeneratingCaptionFileId(null);
      }
      return;
    }

    file = getFileById(fileId) ?? file;

    const imageContext = buildGenerateCaptionsImageContextFromFile({
      uploadIntent: file.uploadIntent,
      pathname: file.pathname,
      finalizeKey: file.finalizeKey,
      acceptedPreview: file.acceptedPreview,
    });
    if (!imageContext) {
      if (shouldApplyCaptionGenerationResponse(captionGenerationSeqRef.current, fileId, requestSeq)) {
        updateCaptionAssistant(
          fileId,
          applyFailedCaptionGeneration(
            file.captionAssistant,
            "Upload and validate this image before generating a caption.",
          ),
        );
        setGeneratingCaptionFileId(null);
      }
      return;
    }

    const explicitCta = file.captionAssistant.shared.cta.trim() || null;
    const fpContext = captionFingerprintContext(file, bookId, campaignId);
    const snapshot = buildGenerationSnapshotForRequest(fpContext, explicitCta);
    const requestBody = buildGenerateCaptionsRequestBody({
      instructions: file.captionAssistant.instructions,
      explicitCta,
      bookId: bookId.trim() || null,
      campaignId: campaignId.trim() || null,
      advanced: file.captionAssistant.advanced,
      image: imageContext,
    });

    try {
      const response = await fetch(GENERATE_CAPTIONS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!shouldApplyCaptionGenerationResponse(captionGenerationSeqRef.current, fileId, requestSeq)) {
        return;
      }

      const current = getFileById(fileId);
      if (!current) return;

      if (!response.ok) {
        const serverMessage = await parseApiError(response);
        updateCaptionAssistant(
          fileId,
          applyFailedCaptionGeneration(
            current.captionAssistant,
            mapCaptionGenerationHttpError(response.status, serverMessage),
          ),
        );
        return;
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const parsed = parseGenerateCaptionsResponse(payload);
      const afterParse = getFileById(fileId);
      if (!afterParse) return;
      updateCaptionAssistant(
        fileId,
        applySuccessfulCaptionGeneration(afterParse.captionAssistant, parsed, snapshot),
      );
    } catch {
      if (!shouldApplyCaptionGenerationResponse(captionGenerationSeqRef.current, fileId, requestSeq)) {
        return;
      }
      const current = getFileById(fileId);
      if (!current) return;
      updateCaptionAssistant(
        fileId,
        applyFailedCaptionGeneration(
          current.captionAssistant,
          "Caption generation failed. Try again.",
        ),
      );
    } finally {
      if (shouldApplyCaptionGenerationResponse(captionGenerationSeqRef.current, fileId, requestSeq)) {
        setGeneratingCaptionFileId(null);
      }
    }
  }

  async function uploadAndValidateOne(entry: SmartUploadFile): Promise<SmartUploadFile> {
    const fileId = entry.id;
    let file = commitFile(fileId, { status: "uploading", error: null, validationIssues: [] });

    const intentRes = await fetch(UPLOAD_INTENT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: entry.file.name }),
    });

    const useMultipart =
      intentRes.status === 503 &&
      shouldUseResourceMultipartFallbackWhenBlobUnavailable(entry.file.size, {
        blobIntentStatus503: true,
      });

    if (useMultipart) {
      file = commitFile(fileId, { status: "validating" });
      const form = new FormData();
      form.set("image", file.file);
      const response = await fetch(VALIDATE_URL, { method: "POST", body: form });
      if (response.status === 422) {
        const json = (await response.json()) as {
          issues?: Array<{ code: string; message: string; platform?: string }>;
        };
        return commitFile(fileId, {
          status: "needs_attention",
          error: json.issues?.map((i) => i.message).join(" ") ?? "Validation failed.",
          validationIssues: json.issues ?? [],
        });
      }
      if (!response.ok) {
        return commitFile(fileId, {
          status: "failed",
          error: await parseApiError(response),
        });
      }
      return commitFile(fileId, {
        status: "ready",
        error: null,
        validationIssues: [],
        uploadIntent: "local-multipart",
        pathname: "local-multipart",
        publicUrl: "local-multipart",
      });
    }

    if (!intentRes.ok) {
      const message =
        intentRes.status === 503
          ? resourceBlobStorageUnavailableMessage()
          : await parseApiError(intentRes);
      return commitFile(fileId, { status: "failed", error: message });
    }

    const intentJson = (await intentRes.json()) as {
      uploadIntent: string;
      pathname: string;
    };

    const urlRes = await fetch(UPLOAD_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uploadIntent: intentJson.uploadIntent,
        pathname: intentJson.pathname,
      }),
    });
    if (!urlRes.ok) {
      return commitFile(fileId, {
        status: "failed",
        error: await parseApiError(urlRes),
      });
    }

    const urlJson = (await urlRes.json()) as {
      presignedUrl: string;
      publicUrl?: string;
      pathname: string;
    };

    const headers: HeadersInit = {};
    if (file.file.type) headers["Content-Type"] = file.file.type;
    const putRes = await fetch(urlJson.presignedUrl, {
      method: "PUT",
      body: file.file,
      headers,
    });
    if (!putRes.ok) {
      return commitFile(fileId, {
        status: "failed",
        error: `Direct blob upload failed (${putRes.status}).`,
      });
    }

    const publicUrl = urlJson.publicUrl ?? "";
    file = commitFile(fileId, {
      status: "validating",
      uploadIntent: intentJson.uploadIntent,
      pathname: urlJson.pathname,
      publicUrl,
    });

    const validateRes = await fetch(VALIDATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uploadIntent: intentJson.uploadIntent,
        pathname: urlJson.pathname,
        publicUrl,
      }),
    });

    if (validateRes.status === 422) {
      const json = (await validateRes.json()) as {
        issues?: Array<{ code: string; message: string; platform?: string }>;
      };
      return commitFile(fileId, {
        status: "needs_attention",
        error: json.issues?.map((i) => i.message).join(" ") ?? "Validation failed.",
        validationIssues: json.issues ?? [],
        uploadIntent: intentJson.uploadIntent,
        pathname: urlJson.pathname,
        publicUrl,
      });
    }
    if (!validateRes.ok) {
      return commitFile(fileId, {
        status: "failed",
        error: await parseApiError(validateRes),
        uploadIntent: intentJson.uploadIntent,
        pathname: urlJson.pathname,
        publicUrl,
      });
    }

    return commitFile(fileId, {
      status: "ready",
      error: null,
      validationIssues: [],
      uploadIntent: intentJson.uploadIntent,
      pathname: urlJson.pathname,
      publicUrl,
    });
  }

  async function discardPreviewForEntry(entry: SmartUploadFile, preview: PreviewState): Promise<void> {
    if (preview.pathname === entry.pathname) return;
    try {
      await fetch(DISCARD_PREVIEW_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadIntent: preview.uploadIntent,
          pathname: preview.pathname,
          publicUrl: preview.publicUrl,
        }),
      });
    } catch {
      // best-effort discard
    }
  }

  async function generatePreview(entry: SmartUploadFile): Promise<void> {
    if (!entry.uploadIntent || !entry.pathname || !entry.publicUrl) return;
    if (!canStartPreviewGeneration(entry.id, previewGeneratingEntryId)) return;

    setPreviewGeneratingEntryId(entry.id);
    const previousPreview = entry.preview;
    updateFile(entry.id, {
      ...invalidateAcceptedBeforePreviewRegeneration(),
      error: null,
    });

    try {
      if (previousPreview) {
        await discardPreviewForEntry(entry, previousPreview);
      }
      updateFile(entry.id, { status: "validating" });
      const response = await fetch(PREVIEW_FIX_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          finalizeKey: entry.finalizeKey,
          uploadIntent: entry.uploadIntent,
          pathname: entry.pathname,
          publicUrl: entry.publicUrl,
          strategy: entry.fixStrategy,
          targetRatio: entry.fixTargetRatio,
          imageFilename: entry.file.name,
        }),
      });
      if (!response.ok) {
        updateFile(entry.id, {
          status: "needs_attention",
          error: await parseApiError(response),
          acceptedPreview: null,
        });
        return;
      }
      const json = (await response.json()) as {
        preview: PreviewState;
      };
      updateFile(entry.id, {
        status: "needs_attention",
        error: null,
        preview: json.preview,
        acceptedPreview: null,
      });
    } finally {
      setPreviewGeneratingEntryId(null);
    }
  }

  async function discardPreviewAction(entry: SmartUploadFile): Promise<void> {
    if (entry.preview) {
      await discardPreviewForEntry(entry, entry.preview);
    }
    updateFile(entry.id, {
      preview: null,
      acceptedPreview: null,
      status: "needs_attention",
    });
  }

  function acceptPreview(entry: SmartUploadFile): void {
    if (!entry.preview) return;
    if (!previewMatchesSettings(entry.preview, entry.fixStrategy, entry.fixTargetRatio)) {
      return;
    }
    updateFile(entry.id, {
      acceptedPreview: entry.preview,
      status: "ready",
      error: null,
      validationIssues: [],
    });
  }

  async function finalizeOne(entry: SmartUploadFile, captionText: string): Promise<void> {
    if (!batchId) return;
    const derivative = entry.acceptedPreview;
    if (!entry.uploadIntent || !entry.pathname || !entry.publicUrl) return;
    updateFile(entry.id, { status: "validating", error: null });

    let response: Response;
    if (entry.uploadIntent === "local-multipart") {
      const form = new FormData();
      form.set("image", entry.file);
      form.set("caption", captionText);
      form.set("batchId", batchId);
      form.set("finalizeKey", entry.finalizeKey);
      if (weeklyPlanId) form.set("weeklyPlanId", weeklyPlanId);
      if (campaignId) form.set("campaignId", campaignId);
      if (bookId) form.set("bookId", bookId);
      response = await fetch(FINALIZE_URL, { method: "POST", body: form });
    } else {
      const body: Record<string, unknown> = {
        caption: captionText,
        batchId,
        finalizeKey: entry.finalizeKey,
        weeklyPlanId: weeklyPlanId || null,
        campaignId: campaignId || null,
        bookId: bookId || null,
        imageFilename: entry.file.name,
      };
      if (derivative) {
        body.uploadIntent = derivative.uploadIntent;
        body.pathname = derivative.pathname;
        body.publicUrl = derivative.publicUrl;
        body.smartUploadFixStrategy = derivative.strategy;
        body.smartUploadFixTargetRatio = derivative.targetRatio;
        body.originalUploadIntent = entry.uploadIntent;
        body.originalPathname = entry.pathname;
        body.originalPublicUrl = entry.publicUrl;
      } else {
        body.uploadIntent = entry.uploadIntent;
        body.pathname = entry.pathname;
        body.publicUrl = entry.publicUrl;
      }
      response = await fetch(FINALIZE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    if (response.status === 422) {
      const json = (await response.json()) as {
        issues?: Array<{ code: string; message: string; platform?: string }>;
        error?: string;
      };
      updateFile(entry.id, {
        status: "needs_attention",
        error: json.error ?? "Validation failed.",
        validationIssues: json.issues ?? [],
      });
      return;
    }
    if (!response.ok) {
      updateFile(entry.id, {
        status: "failed",
        error: await parseApiError(response),
      });
      return;
    }
    updateFile(entry.id, { status: "submitted", error: null });
  }

  async function prepareAll() {
    setSessionMessage(null);
    const targets = files.filter((f) => f.status === "ready" && !f.uploadIntent);
    if (!targets.length) return;
    setBusy(true);
    for (const entry of targets) {
      await uploadAndValidateOne(entry);
    }
    setBusy(false);
  }

  async function submitValid() {
    setSessionMessage(null);
    if (!batchId) {
      setSessionMessage("Session is still starting. Try again in a moment.");
      return;
    }
    const snapshot = [...filesRef.current];
    const preflightIssue = findSubmitValidCaptionPreflightIssue(
      snapshot.map((entry) => captionPreflightEntry(entry)),
    );
    if (preflightIssue?.kind === "missing_caption") {
      setSessionMessage(
        `Caption or CTA is required for "${preflightIssue.fileName}" before submitting.`,
      );
      return;
    }
    if (preflightIssue?.kind === "stale_generated") {
      setSessionMessage(formatStaleCaptionSubmitPreflightMessage(preflightIssue.fileName));
      return;
    }

    setBusy(true);
    for (const entry of snapshot) {
      if (entry.status === "submitted" || entry.status === "needs_attention") continue;
      const latest = getFileById(entry.id) ?? entry;
      if (!latest.uploadIntent) {
        await uploadAndValidateOne(latest);
      }
      const afterUpload = getFileById(entry.id);
      if (afterUpload?.status === "ready" && afterUpload.uploadIntent) {
        const captionText = composeSharedCaptionPreview(afterUpload.captionAssistant.shared);
        await finalizeOne(afterUpload, captionText);
      }
    }
    setBusy(false);
  }

  const submittableCount = files.filter(
    (f) =>
      f.status === "ready" &&
      f.uploadIntent &&
      (!f.acceptedPreview || previewMatchesSettings(f.preview, f.fixStrategy, f.fixTargetRatio)),
  ).length;

  return (
    <div className="space-y-6">
      <Card>
        <p className="text-sm text-brand-charcoal/70">
          Upload images once to create paired Instagram and Facebook feed posts (needs review). Images
          are validated on the server for both platforms before any content is created.
        </p>
        {batchId ? (
          <p className="mt-2 text-xs text-brand-charcoal/50">Session batch ID: {batchId}</p>
        ) : null}
      </Card>

      <Card className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-bold">
            Weekly plan (optional)
            <select
              value={weeklyPlanId}
              onChange={(e) => setWeeklyPlanId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm"
            >
              <option value="">None — appears in Content only</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  Week of {plan.weekStart}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-bold">
            Campaign (optional)
            <select
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm"
            >
              <option value="">None</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-sm font-bold">
          Related book (optional)
          <select
            value={bookId}
            onChange={(e) => setBookId(e.target.value)}
            className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm"
          >
            <option value="">None</option>
            {BOOKS.map((book) => (
              <option key={book.id} value={book.id}>
                {book.title}
              </option>
            ))}
          </select>
        </label>
      </Card>

      <Card>
        <div
          className="rounded-xl border border-dashed border-brand-brown/30 bg-cream-deep/50 px-4 py-8 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            addFiles(e.dataTransfer.files);
          }}
        >
          <p className="text-sm font-bold text-brand-navy">Drop images here or choose files</p>
          <p className="mt-1 text-xs text-brand-charcoal/60">
            PNG, JPEG, or WebP · max {MAX_MARKETING_IMAGE_BYTES / (1024 * 1024)} MB each
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="mt-4 inline-flex h-10 items-center rounded-xl border border-brand-brown/25 bg-white px-4 text-sm font-bold text-brand-blue-deep hover:bg-cream"
            onClick={() => inputRef.current?.click()}
          >
            Choose images
          </button>
        </div>

        {files.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {files.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-brand-brown/15 bg-cream-deep/30 px-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-brand-charcoal">{item.file.name}</p>
                  <p className="text-xs text-brand-charcoal/55">
                    {(item.file.size / 1024).toFixed(0)} KB
                  </p>
                  {item.error ? (
                    <p className="mt-1 text-sm font-semibold text-brand-orange-deep">{item.error}</p>
                  ) : null}
                  {item.validationIssues.length > 0 ? (
                    <ul className="mt-1 list-disc pl-4 text-xs text-brand-orange-deep">
                      {item.validationIssues.map((issue, index) => (
                        <li key={`${issue.code}-${index}`}>
                          {issue.platform ? `${issue.platform}: ` : ""}
                          {issue.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {isAspectRatioFixable(item) ? (
                    <div className="mt-3 space-y-3 rounded-lg border border-brand-brown/15 bg-white p-3">
                      {!item.fixPanelOpen ? (
                        <SecondaryButton
                          type="button"
                          disabled={busy}
                          onClick={() => updateFile(item.id, { fixPanelOpen: true })}
                        >
                          Fix + Preview
                        </SecondaryButton>
                      ) : (
                        <>
                          <p className="text-sm font-bold text-brand-navy">Fix Image</p>
                          <fieldset className="space-y-2 text-sm">
                            <p className="font-semibold text-brand-charcoal">Strategy</p>
                            <label className="flex items-center gap-2">
                              <input
                                type="radio"
                                name={`strategy-${item.id}`}
                                checked={item.fixStrategy === "pad"}
                                onChange={() =>
                                  updateFile(item.id, {
                                    fixStrategy: "pad",
                                    acceptedPreview: null,
                                    preview: null,
                                  })
                                }
                              />
                              Fit with padding
                            </label>
                            <p className="ml-6 text-xs text-brand-charcoal/65">
                              Keep the entire image. Padding is added where needed.
                            </p>
                            <label className="flex items-center gap-2">
                              <input
                                type="radio"
                                name={`strategy-${item.id}`}
                                checked={item.fixStrategy === "crop"}
                                onChange={() =>
                                  updateFile(item.id, {
                                    fixStrategy: "crop",
                                    acceptedPreview: null,
                                    preview: null,
                                  })
                                }
                              />
                              Crop
                            </label>
                            <p className="ml-6 text-xs text-brand-charcoal/65">
                              Fill the entire frame. Some content around the edges may be removed.
                            </p>
                            <p className="pt-1 font-semibold text-brand-charcoal">Target</p>
                            <label className="flex items-center gap-2">
                              <input
                                type="radio"
                                name={`target-${item.id}`}
                                checked={item.fixTargetRatio === "4:5"}
                                onChange={() =>
                                  updateFile(item.id, {
                                    fixTargetRatio: "4:5",
                                    acceptedPreview: null,
                                    preview: null,
                                  })
                                }
                              />
                              4:5
                            </label>
                            <label className="flex items-center gap-2">
                              <input
                                type="radio"
                                name={`target-${item.id}`}
                                checked={item.fixTargetRatio === "1:1"}
                                onChange={() =>
                                  updateFile(item.id, {
                                    fixTargetRatio: "1:1",
                                    acceptedPreview: null,
                                    preview: null,
                                  })
                                }
                              />
                              Square
                            </label>
                          </fieldset>
                          <SecondaryButton
                            type="button"
                            disabled={
                              busy || !canStartPreviewGeneration(item.id, previewGeneratingEntryId)
                            }
                            onClick={() => void generatePreview(item)}
                          >
                            Generate Preview
                          </SecondaryButton>
                          {item.preview ? (
                            <div className="space-y-2">
                              <p className="text-xs font-semibold text-brand-charcoal">
                                Preview · {item.preview.strategy === "pad" ? "Fit with padding" : "Crop"} ·{" "}
                                {item.preview.targetRatio === "4:5" ? "4:5" : "Square"} (
                                {item.preview.width}×{item.preview.height})
                              </p>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div>
                                  <p className="mb-1 text-xs font-bold text-brand-charcoal/70">Original</p>
                                  {item.pathname && item.uploadIntent ? (
                                    <img
                                      src={smartUploadStagedImageUrl({
                                        pathname: item.pathname,
                                        uploadIntent: item.uploadIntent,
                                      })}
                                      alt="Original upload"
                                      className="max-h-48 w-full rounded-lg border border-brand-brown/15 object-contain bg-white"
                                    />
                                  ) : null}
                                </div>
                                <div>
                                  <p className="mb-1 text-xs font-bold text-brand-charcoal/70">Preview</p>
                                  <img
                                    src={smartUploadStagedImageUrl({
                                      pathname: item.preview.pathname,
                                      uploadIntent: item.preview.uploadIntent,
                                    })}
                                    alt="Corrected preview"
                                    className="max-h-48 w-full rounded-lg border border-brand-brown/15 object-contain bg-white"
                                  />
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <SecondaryButton
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void discardPreviewAction(item)}
                                >
                                  Discard
                                </SecondaryButton>
                                <PrimaryButton
                                  type="button"
                                  disabled={
                                    busy ||
                                    !previewMatchesSettings(
                                      item.preview,
                                      item.fixStrategy,
                                      item.fixTargetRatio,
                                    )
                                  }
                                  onClick={() => acceptPreview(item)}
                                >
                                  Use This Image
                                </PrimaryButton>
                              </div>
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  ) : item.status === "needs_attention" ? (
                    <p className="mt-2 text-xs text-brand-charcoal/70">
                      This issue cannot be fixed here. Adjust the file and upload again.
                    </p>
                  ) : null}
                  {item.acceptedPreview && item.status === "ready" ? (
                    <p className="mt-2 text-xs font-semibold text-brand-green-deep">
                      Corrected image accepted — included in Submit valid.
                    </p>
                  ) : null}
                  {item.status !== "submitted" ? (
                    <SmartUploadCaptionAssistant
                      state={item.captionAssistant}
                      disabled={busy}
                      generating={generatingCaptionFileId === item.id}
                      generationReady={captionGenerationUi(item).ready}
                      generationReadyReason={captionGenerationUi(item).reason}
                      onChange={(next) => updateCaptionAssistant(item.id, next)}
                      onGenerate={() => void runCaptionGeneration(item.id)}
                      onKeepStaleCaption={() =>
                        updateCaptionAssistant(
                          item.id,
                          acknowledgeStaleCaption(
                            item.captionAssistant,
                            captionFingerprintContext(item, bookId, campaignId),
                          ),
                        )
                      }
                    />
                  ) : null}
                </div>
                <span
                  className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-bold uppercase ${statusTone(item.status)}`}
                >
                  {statusLabel(item.status)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <SecondaryButton type="button" disabled={busy || !files.some((f) => f.status === "ready" && !f.uploadIntent)} onClick={() => void prepareAll()}>
            Upload &amp; validate
          </SecondaryButton>
          <PrimaryButton
            type="button"
            disabled={busy || submittableCount === 0}
            onClick={() => void submitValid()}
          >
            Submit valid ({submittableCount})
          </PrimaryButton>
        </div>

        {files.length > 0 ? (
          <p className="mt-3 text-xs text-brand-charcoal/60">
            Submitted {summary.submitted} · Needs attention {summary.needs_attention} · Failed{" "}
            {summary.failed} · Ready {summary.ready}
          </p>
        ) : null}
        {sessionMessage ? (
          <p className="mt-2 text-sm font-semibold text-brand-orange-deep">{sessionMessage}</p>
        ) : null}
      </Card>
    </div>
  );
}
