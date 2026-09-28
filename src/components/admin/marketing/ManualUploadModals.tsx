"use client";

import { useRef, useState, type RefObject } from "react";
import booksData from "@/data/books.json";
import { Card, PrimaryButton, SecondaryButton } from "./ui";

const BOOKS = booksData.books as Array<{ id: string; title: string }>;

const CATEGORIES = [
  "educational",
  "brand_story",
  "product_feature",
  "engagement",
  "trust",
  "conversion",
  "community",
] as const;

const AUDIENCES = ["parents", "hospitals", "schools", "libraries"] as const;

const RESOURCE_TYPES = [
  { id: "coloring_page", label: "Coloring page" },
  { id: "word_search", label: "Word search" },
  { id: "crossword", label: "Crossword" },
  { id: "maze", label: "Maze" },
  { id: "worksheet", label: "Worksheet" },
  { id: "activity_sheet", label: "Activity sheet" },
  { id: "other", label: "Other" },
] as const;

type ModalProps = {
  weeklyPlanId: string;
  busy: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
  setMessage: (message: string | null) => void;
};

export function UploadPostModal({ weeklyPlanId, busy, onClose, onDone, setMessage }: ModalProps) {
  const [platform, setPlatform] = useState<"instagram" | "facebook" | "pinterest">("instagram");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set("weeklyPlanId", weeklyPlanId);
    data.set("platform", platform);
    data.set("placement", platform === "pinterest" ? "pin" : "feed");
    const response = await fetch("/api/admin/marketing/manual/post", {
      method: "POST",
      body: data,
    });
    const json = await response.json();
    if (!response.ok) {
      setMessage(json.error ?? "Upload failed.");
      return;
    }
    await onDone();
    onClose();
  }

  return (
    <ModalShell title="Upload post" onClose={onClose}>
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <label className="block text-sm font-bold">
          Platform
          <select
            className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2"
            value={platform}
            onChange={(event) => setPlatform(event.target.value as typeof platform)}
          >
            <option value="instagram">Instagram · Feed (single image)</option>
            <option value="facebook">Facebook · Feed (single image)</option>
            <option value="pinterest">Pinterest · Pin (vertical image)</option>
          </select>
        </label>
        <label className="block text-sm font-bold">
          Image
          <input name="image" type="file" accept="image/jpeg,image/png,image/webp" required className="mt-1 block w-full text-sm" />
        </label>
        {platform === "pinterest" ? (
          <>
            <label className="block text-sm font-bold">
              Pin title
              <input name="pinTitle" required maxLength={100} className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm" />
            </label>
            <label className="block text-sm font-bold">
              Pin description
              <textarea name="pinDescription" required rows={4} className="mt-1 w-full rounded-xl border border-brand-brown/20 p-3 text-sm" />
            </label>
            <label className="block text-sm font-bold">
              Alt text
              <input name="pinAltText" required className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm" />
            </label>
          </>
        ) : (
          <label className="block text-sm font-bold">
            Caption
            <textarea name="body" required rows={5} className="mt-1 w-full rounded-xl border border-brand-brown/20 p-3 text-sm" />
          </label>
        )}
        <label className="block text-sm font-bold">
          CTA (optional)
          <input name="cta" className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-bold">
            Category
            <select name="category" defaultValue="educational" className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2">
              {CATEGORIES.map((item) => (
                <option key={item} value={item}>{item.replaceAll("_", " ")}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-bold">
            Audience
            <select name="audience" defaultValue="parents" className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2">
              {AUDIENCES.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-sm font-bold">
          Related book (optional)
          <select name="bookId" defaultValue="" className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2">
            <option value="">None</option>
            {BOOKS.map((book) => (
              <option key={book.id} value={book.id}>{book.title}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-bold">
          Schedule for (optional)
          <input name="scheduledFor" type="datetime-local" className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm" />
        </label>
        <p className="text-xs text-brand-charcoal/60">
          Upload creates a needs_review item. Carousel and Stories are not supported in v1.
          {platform === "pinterest"
            ? " Pinterest images should be vertical (about 2:3, min width 600px)."
            : null}
        </p>
        <div className="flex gap-2">
          <PrimaryButton type="submit" disabled={busy}>Upload</PrimaryButton>
          <SecondaryButton type="button" disabled={busy} onClick={onClose}>Cancel</SecondaryButton>
        </div>
      </form>
    </ModalShell>
  );
}

type ResourceFieldErrors = {
  title?: string;
  description?: string;
  preview?: string;
  file?: string;
};

function validateResourceFields(form: HTMLFormElement): ResourceFieldErrors {
  const errors: ResourceFieldErrors = {};
  const title = (form.elements.namedItem("title") as HTMLInputElement | null)?.value?.trim() ?? "";
  const description =
    (form.elements.namedItem("description") as HTMLTextAreaElement | null)?.value?.trim() ?? "";
  const previewInput = form.elements.namedItem("preview") as HTMLInputElement | null;
  const fileInput = form.elements.namedItem("file") as HTMLInputElement | null;

  if (!title) errors.title = "Title is required.";
  if (!description) errors.description = "Description is required.";
  if (!previewInput?.files?.length) errors.preview = "Choose a preview image.";
  if (!fileInput?.files?.length) errors.file = "Choose a downloadable file.";

  return errors;
}

function hasResourceFieldErrors(errors: ResourceFieldErrors): boolean {
  return Boolean(errors.title || errors.description || errors.preview || errors.file);
}

function ResourceFileUploadField({
  name,
  label,
  chooseLabel,
  acceptHint,
  accept,
  error,
  disabled,
  selectedName,
  onSelectedNameChange,
  onClearError,
  inputRef,
}: {
  name: string;
  label: string;
  chooseLabel: string;
  acceptHint: string;
  accept: string;
  error?: string;
  disabled: boolean;
  selectedName: string | null;
  onSelectedNameChange: (name: string | null) => void;
  onClearError: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const borderTone = error ? "border-brand-orange-deep" : "border-brand-brown/30";

  return (
    <div>
      <span className="block text-sm font-bold">{label}</span>
      <div
        className={`mt-1 rounded-xl border border-dashed bg-cream-deep/60 px-3 py-3 ${borderTone}`}
      >
        <input
          ref={inputRef}
          type="file"
          name={name}
          accept={accept}
          disabled={disabled}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            onSelectedNameChange(file?.name ?? null);
            onClearError();
          }}
        />
        <p className="text-xs text-brand-charcoal/60">Accepted: {acceptHint}</p>
        <p className="mt-2 text-sm font-medium text-brand-charcoal">
          {selectedName ?? "No file selected"}
        </p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="mt-2 inline-flex h-9 items-center rounded-lg border border-brand-brown/25 bg-white px-3 text-sm font-bold text-brand-blue-deep hover:bg-cream disabled:opacity-50"
        >
          {selectedName ? "Change" : chooseLabel}
        </button>
      </div>
      {error ? (
        <p className="mt-1 text-sm font-semibold text-brand-orange-deep">{error}</p>
      ) : null}
    </div>
  );
}

export function UploadResourceModal({ weeklyPlanId, busy, onClose, onDone, setMessage }: ModalProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ResourceFieldErrors>({});
  const [previewFileName, setPreviewFileName] = useState<string | null>(null);
  const [downloadFileName, setDownloadFileName] = useState<string | null>(null);
  const previewInputRef = useRef<HTMLInputElement>(null);
  const downloadInputRef = useRef<HTMLInputElement>(null);

  const controlsDisabled = busy || submitting;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    setMessage(null);

    const form = event.currentTarget;
    const validation = validateResourceFields(form);
    if (hasResourceFieldErrors(validation)) {
      setFieldErrors(validation);
      return;
    }

    setSubmitting(true);
    try {
      const data = new FormData(form);
      data.set("weeklyPlanId", weeklyPlanId);
      const response = await fetch("/api/admin/marketing/manual/resource", {
        method: "POST",
        body: data,
      });

      const raw = await response.text();
      let payload: { error?: string } = {};
      if (raw) {
        try {
          payload = JSON.parse(raw) as { error?: string };
        } catch {
          if (!response.ok) {
            setFormError(`Upload failed (${response.status}). Please try again.`);
            return;
          }
        }
      }

      if (!response.ok) {
        setFormError(payload.error ?? "Upload failed.");
        return;
      }

      await onDone();
      onClose();
    } catch {
      setFormError("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="Upload free resource" onClose={onClose}>
      <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
        <label className="block text-sm font-bold">
          Title
          <input
            name="title"
            disabled={controlsDisabled}
            aria-invalid={Boolean(fieldErrors.title)}
            onChange={() => setFieldErrors((current) => ({ ...current, title: undefined }))}
            className={`mt-1 w-full rounded-xl border p-2 text-sm ${
              fieldErrors.title ? "border-brand-orange-deep" : "border-brand-brown/20"
            }`}
          />
          {fieldErrors.title ? (
            <p className="mt-1 text-sm font-semibold text-brand-orange-deep">{fieldErrors.title}</p>
          ) : null}
        </label>
        <label className="block text-sm font-bold">
          Description
          <textarea
            name="description"
            rows={4}
            disabled={controlsDisabled}
            aria-invalid={Boolean(fieldErrors.description)}
            onChange={() => setFieldErrors((current) => ({ ...current, description: undefined }))}
            className={`mt-1 w-full rounded-xl border p-3 text-sm ${
              fieldErrors.description ? "border-brand-orange-deep" : "border-brand-brown/20"
            }`}
          />
          {fieldErrors.description ? (
            <p className="mt-1 text-sm font-semibold text-brand-orange-deep">
              {fieldErrors.description}
            </p>
          ) : null}
        </label>
        <label className="block text-sm font-bold">
          Resource type
          <select
            name="resourceType"
            defaultValue="worksheet"
            disabled={controlsDisabled}
            className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2"
          >
            {RESOURCE_TYPES.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
        <ResourceFileUploadField
          name="preview"
          label="Preview image"
          chooseLabel="Choose preview image"
          acceptHint="PNG, JPEG, or WebP"
          accept="image/jpeg,image/png,image/webp"
          error={fieldErrors.preview}
          disabled={controlsDisabled}
          selectedName={previewFileName}
          onSelectedNameChange={setPreviewFileName}
          onClearError={() => setFieldErrors((current) => ({ ...current, preview: undefined }))}
          inputRef={previewInputRef}
        />
        <ResourceFileUploadField
          name="file"
          label="Downloadable file"
          chooseLabel="Choose downloadable file"
          acceptHint="PDF or image (PNG, JPEG, WebP)"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          error={fieldErrors.file}
          disabled={controlsDisabled}
          selectedName={downloadFileName}
          onSelectedNameChange={setDownloadFileName}
          onClearError={() => setFieldErrors((current) => ({ ...current, file: undefined }))}
          inputRef={downloadInputRef}
        />
        <label className="block text-sm font-bold">
          Related book (optional)
          <select
            name="bookId"
            defaultValue=""
            disabled={controlsDisabled}
            className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2"
          >
            <option value="">None</option>
            {BOOKS.map((book) => (
              <option key={book.id} value={book.id}>{book.title}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-bold">
          Related condition / topic (optional)
          <input
            name="relatedCondition"
            disabled={controlsDisabled}
            className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm"
          />
        </label>
        <label className="block text-sm font-bold">
          Publish date (optional)
          <input
            name="scheduledFor"
            type="datetime-local"
            disabled={controlsDisabled}
            className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm"
          />
        </label>
        <button
          type="button"
          className="text-sm font-bold text-brand-blue-deep underline-offset-4 hover:underline"
          onClick={() => setShowAdvanced((value) => !value)}
        >
          {showAdvanced ? "Hide" : "Show"} advanced SEO
        </button>
        {showAdvanced ? (
          <div className="space-y-3 rounded-2xl bg-cream-deep p-4">
            <label className="block text-sm font-bold">
              SEO title
              <input
                name="seoTitle"
                disabled={controlsDisabled}
                className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm"
              />
            </label>
            <label className="block text-sm font-bold">
              SEO description
              <textarea
                name="seoDescription"
                rows={3}
                disabled={controlsDisabled}
                className="mt-1 w-full rounded-xl border border-brand-brown/20 p-3 text-sm"
              />
            </label>
            <label className="block text-sm font-bold">
              CTA label (optional)
              <input
                name="cta"
                disabled={controlsDisabled}
                className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm"
              />
            </label>
          </div>
        ) : null}
        {formError ? (
          <p className="text-sm font-semibold text-brand-orange-deep">{formError}</p>
        ) : null}
        <div className="flex gap-2">
          <PrimaryButton type="submit" disabled={controlsDisabled}>
            {submitting ? "Uploading..." : "Upload resource"}
          </PrimaryButton>
          <SecondaryButton type="button" disabled={controlsDisabled} onClick={onClose}>
            Cancel
          </SecondaryButton>
        </div>
      </form>
    </ModalShell>
  );
}

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-navy/50 p-4">
      <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-xl font-extrabold">{title}</h3>
          <button type="button" className="text-sm font-bold" onClick={onClose}>Close</button>
        </div>
        {children}
      </Card>
    </div>
  );
}
