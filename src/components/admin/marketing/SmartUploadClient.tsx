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
  const [batchId] = useState(() => crypto.randomUUID());
  const [caption, setCaption] = useState("");
  const [weeklyPlanId, setWeeklyPlanId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [bookId, setBookId] = useState("");
  const [files, setFiles] = useState<SmartUploadFile[]>([]);
  const filesRef = useRef<SmartUploadFile[]>([]);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  const [plans, setPlans] = useState<WeeklyPlanOption[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewGeneratingEntryId, setPreviewGeneratingEntryId] = useState<string | null>(null);
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

  function updateFile(id: string, patch: Partial<SmartUploadFile>) {
    setFiles((prev) => {
      const next = prev.map((item) => (item.id === id ? { ...item, ...patch } : item));
      filesRef.current = next;
      return next;
    });
  }

  function getFileById(id: string): SmartUploadFile | undefined {
    return filesRef.current.find((item) => item.id === id);
  }

  async function uploadAndValidateOne(entry: SmartUploadFile): Promise<void> {
    updateFile(entry.id, { status: "uploading", error: null, validationIssues: [] });

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
      updateFile(entry.id, { status: "validating" });
      const form = new FormData();
      form.set("image", entry.file);
      const response = await fetch(VALIDATE_URL, { method: "POST", body: form });
      if (response.status === 422) {
        const json = (await response.json()) as {
          issues?: Array<{ code: string; message: string; platform?: string }>;
        };
        updateFile(entry.id, {
          status: "needs_attention",
          error: json.issues?.map((i) => i.message).join(" ") ?? "Validation failed.",
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
      updateFile(entry.id, {
        status: "ready",
        error: null,
        validationIssues: [],
        uploadIntent: "local-multipart",
        pathname: "local-multipart",
        publicUrl: "local-multipart",
      });
      return;
    }

    if (!intentRes.ok) {
      const message =
        intentRes.status === 503
          ? resourceBlobStorageUnavailableMessage()
          : await parseApiError(intentRes);
      updateFile(entry.id, { status: "failed", error: message });
      return;
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
      updateFile(entry.id, {
        status: "failed",
        error: await parseApiError(urlRes),
      });
      return;
    }

    const urlJson = (await urlRes.json()) as {
      presignedUrl: string;
      publicUrl?: string;
      pathname: string;
    };

    const headers: HeadersInit = {};
    if (entry.file.type) headers["Content-Type"] = entry.file.type;
    const putRes = await fetch(urlJson.presignedUrl, {
      method: "PUT",
      body: entry.file,
      headers,
    });
    if (!putRes.ok) {
      updateFile(entry.id, {
        status: "failed",
        error: `Direct blob upload failed (${putRes.status}).`,
      });
      return;
    }

    const publicUrl = urlJson.publicUrl ?? "";
    updateFile(entry.id, {
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
      updateFile(entry.id, {
        status: "needs_attention",
        error: json.issues?.map((i) => i.message).join(" ") ?? "Validation failed.",
        validationIssues: json.issues ?? [],
        uploadIntent: intentJson.uploadIntent,
        pathname: urlJson.pathname,
        publicUrl,
      });
      return;
    }
    if (!validateRes.ok) {
      updateFile(entry.id, {
        status: "failed",
        error: await parseApiError(validateRes),
        uploadIntent: intentJson.uploadIntent,
        pathname: urlJson.pathname,
        publicUrl,
      });
      return;
    }

    updateFile(entry.id, {
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

  async function finalizeOne(entry: SmartUploadFile): Promise<void> {
    const derivative = entry.acceptedPreview;
    if (!entry.uploadIntent || !entry.pathname || !entry.publicUrl) return;
    updateFile(entry.id, { status: "validating", error: null });

    let response: Response;
    if (entry.uploadIntent === "local-multipart") {
      const form = new FormData();
      form.set("image", entry.file);
      form.set("caption", caption.trim());
      form.set("batchId", batchId);
      form.set("finalizeKey", entry.finalizeKey);
      if (weeklyPlanId) form.set("weeklyPlanId", weeklyPlanId);
      if (campaignId) form.set("campaignId", campaignId);
      if (bookId) form.set("bookId", bookId);
      response = await fetch(FINALIZE_URL, { method: "POST", body: form });
    } else {
      const body: Record<string, unknown> = {
        caption: caption.trim(),
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
    if (!caption.trim()) {
      setSessionMessage("Caption is required before submitting.");
      return;
    }

    setBusy(true);
    const snapshot = [...filesRef.current];
    for (const entry of snapshot) {
      if (entry.status === "submitted" || entry.status === "needs_attention") continue;
      const latest = getFileById(entry.id) ?? entry;
      if (!latest.uploadIntent) {
        await uploadAndValidateOne(latest);
      }
      const afterUpload = getFileById(entry.id);
      if (afterUpload?.status === "ready" && afterUpload.uploadIntent) {
        await finalizeOne(afterUpload);
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
        <p className="mt-2 text-xs text-brand-charcoal/50">Session batch ID: {batchId}</p>
      </Card>

      <Card className="space-y-4">
        <label className="block text-sm font-bold">
          Caption (shared for Instagram and Facebook)
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={4}
            className="mt-1 w-full rounded-xl border border-brand-brown/20 p-3 text-sm"
            placeholder="Write one caption copied to both platforms…"
          />
        </label>
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
                                  {item.publicUrl ? (
                                    <img
                                      src={item.publicUrl}
                                      alt="Original upload"
                                      className="max-h-48 w-full rounded-lg border border-brand-brown/15 object-contain bg-white"
                                    />
                                  ) : null}
                                </div>
                                <div>
                                  <p className="mb-1 text-xs font-bold text-brand-charcoal/70">Preview</p>
                                  <img
                                    src={item.preview.publicUrl}
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
