"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import booksData from "@/data/books.json";
import { MAX_MARKETING_IMAGE_BYTES } from "@/lib/marketing/upload-limits";
import {
  resourceBlobStorageUnavailableMessage,
  shouldUseResourceMultipartFallbackWhenBlobUnavailable,
} from "@/lib/marketing/resource-multipart-fallback";
import { canStartPreviewGeneration } from "@/lib/marketing/smart-upload-preview-client";
import { smartUploadStagedImageUrl } from "@/lib/marketing/smart-upload-staged-image-url";
import {
  createSmartUploadSessionBatchId,
  SMART_UPLOAD_SESSION_BATCH_ID_UNASSIGNED,
} from "@/lib/marketing/smart-upload-session-batch";
import {
  acknowledgeStaleCaption,
  buildCaptionFinalizePayload,
  createDefaultCaptionAssistantState,
  findSubmitValidCaptionPreflightIssue,
  hasReviewedDraftContentForMode,
  refreshCaptionAssistantStale,
  type CaptionAssistantState,
  type CaptionFinalizePayload,
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
import {
  assertAtLeastOneDestination,
  metaDestinationsSelected,
  normalizeSmartUploadDestinations,
  SMART_UPLOAD_DESTINATIONS_ALL,
  type SmartUploadDestinations,
} from "@/lib/marketing/smart-upload-destinations";
import {
  countSmartUploadSubmitTargets,
  createNextSmartUploadSessionBatchId,
  defaultSmartUploadClientFormState,
  formatSmartUploadSubmitSuccessMessage,
  shouldAutoResetSmartUploadAfterSubmitValid,
} from "@/lib/marketing/smart-upload-client-session";
import { localMultipartSmartUploadFinalizeBlockedReason } from "@/lib/marketing/smart-upload-multipart";
import {
  deriveUploadStatusAfterValidation,
  isCaptionImagePreparationReady,
  isMetaImageReady,
  isPinterestImageReady,
  isSmartUploadSubmissionReady,
  metaImageNeedsAspectFix,
  onlyAspectRatioIssues,
  pinterestImageNeedsAspectFix,
  validationIssuesAfterAcceptingMetaFix,
  validationIssuesAfterAcceptingPinterestFix,
} from "@/lib/marketing/smart-upload-ui-readiness";
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
type FixTargetRatio = "4:5" | "1:1" | "2:3";
type PreviewRole = "meta" | "pinterest";

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
  metaFixPanelOpen: boolean;
  pinterestFixPanelOpen: boolean;
  fixStrategy: FixStrategy;
  fixTargetRatio: FixTargetRatio;
  metaPreview: PreviewState | null;
  pinterestPreview: PreviewState | null;
  acceptedPreview: PreviewState | null;
  acceptedPinterestPreview: PreviewState | null;
  pinterestFixStrategy: FixStrategy;
  pinterestFixTargetRatio: FixTargetRatio;
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
    metaFixPanelOpen: false,
    pinterestFixPanelOpen: false,
    fixStrategy: "pad",
    fixTargetRatio: "4:5",
    metaPreview: null,
    pinterestPreview: null,
    acceptedPreview: null,
    acceptedPinterestPreview: null,
    pinterestFixStrategy: "pad",
    pinterestFixTargetRatio: "2:3",
    captionAssistant: createDefaultCaptionAssistantState(),
  };
}

function formatTargetRatioLabel(targetRatio: FixTargetRatio): string {
  if (targetRatio === "2:3") return "2:3";
  if (targetRatio === "4:5") return "4:5";
  return "Square";
}

function submissionReadyForFile(
  item: SmartUploadFile,
  selectedDestinations: SmartUploadDestinations,
): boolean {
  return isSmartUploadSubmissionReady(
    selectedDestinations,
    item.validationIssues,
    Boolean(item.acceptedPreview),
    Boolean(item.acceptedPinterestPreview),
  );
}

function captionGenerationFileSnapshot(
  item: SmartUploadFile,
  selectedDestinations: SmartUploadDestinations,
): CaptionGenerationFileSnapshot {
  return {
    uploadIntent: item.uploadIntent,
    pathname: item.pathname,
    publicUrl: item.publicUrl,
    status: item.status,
    error: item.error,
    finalizeKey: item.finalizeKey,
    fixStrategy: item.fixStrategy,
    fixTargetRatio: item.fixTargetRatio,
    captionImagePreparationReady: isCaptionImagePreparationReady(
      selectedDestinations,
      item.validationIssues,
      Boolean(item.acceptedPreview),
    ),
    acceptedPreview: item.acceptedPreview
      ? {
          uploadIntent: item.acceptedPreview.uploadIntent,
          pathname: item.acceptedPreview.pathname,
          strategy: item.acceptedPreview.strategy,
          targetRatio: item.acceptedPreview.targetRatio,
        }
      : null,
    preview: item.metaPreview
      ? { strategy: item.metaPreview.strategy, targetRatio: item.metaPreview.targetRatio }
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

function canUseInBrowserFixWorkflow(item: SmartUploadFile): boolean {
  if (!item.validationIssues.length) return false;
  if (!item.uploadIntent || !item.pathname || !item.publicUrl) return false;
  if (item.uploadIntent === "local-multipart") return false;
  return onlyAspectRatioIssues(item.validationIssues);
}

function previewMatchesSettings(
  preview: PreviewState | null,
  strategy: FixStrategy,
  targetRatio: FixTargetRatio,
): boolean {
  return Boolean(preview && preview.strategy === strategy && preview.targetRatio === targetRatio);
}

function appendSmartUploadMultipartDestinations(
  form: FormData,
  selectedDestinations: SmartUploadDestinations,
): void {
  form.set("destinations", JSON.stringify(selectedDestinations));
}

function appendSmartUploadMultipartFinalizeFields(
  form: FormData,
  selectedDestinations: SmartUploadDestinations,
  captions: CaptionFinalizePayload,
): void {
  appendSmartUploadMultipartDestinations(form, selectedDestinations);
  form.set("pinterestTitle", captions.pinterestTitle ?? "");
  form.set("pinterestDescription", captions.pinterestDescription ?? "");
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
  const [destinations, setDestinations] = useState<SmartUploadDestinations>({
    ...SMART_UPLOAD_DESTINATIONS_ALL,
  });
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
  const [submitSuccessMessage, setSubmitSuccessMessage] = useState<string | null>(null);
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
    if (busy) return;
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
    if (!filesRef.current.some((entry) => entry.id === id)) return;
    commitFile(id, patch);
  }

  function updateCaptionAssistant(id: string, nextAssistant: CaptionAssistantState) {
    if (!filesRef.current.some((entry) => entry.id === id)) return;
    commitFile(id, { captionAssistant: nextAssistant });
  }

  function getFileById(id: string): SmartUploadFile | undefined {
    return filesRef.current.find((item) => item.id === id);
  }

  const destinationsJson = JSON.stringify(destinations);
  const prevDestinationsJsonRef = useRef(destinationsJson);

  function resetSmartUploadWorkspace(successMessage: string | null) {
    const formDefaults = defaultSmartUploadClientFormState();
    filesRef.current = [];
    setFiles([]);
    setWeeklyPlanId(formDefaults.weeklyPlanId);
    setCampaignId(formDefaults.campaignId);
    setBookId(formDefaults.bookId);
    setDestinations(formDefaults.destinations);
    prevDestinationsJsonRef.current = JSON.stringify(formDefaults.destinations);
    setBatchId(createNextSmartUploadSessionBatchId());
    captionGenerationSeqRef.current.clear();
    setPreviewGeneratingEntryId(null);
    setGeneratingCaptionFileId(null);
    setSessionMessage(null);
    setSubmitSuccessMessage(successMessage);
    if (inputRef.current) inputRef.current.value = "";
  }
  useEffect(() => {
    if (prevDestinationsJsonRef.current === destinationsJson) return;
    prevDestinationsJsonRef.current = destinationsJson;
    setFiles((prev) => {
      let touched = false;
      const next = prev.map((item) => {
        if (item.uploadIntent !== "local-multipart") return item;
        touched = true;
        return mergeSmartUploadFile(item, {
          status: "needs_attention",
          error: "Upload & validate again after changing destinations.",
          validationIssues: [],
        });
      });
      if (touched) filesRef.current = next;
      return touched ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mergeSmartUploadFile uses bookId/campaignId from closure
  }, [destinationsJson, bookId, campaignId]);

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
      previewDerivative: entry.metaPreview
        ? { strategy: entry.metaPreview.strategy, targetRatio: entry.metaPreview.targetRatio }
        : null,
      fixStrategy: entry.fixStrategy,
      fixTargetRatio: entry.fixTargetRatio,
      mode: captionAssistant.mode,
      shared: captionAssistant.shared,
      facebook: captionAssistant.facebook,
      instagram: captionAssistant.instagram,
      pinterest: captionAssistant.pinterest,
      destinations,
      generatedFrom: captionAssistant.generatedFrom,
      stale: captionAssistant.stale,
      staleAcknowledged: captionAssistant.staleAcknowledged,
    };
  }

  function captionGenerationUi(item: SmartUploadFile): { ready: boolean; reason?: string } {
    if (item.status === "submitted" || item.status === "failed") {
      return { ready: false, reason: "This image cannot be used for caption generation." };
    }
    if (!item.uploadIntent || !item.pathname) {
      return { ready: false, reason: "Upload and validate this image before generating a caption." };
    }
    if (
      !isCaptionImagePreparationReady(
        destinations,
        item.validationIssues,
        Boolean(item.acceptedPreview),
      )
    ) {
      return {
        ready: false,
        reason: "Fix Meta image validation issues before generating a caption.",
      };
    }
    const assessed = assessCaptionGenerationReadiness({
      status: "ready",
      uploadIntent: item.uploadIntent,
      pathname: item.pathname,
      acceptedPreview: item.acceptedPreview
        ? {
            strategy: item.acceptedPreview.strategy,
            targetRatio: item.acceptedPreview.targetRatio,
          }
        : null,
      preview: item.metaPreview
        ? { strategy: item.metaPreview.strategy, targetRatio: item.metaPreview.targetRatio }
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

    if (hasReviewedDraftContentForMode(initial.captionAssistant)) {
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
      captionGenerationFileSnapshot(fileForStaging, destinations),
      async () => {
        const latest = getFileById(fileId) ?? fileForStaging;
        const staged = await uploadAndValidateOne(latest);
        return captionGenerationFileSnapshot(staged, destinations);
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

    const assistant = file.captionAssistant;
    const explicitCta =
      assistant.mode === "shared"
        ? assistant.shared.cta.trim() || null
        : assistant.instagram.cta.trim() || assistant.facebook.cta.trim() || null;
    const fpContext = captionFingerprintContext(file, bookId, campaignId);
    const snapshot = buildGenerationSnapshotForRequest(fpContext, explicitCta);
    const requestBody = buildGenerateCaptionsRequestBody({
      mode: assistant.mode,
      instructions: assistant.instructions,
      explicitCta,
      bookId: bookId.trim() || null,
      campaignId: campaignId.trim() || null,
      advanced: assistant.advanced,
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
      appendSmartUploadMultipartDestinations(form, destinations);
      const response = await fetch(VALIDATE_URL, { method: "POST", body: form });
      if (response.status === 422) {
        const json = (await response.json()) as {
          issues?: Array<{ code: string; message: string; platform?: string }>;
        };
        const validationIssues = json.issues ?? [];
        return commitFile(fileId, {
          status: deriveUploadStatusAfterValidation(
            destinations,
            validationIssues,
            false,
            false,
          ),
          error: validationIssues.map((i) => i.message).join(" ") || "Validation failed.",
          validationIssues,
          uploadIntent: "local-multipart",
          pathname: "local-multipart",
          publicUrl: "local-multipart",
        });
      }
      if (!response.ok) {
        return commitFile(fileId, {
          status: "failed",
          error: await parseApiError(response),
        });
      }
      return commitFile(fileId, {
        status: deriveUploadStatusAfterValidation(destinations, [], false, false),
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
        destinations,
      }),
    });

    if (validateRes.status === 422) {
      const json = (await validateRes.json()) as {
        issues?: Array<{ code: string; message: string; platform?: string }>;
      };
      const validationIssues = json.issues ?? [];
      const afterUpload = {
        uploadIntent: intentJson.uploadIntent,
        pathname: urlJson.pathname,
        publicUrl,
        acceptedPreview: file.acceptedPreview,
        acceptedPinterestPreview: file.acceptedPinterestPreview,
      };
      const needsMetaFix = metaImageNeedsAspectFix(
        destinations,
        validationIssues,
        Boolean(file.acceptedPreview),
      );
      const needsPinFix = pinterestImageNeedsAspectFix(
        destinations,
        validationIssues,
        Boolean(file.acceptedPinterestPreview),
      );
      return commitFile(fileId, {
        status: deriveUploadStatusAfterValidation(
          destinations,
          validationIssues,
          Boolean(file.acceptedPreview),
          Boolean(file.acceptedPinterestPreview),
        ),
        error: validationIssues.map((i) => i.message).join(" ") || "Validation failed.",
        validationIssues,
        metaFixPanelOpen: needsMetaFix,
        pinterestFixPanelOpen: needsPinFix,
        ...afterUpload,
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

  async function generatePreview(entry: SmartUploadFile, role: PreviewRole): Promise<void> {
    if (!entry.uploadIntent || !entry.pathname || !entry.publicUrl) return;
    if (!canStartPreviewGeneration(entry.id, previewGeneratingEntryId)) return;

    setPreviewGeneratingEntryId(entry.id);
    const previousPreview = role === "pinterest" ? entry.pinterestPreview : entry.metaPreview;
    updateFile(entry.id, {
      ...(role === "pinterest"
        ? { acceptedPinterestPreview: null }
        : { acceptedPreview: null }),
      error: null,
    });

    try {
      if (previousPreview) {
        await discardPreviewForEntry(entry, previousPreview);
      }
      updateFile(entry.id, { status: "validating" });
      const strategy = role === "pinterest" ? entry.pinterestFixStrategy : entry.fixStrategy;
      const targetRatio =
        role === "pinterest" ? entry.pinterestFixTargetRatio : entry.fixTargetRatio;
      const response = await fetch(PREVIEW_FIX_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          finalizeKey: entry.finalizeKey,
          uploadIntent: entry.uploadIntent,
          pathname: entry.pathname,
          publicUrl: entry.publicUrl,
          strategy,
          targetRatio,
          destinations,
          imageFilename: entry.file.name,
        }),
      });
      if (!response.ok) {
        updateFile(entry.id, {
          status: deriveUploadStatusAfterValidation(
            destinations,
            entry.validationIssues,
            Boolean(entry.acceptedPreview),
            Boolean(entry.acceptedPinterestPreview),
          ),
          error: await parseApiError(response),
        });
        return;
      }
      const json = (await response.json()) as {
        preview: PreviewState;
      };
      const latest = getFileById(entry.id) ?? entry;
      const nextIssues = latest.validationIssues;
      updateFile(entry.id, {
        status: deriveUploadStatusAfterValidation(
          destinations,
          nextIssues,
          Boolean(latest.acceptedPreview),
          Boolean(latest.acceptedPinterestPreview),
        ),
        error: null,
        ...(role === "pinterest"
          ? { pinterestPreview: json.preview }
          : { metaPreview: json.preview }),
      });
    } finally {
      setPreviewGeneratingEntryId(null);
    }
  }

  async function discardPreviewAction(entry: SmartUploadFile, role: PreviewRole): Promise<void> {
    const preview = role === "pinterest" ? entry.pinterestPreview : entry.metaPreview;
    if (preview) {
      await discardPreviewForEntry(entry, preview);
    }
    updateFile(entry.id, {
      ...(role === "pinterest" ? { pinterestPreview: null } : { metaPreview: null }),
      status: deriveUploadStatusAfterValidation(
        destinations,
        entry.validationIssues,
        Boolean(entry.acceptedPreview),
        Boolean(entry.acceptedPinterestPreview),
      ),
    });
  }

  function acceptPreview(entry: SmartUploadFile, role: PreviewRole): void {
    const preview = role === "pinterest" ? entry.pinterestPreview : entry.metaPreview;
    if (!preview) return;
    const strategy = role === "pinterest" ? entry.pinterestFixStrategy : entry.fixStrategy;
    const targetRatio =
      role === "pinterest" ? entry.pinterestFixTargetRatio : entry.fixTargetRatio;
    if (!previewMatchesSettings(preview, strategy, targetRatio)) {
      return;
    }
    if (role === "pinterest") {
      const validationIssues = validationIssuesAfterAcceptingPinterestFix(entry.validationIssues);
      updateFile(entry.id, {
        acceptedPinterestPreview: preview,
        pinterestPreview: null,
        validationIssues,
        status: deriveUploadStatusAfterValidation(
          destinations,
          validationIssues,
          Boolean(entry.acceptedPreview),
          true,
        ),
        error: null,
      });
      return;
    }
    const validationIssues = validationIssuesAfterAcceptingMetaFix(entry.validationIssues);
    updateFile(entry.id, {
      acceptedPreview: preview,
      metaPreview: null,
      validationIssues,
      status: deriveUploadStatusAfterValidation(
        destinations,
        validationIssues,
        true,
        Boolean(entry.acceptedPinterestPreview),
      ),
      error: null,
    });
  }

  async function finalizeOne(entry: SmartUploadFile, captions: CaptionFinalizePayload): Promise<void> {
    if (!batchId) return;
    const derivative = entry.acceptedPreview;
    if (!entry.uploadIntent || !entry.pathname || !entry.publicUrl) return;
    updateFile(entry.id, { status: "validating", error: null });

    let response: Response;
    if (entry.uploadIntent === "local-multipart") {
      const multipartBlock = localMultipartSmartUploadFinalizeBlockedReason(destinations, {
        acceptedMetaPreview: Boolean(entry.acceptedPreview),
        acceptedPinterestPreview: Boolean(entry.acceptedPinterestPreview),
        validationIssues: entry.validationIssues,
      });
      if (multipartBlock) {
        updateFile(entry.id, {
          status: "needs_attention",
          error: multipartBlock,
        });
        return;
      }
      const form = new FormData();
      form.set("image", entry.file);
      if (captions.mode === "per_platform") {
        form.set("facebookCaption", captions.facebookCaption);
        form.set("instagramCaption", captions.instagramCaption);
      } else {
        form.set("caption", captions.caption);
      }
      form.set("batchId", batchId);
      form.set("finalizeKey", entry.finalizeKey);
      if (weeklyPlanId) form.set("weeklyPlanId", weeklyPlanId);
      if (campaignId) form.set("campaignId", campaignId);
      if (bookId) form.set("bookId", bookId);
      appendSmartUploadMultipartFinalizeFields(form, destinations, captions);
      response = await fetch(FINALIZE_URL, { method: "POST", body: form });
    } else {
      const body: Record<string, unknown> = {
        batchId,
        finalizeKey: entry.finalizeKey,
        weeklyPlanId: weeklyPlanId || null,
        campaignId: campaignId || null,
        bookId: bookId || null,
        imageFilename: entry.file.name,
        destinations,
        pinterestTitle: captions.pinterestTitle,
        pinterestDescription: captions.pinterestDescription,
      };
      if (captions.mode === "per_platform") {
        body.facebookCaption = captions.facebookCaption;
        body.instagramCaption = captions.instagramCaption;
      } else {
        body.caption = captions.caption;
      }
      const pinDerivative = entry.acceptedPinterestPreview;
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
      if (pinDerivative && destinations.pinterest) {
        body.pinterestUploadIntent = pinDerivative.uploadIntent;
        body.pinterestPathname = pinDerivative.pathname;
        body.pinterestPublicUrl = pinDerivative.publicUrl;
        body.pinterestFixStrategy = pinDerivative.strategy;
        body.pinterestFixTargetRatio = pinDerivative.targetRatio;
        body.pinterestOriginalUploadIntent = entry.uploadIntent;
        body.pinterestOriginalPathname = entry.pathname;
        body.pinterestOriginalPublicUrl = entry.publicUrl;
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
    setSubmitSuccessMessage(null);
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
      if (entry.status === "submitted") continue;
      const latest = getFileById(entry.id) ?? entry;
      if (!latest.uploadIntent) {
        await uploadAndValidateOne(latest);
      }
      const afterUpload = getFileById(entry.id);
      if (
        afterUpload?.uploadIntent &&
        submissionReadyForFile(afterUpload, destinations)
      ) {
        const finalizeCaptions = buildCaptionFinalizePayload(afterUpload.captionAssistant);
        await finalizeOne(afterUpload, finalizeCaptions);
      }
    }
    setBusy(false);

    const afterSubmit = filesRef.current.map((item) => ({ id: item.id, status: item.status }));
    const submitSnapshot = snapshot.map((item) => ({ id: item.id, status: item.status }));
    if (shouldAutoResetSmartUploadAfterSubmitValid(submitSnapshot, afterSubmit)) {
      const submittedCount = countSmartUploadSubmitTargets(submitSnapshot);
      resetSmartUploadWorkspace(formatSmartUploadSubmitSuccessMessage(submittedCount));
    }
  }

  const submittableCount = files.filter(
    (f) => f.uploadIntent && submissionReadyForFile(f, destinations),
  ).length;

  return (
    <div className="space-y-6">
      <Card>
        <p className="text-sm text-brand-charcoal/70">
          Upload once to create Facebook, Instagram, and/or Pinterest content (needs review). The
          server validates each selected destination and can produce separate Meta and Pinterest
          image versions before finalize.
        </p>
        <fieldset className="mt-4 flex flex-wrap gap-4 text-sm font-bold">
          <legend className="sr-only">Destinations</legend>
          {(
            [
              ["facebook", "Facebook"],
              ["instagram", "Instagram"],
              ["pinterest", "Pinterest"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={destinations[key]}
                onChange={(e) => {
                  const next = { ...destinations, [key]: e.target.checked };
                  try {
                    assertAtLeastOneDestination(next);
                    setDestinations(next);
                  } catch {
                    setSessionMessage("At least one platform must remain selected.");
                  }
                }}
              />
              {label}
            </label>
          ))}
        </fieldset>
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
            if (busy) return;
            addFiles(e.dataTransfer.files);
          }}
          aria-busy={busy}
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
            disabled={busy}
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={busy}
            className="mt-4 inline-flex h-10 items-center rounded-xl border border-brand-brown/25 bg-white px-4 text-sm font-bold text-brand-blue-deep hover:bg-cream disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => inputRef.current?.click()}
          >
            Choose images
          </button>
        </div>

        {files.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {files.map((item) => {
              const metaReady = isMetaImageReady(
                destinations,
                item.validationIssues,
                Boolean(item.acceptedPreview),
              );
              const pinReady = isPinterestImageReady(
                destinations,
                item.validationIssues,
                Boolean(item.acceptedPinterestPreview),
              );
              const needsMetaFix = metaImageNeedsAspectFix(
                destinations,
                item.validationIssues,
                Boolean(item.acceptedPreview),
              );
              const needsPinFix = pinterestImageNeedsAspectFix(
                destinations,
                item.validationIssues,
                Boolean(item.acceptedPinterestPreview),
              );
              const renderDestinationFix = (
                role: PreviewRole,
                panelOpen: boolean,
                panelKey: "metaFixPanelOpen" | "pinterestFixPanelOpen",
                preview: PreviewState | null,
                strategy: FixStrategy,
                targetRatio: FixTargetRatio,
                strategyKey: "fixStrategy" | "pinterestFixStrategy",
                targetKey: "fixTargetRatio" | "pinterestFixTargetRatio",
                previewKey: "metaPreview" | "pinterestPreview",
                accepted: PreviewState | null,
                title: string,
                targetRatios: FixTargetRatio[],
              ) => (
                <div className="mt-3 space-y-3 rounded-lg border border-brand-brown/15 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-bold text-brand-navy">{title}</p>
                    {accepted ? (
                      <span className="text-xs font-semibold text-brand-green-deep">Ready</span>
                    ) : (role === "pinterest" ? needsPinFix : needsMetaFix) ? (
                      <span className="text-xs font-semibold text-brand-orange-deep">Needs fix</span>
                    ) : null}
                  </div>
                  {accepted ? (
                    <img
                      src={smartUploadStagedImageUrl({
                        pathname: accepted.pathname,
                        uploadIntent: accepted.uploadIntent,
                      })}
                      alt={`${title} accepted`}
                      className="max-h-48 w-full rounded-lg border border-brand-brown/15 object-contain bg-white"
                    />
                  ) : null}
                  {!accepted && (panelOpen || preview) ? (
                    <>
                      <fieldset className="space-y-2 text-sm">
                        <p className="font-semibold text-brand-charcoal">Strategy</p>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`${role}-strategy-${item.id}`}
                            checked={strategy === "pad"}
                            onChange={() =>
                              updateFile(item.id, {
                                [strategyKey]: "pad",
                                [previewKey]: null,
                                ...(role === "meta" ? { acceptedPreview: null } : {}),
                                ...(role === "pinterest" ? { acceptedPinterestPreview: null } : {}),
                              })
                            }
                          />
                          Fit with padding
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`${role}-strategy-${item.id}`}
                            checked={strategy === "crop"}
                            onChange={() =>
                              updateFile(item.id, {
                                [strategyKey]: "crop",
                                [previewKey]: null,
                                ...(role === "meta" ? { acceptedPreview: null } : {}),
                                ...(role === "pinterest" ? { acceptedPinterestPreview: null } : {}),
                              })
                            }
                          />
                          Crop
                        </label>
                        <p className="pt-1 font-semibold text-brand-charcoal">Target ratio</p>
                        {targetRatios.map((ratio) => (
                          <label key={ratio} className="flex items-center gap-2">
                            <input
                              type="radio"
                              name={`${role}-target-${item.id}`}
                              checked={targetRatio === ratio}
                              onChange={() =>
                                updateFile(item.id, {
                                  [targetKey]: ratio,
                                  [previewKey]: null,
                                  ...(role === "meta" ? { acceptedPreview: null } : {}),
                                  ...(role === "pinterest" ? { acceptedPinterestPreview: null } : {}),
                                })
                              }
                            />
                            {formatTargetRatioLabel(ratio)}
                          </label>
                        ))}
                      </fieldset>
                      <SecondaryButton
                        type="button"
                        disabled={
                          busy || !canStartPreviewGeneration(item.id, previewGeneratingEntryId)
                        }
                        onClick={() => void generatePreview(item, role)}
                      >
                        Generate preview
                      </SecondaryButton>
                      {preview ? (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold text-brand-charcoal">
                            Preview · {preview.strategy === "pad" ? "Fit with padding" : "Crop"} ·{" "}
                            {formatTargetRatioLabel(preview.targetRatio)} ({preview.width}×
                            {preview.height})
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
                                  pathname: preview.pathname,
                                  uploadIntent: preview.uploadIntent,
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
                              onClick={() => void discardPreviewAction(item, role)}
                            >
                              Discard
                            </SecondaryButton>
                            <PrimaryButton
                              type="button"
                              disabled={
                                busy || !previewMatchesSettings(preview, strategy, targetRatio)
                              }
                              onClick={() => acceptPreview(item, role)}
                            >
                              Use this image
                            </PrimaryButton>
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : !accepted ? (
                    <SecondaryButton
                      type="button"
                      disabled={busy}
                      onClick={() => updateFile(item.id, { [panelKey]: true })}
                    >
                      Fix + Preview
                    </SecondaryButton>
                  ) : null}
                </div>
              );

              return (
              <li
                key={item.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-brand-brown/15 bg-cream-deep/30 px-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-brand-charcoal">{item.file.name}</p>
                  <p className="text-xs text-brand-charcoal/55">
                    {(item.file.size / 1024).toFixed(0)} KB
                  </p>
                  {item.uploadIntent && item.pathname ? (
                    <ul className="mt-2 space-y-1 text-xs font-semibold text-brand-charcoal">
                      {metaDestinationsSelected(destinations) ? (
                        <li className={metaReady ? "text-brand-green-deep" : "text-brand-orange-deep"}>
                          Meta (Facebook / Instagram): {metaReady ? "Ready" : "Needs attention"}
                        </li>
                      ) : null}
                      {destinations.pinterest ? (
                        <li className={pinReady ? "text-brand-green-deep" : "text-brand-orange-deep"}>
                          Pinterest: {pinReady ? "Ready" : "Needs attention"}
                        </li>
                      ) : null}
                    </ul>
                  ) : null}
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
                  {canUseInBrowserFixWorkflow(item) ? (
                    <div className="mt-2 space-y-2">
                      {(metaDestinationsSelected(destinations) && (needsMetaFix || item.acceptedPreview)) ||
                      metaReady ? (
                        metaReady && !needsMetaFix && !item.acceptedPreview ? (
                          <p className="text-xs font-semibold text-brand-green-deep">
                            Meta feed image is ready (original upload).
                          </p>
                        ) : (
                          renderDestinationFix(
                            "meta",
                            item.metaFixPanelOpen,
                            "metaFixPanelOpen",
                            item.metaPreview,
                            item.fixStrategy,
                            item.fixTargetRatio,
                            "fixStrategy",
                            "fixTargetRatio",
                            "metaPreview",
                            item.acceptedPreview,
                            "Meta feed (Facebook / Instagram)",
                            ["4:5", "1:1"],
                          )
                        )
                      ) : null}
                      {destinations.pinterest && (needsPinFix || item.acceptedPinterestPreview) ? (
                        renderDestinationFix(
                          "pinterest",
                          item.pinterestFixPanelOpen,
                          "pinterestFixPanelOpen",
                          item.pinterestPreview,
                          item.pinterestFixStrategy,
                          item.pinterestFixTargetRatio,
                          "pinterestFixStrategy",
                          "pinterestFixTargetRatio",
                          "pinterestPreview",
                          item.acceptedPinterestPreview,
                          "Pinterest pin (2:3)",
                          ["2:3"],
                        )
                      ) : null}
                    </div>
                  ) : item.status === "needs_attention" ? (
                    <p className="mt-2 text-xs text-brand-charcoal/70">
                      This issue cannot be fixed here. Adjust the file and upload again.
                    </p>
                  ) : null}
                  {submissionReadyForFile(item, destinations) ? (
                    <p className="mt-2 text-xs font-semibold text-brand-green-deep">
                      All selected destinations are ready for Submit valid.
                    </p>
                  ) : null}
                  {item.status !== "submitted" ? (
                    <SmartUploadCaptionAssistant
                      state={item.captionAssistant}
                      showPinterest={destinations.pinterest}
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
            );
            })}
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
        {submitSuccessMessage ? (
          <p
            role="status"
            aria-live="polite"
            className="mt-2 text-sm font-semibold text-brand-green-deep"
          >
            {submitSuccessMessage}
          </p>
        ) : null}
        {sessionMessage ? (
          <p className="mt-2 text-sm font-semibold text-brand-orange-deep">{sessionMessage}</p>
        ) : null}
      </Card>
    </div>
  );
}
