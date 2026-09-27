"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { isEditableManualUploadAsset } from "@/lib/marketing/content-metadata-client";
import type { MarketingAsset } from "@/lib/marketing/types";
import { UploadPostModal, UploadResourceModal } from "./ManualUploadModals";
import { Card, PrimaryButton, SecondaryButton, StatusPill } from "./ui";

export function AssetsClient() {
  const [assets, setAssets] = useState<MarketingAsset[]>([]);
  const [weeklyPlanId, setWeeklyPlanId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showUploadPost, setShowUploadPost] = useState(false);
  const [showUploadResource, setShowUploadResource] = useState(false);
  const [editAsset, setEditAsset] = useState<MarketingAsset | null>(null);
  const [replaceAsset, setReplaceAsset] = useState<MarketingAsset | null>(null);

  const loadAssets = useCallback(async () => {
    const data = await fetch("/api/admin/marketing/assets").then((res) => res.json());
    setAssets(data.assets ?? []);
  }, []);

  const load = useCallback(async () => {
    const settings = await fetch("/api/admin/marketing/settings").then((res) => res.json());
    setWeeklyPlanId(settings.plans?.[0]?.id ?? null);
    await loadAssets();
  }, [loadAssets]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const uploadDisabled = !weeklyPlanId || busy;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SecondaryButton disabled={uploadDisabled} onClick={() => setShowUploadPost(true)}>
          Upload post
        </SecondaryButton>
        <SecondaryButton disabled={uploadDisabled} onClick={() => setShowUploadResource(true)}>
          Upload free resource
        </SecondaryButton>
        {!weeklyPlanId ? (
          <p className="text-xs text-brand-charcoal/60">
            Generate a weekly plan to attach uploads to the current campaign week.
          </p>
        ) : null}
      </div>
      {message ? <p className="text-sm font-semibold text-brand-orange-deep">{message}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {assets.map((asset) => {
          const editable = isEditableManualUploadAsset(asset);
          const showImage = asset.url && asset.type !== "resource_file";
          return (
            <Card key={asset.id}>
              {showImage ? (
                <div className="relative mb-3 aspect-square overflow-hidden rounded-2xl bg-cream-deep">
                  <Image src={asset.url!} alt={asset.altText ?? asset.name} fill className="object-contain" />
                </div>
              ) : asset.type === "resource_file" ? (
                <p className="mb-3 rounded-2xl bg-cream-deep p-4 text-xs text-brand-charcoal/70">
                  Private downloadable file (no public preview URL)
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <StatusPill status={asset.approved ? "approved" : "needs_review"} />
                <StatusPill status={asset.type} />
                <StatusPill status={asset.source} />
              </div>
              <h3 className="mt-2 font-extrabold">{asset.name}</h3>
              <p className="mt-1 text-xs text-brand-charcoal/60">
                {asset.bookId ?? "no book"} {asset.characterId ? `· ${asset.characterId}` : ""}
              </p>
              {asset.usageRestrictions ? (
                <p className="mt-2 text-xs">{asset.usageRestrictions}</p>
              ) : null}
              {editable ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <SecondaryButton disabled={busy} onClick={() => setEditAsset(asset)}>
                    Edit details
                  </SecondaryButton>
                  {asset.type !== "resource_file" ? (
                    <SecondaryButton disabled={busy} onClick={() => setReplaceAsset(asset)}>
                      Replace image
                    </SecondaryButton>
                  ) : (
                    <SecondaryButton disabled={busy} onClick={() => setReplaceAsset(asset)}>
                      Replace file
                    </SecondaryButton>
                  )}
                </div>
              ) : null}
            </Card>
          );
        })}
        {!assets.length ? (
          <p>No assets yet. Generate a week or load demo seed to import catalog covers and character art.</p>
        ) : null}
      </div>

      {showUploadPost && weeklyPlanId ? (
        <UploadPostModal
          weeklyPlanId={weeklyPlanId}
          busy={busy}
          onClose={() => setShowUploadPost(false)}
          onDone={load}
          setMessage={setMessage}
        />
      ) : null}
      {showUploadResource && weeklyPlanId ? (
        <UploadResourceModal
          weeklyPlanId={weeklyPlanId}
          busy={busy}
          onClose={() => setShowUploadResource(false)}
          onDone={load}
          setMessage={setMessage}
        />
      ) : null}
      {editAsset ? (
        <EditAssetModal
          asset={editAsset}
          busy={busy}
          onClose={() => setEditAsset(null)}
          onSaved={async () => {
            setEditAsset(null);
            await loadAssets();
          }}
          setBusy={setBusy}
          setMessage={setMessage}
        />
      ) : null}
      {replaceAsset ? (
        <ReplaceAssetModal
          asset={replaceAsset}
          busy={busy}
          onClose={() => setReplaceAsset(null)}
          onSaved={async () => {
            setReplaceAsset(null);
            await loadAssets();
          }}
          setBusy={setBusy}
          setMessage={setMessage}
        />
      ) : null}
    </div>
  );
}

function EditAssetModal({
  asset,
  busy,
  onClose,
  onSaved,
  setBusy,
  setMessage,
}: {
  asset: MarketingAsset;
  busy: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  setBusy: (value: boolean) => void;
  setMessage: (message: string | null) => void;
}) {
  const [name, setName] = useState(asset.name);
  const [altText, setAltText] = useState(asset.altText ?? "");
  const [usageRestrictions, setUsageRestrictions] = useState(asset.usageRestrictions ?? "");
  const [tags, setTags] = useState(asset.tags.join(", "));
  const [approved, setApproved] = useState(asset.approved);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/marketing/assets/${asset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          altText: altText.trim() || null,
          usageRestrictions: usageRestrictions.trim() || null,
          tags: tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          approved,
        }),
      });
      const json = await response.json();
      if (!response.ok) {
        setMessage(json.error ?? "Update failed.");
        return;
      }
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Edit asset details" onClose={onClose}>
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <label className="block text-sm font-bold">
          Name
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm"
          />
        </label>
        <label className="block text-sm font-bold">
          Alt text
          <input
            value={altText}
            onChange={(event) => setAltText(event.target.value)}
            className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm"
          />
        </label>
        <label className="block text-sm font-bold">
          Usage restrictions
          <textarea
            rows={3}
            value={usageRestrictions}
            onChange={(event) => setUsageRestrictions(event.target.value)}
            className="mt-1 w-full rounded-xl border border-brand-brown/20 p-3 text-sm"
          />
        </label>
        <label className="block text-sm font-bold">
          Tags (comma-separated)
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-sm font-bold">
          <input
            type="checkbox"
            checked={approved}
            onChange={(event) => setApproved(event.target.checked)}
          />
          Approved for publishing
        </label>
        <div className="flex gap-2">
          <PrimaryButton type="submit" disabled={busy}>Save</PrimaryButton>
          <SecondaryButton type="button" disabled={busy} onClick={onClose}>Cancel</SecondaryButton>
        </div>
      </form>
    </ModalShell>
  );
}

function ReplaceAssetModal({
  asset,
  busy,
  onClose,
  onSaved,
  setBusy,
  setMessage,
}: {
  asset: MarketingAsset;
  busy: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  setBusy: (value: boolean) => void;
  setMessage: (message: string | null) => void;
}) {
  const isFile = asset.type === "resource_file";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch(`/api/admin/marketing/assets/${asset.id}`, {
        method: "POST",
        body: form,
      });
      const json = await response.json();
      if (!response.ok) {
        setMessage(json.error ?? "Replacement failed.");
        return;
      }
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title={isFile ? "Replace file" : "Replace image"} onClose={onClose}>
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <label className="block text-sm font-bold">
          {isFile ? "New downloadable file (PDF or image)" : "New image"}
          <input
            name="file"
            type="file"
            required
            accept={
              isFile
                ? "application/pdf,image/jpeg,image/png,image/webp"
                : "image/jpeg,image/png,image/webp"
            }
            className="mt-1 block w-full text-sm"
          />
        </label>
        <label className="block text-sm font-bold">
          Name (optional)
          <input name="name" className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm" />
        </label>
        <label className="block text-sm font-bold">
          Alt text (optional)
          <input name="altText" className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm" />
        </label>
        <p className="text-xs text-brand-charcoal/60">
          The asset ID stays the same. Content that references this asset will use the new file on
          future publishes; already-published social posts are not updated automatically.
        </p>
        <div className="flex gap-2">
          <PrimaryButton type="submit" disabled={busy}>Replace</PrimaryButton>
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
