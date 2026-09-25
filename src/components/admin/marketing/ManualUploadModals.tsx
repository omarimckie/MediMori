"use client";

import { useState } from "react";
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

export function UploadResourceModal({ weeklyPlanId, busy, onClose, onDone, setMessage }: ModalProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set("weeklyPlanId", weeklyPlanId);
    const response = await fetch("/api/admin/marketing/manual/resource", {
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
    <ModalShell title="Upload free resource" onClose={onClose}>
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <label className="block text-sm font-bold">
          Title
          <input name="title" required className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm" />
        </label>
        <label className="block text-sm font-bold">
          Description
          <textarea name="description" required rows={4} className="mt-1 w-full rounded-xl border border-brand-brown/20 p-3 text-sm" />
        </label>
        <label className="block text-sm font-bold">
          Resource type
          <select name="resourceType" defaultValue="worksheet" className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2">
            {RESOURCE_TYPES.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-bold">
          Preview image
          <input name="preview" type="file" accept="image/jpeg,image/png,image/webp" required className="mt-1 block w-full text-sm" />
        </label>
        <label className="block text-sm font-bold">
          Downloadable file (PDF or image)
          <input name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required className="mt-1 block w-full text-sm" />
        </label>
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
          Related condition / topic (optional)
          <input name="relatedCondition" className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm" />
        </label>
        <label className="block text-sm font-bold">
          Publish date (optional)
          <input name="scheduledFor" type="datetime-local" className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm" />
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
              <input name="seoTitle" className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm" />
            </label>
            <label className="block text-sm font-bold">
              SEO description
              <textarea name="seoDescription" rows={3} className="mt-1 w-full rounded-xl border border-brand-brown/20 p-3 text-sm" />
            </label>
            <label className="block text-sm font-bold">
              CTA label (optional)
              <input name="cta" className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm" />
            </label>
          </div>
        ) : null}
        <div className="flex gap-2">
          <PrimaryButton type="submit" disabled={busy}>Upload resource</PrimaryButton>
          <SecondaryButton type="button" disabled={busy} onClick={onClose}>Cancel</SecondaryButton>
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
