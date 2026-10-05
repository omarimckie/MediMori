"use client";

import { useId, useState } from "react";
import type { AudienceId, ContentCategory } from "@/lib/marketing/types";
import { CAPTION_CLIENT_INSTRUCTIONS_MAX_LENGTH } from "@/lib/marketing/smart-upload-caption-client";
import {
  CAPTION_ASSISTANT_AUDIENCES,
  CAPTION_ASSISTANT_CONTENT_CATEGORIES,
  composeFacebookCaptionPreview,
  composeInstagramCaptionPreview,
  composeSharedCaptionPreview,
  formatHashtagInput,
  parseHashtagInput,
  setCaptionAssistantMode,
  type CaptionAssistantMode,
  type CaptionAssistantState,
} from "@/lib/marketing/smart-upload-caption-client-state";

type SmartUploadCaptionAssistantProps = {
  state: CaptionAssistantState;
  disabled?: boolean;
  generating?: boolean;
  generationReady: boolean;
  generationReadyReason?: string;
  onChange: (next: CaptionAssistantState) => void;
  onGenerate: () => void;
  onKeepStaleCaption: () => void;
};

export function SmartUploadCaptionAssistant({
  state,
  disabled = false,
  generating = false,
  generationReady,
  generationReadyReason,
  onChange,
  onGenerate,
  onKeepStaleCaption,
}: SmartUploadCaptionAssistantProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [perPlatformTab, setPerPlatformTab] = useState<"facebook" | "instagram">("facebook");
  const bodyId = useId();
  const ctaId = useId();
  const hashtagsId = useId();
  const fbBodyId = useId();
  const fbCtaId = useId();
  const igBodyId = useId();
  const igCtaId = useId();
  const igHashtagsId = useId();
  const instructionsId = useId();

  const sharedPreview = composeSharedCaptionPreview(state.shared);
  const facebookPreview = composeFacebookCaptionPreview(state.facebook);
  const instagramPreview = composeInstagramCaptionPreview(state.instagram);

  const fieldsDisabled = disabled || generating;
  const generateDisabled = fieldsDisabled || !generationReady || generating;
  const hasGeneratedDraft = state.genStatus === "generated" || Boolean(state.generatedFrom);
  const generateLabel = generating
    ? "Generating…"
    : hasGeneratedDraft
      ? "Regenerate Caption"
      : "Generate Caption";

  function patchShared(partial: Partial<CaptionAssistantState["shared"]>) {
    onChange({
      ...state,
      shared: { ...state.shared, ...partial },
    });
  }

  function patchMode(mode: CaptionAssistantMode) {
    onChange(setCaptionAssistantMode(state, mode));
  }

  function patchFacebook(partial: Partial<CaptionAssistantState["facebook"]>) {
    onChange({
      ...state,
      facebook: { ...state.facebook, ...partial },
    });
  }

  function patchInstagram(partial: Partial<CaptionAssistantState["instagram"]>) {
    onChange({
      ...state,
      instagram: { ...state.instagram, ...partial },
    });
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-brand-brown/15 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-brand-navy">Caption Assistant</p>
        <fieldset className="flex flex-wrap gap-2 text-xs" disabled={fieldsDisabled}>
          <legend className="sr-only">Caption mode</legend>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-brand-brown/20 px-2 py-1 font-bold text-brand-navy has-[:checked]:border-brand-navy has-[:checked]:bg-cream-deep/50">
            <input
              type="radio"
              name={`caption-mode-${bodyId}`}
              checked={state.mode === "shared"}
              onChange={() => patchMode("shared")}
            />
            Shared
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-brand-brown/20 px-2 py-1 font-bold text-brand-navy has-[:checked]:border-brand-navy has-[:checked]:bg-cream-deep/50">
            <input
              type="radio"
              name={`caption-mode-${bodyId}`}
              checked={state.mode === "per_platform"}
              onChange={() => patchMode("per_platform")}
            />
            Per platform
          </label>
        </fieldset>
      </div>

      {state.mode === "shared" ? (
        <>
          <label className="block text-sm font-bold" htmlFor={bodyId}>
            Caption
            <textarea
              id={bodyId}
              rows={4}
              disabled={fieldsDisabled}
              value={state.shared.body}
              onChange={(e) => patchShared({ body: e.target.value })}
              className="mt-1 w-full rounded-xl border border-brand-brown/20 p-3 text-sm"
              placeholder="Write the post caption…"
            />
          </label>

          <label className="block text-sm font-bold" htmlFor={ctaId}>
            CTA (optional)
            <textarea
              id={ctaId}
              rows={2}
              disabled={fieldsDisabled}
              value={state.shared.cta}
              onChange={(e) => patchShared({ cta: e.target.value })}
              className="mt-1 w-full rounded-xl border border-brand-brown/20 p-3 text-sm"
              placeholder="Call to action, separate from the main caption"
            />
          </label>

          <label className="block text-sm font-bold" htmlFor={hashtagsId}>
            Instagram hashtags
            <input
              id={hashtagsId}
              type="text"
              disabled={fieldsDisabled}
              value={formatHashtagInput(state.shared.instagramHashtags)}
              onChange={(e) =>
                patchShared({ instagramHashtags: parseHashtagInput(e.target.value) })
              }
              className="mt-1 w-full rounded-xl border border-brand-brown/20 p-3 text-sm"
              placeholder="KidsHealth SickleCell (spaces or commas)"
            />
          </label>

          <div className="rounded-xl border border-brand-brown/10 bg-cream-deep/40 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-brand-charcoal/60">
              Composed preview (Facebook &amp; Instagram)
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-brand-charcoal">
              {sharedPreview.trim()
                ? sharedPreview
                : "Caption, CTA, and hashtags will appear here as you type."}
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="flex gap-2 border-b border-brand-brown/10 pb-2">
            <button
              type="button"
              disabled={fieldsDisabled}
              onClick={() => setPerPlatformTab("facebook")}
              className={`rounded-lg px-3 py-1.5 text-sm font-bold ${
                perPlatformTab === "facebook"
                  ? "bg-brand-navy text-white"
                  : "border border-brand-brown/20 text-brand-navy"
              }`}
            >
              Facebook
            </button>
            <button
              type="button"
              disabled={fieldsDisabled}
              onClick={() => setPerPlatformTab("instagram")}
              className={`rounded-lg px-3 py-1.5 text-sm font-bold ${
                perPlatformTab === "instagram"
                  ? "bg-brand-navy text-white"
                  : "border border-brand-brown/20 text-brand-navy"
              }`}
            >
              Instagram
            </button>
          </div>

          {perPlatformTab === "facebook" ? (
            <div className="space-y-3">
              <label className="block text-sm font-bold" htmlFor={fbBodyId}>
                Facebook caption
                <textarea
                  id={fbBodyId}
                  rows={4}
                  disabled={fieldsDisabled}
                  value={state.facebook.body}
                  onChange={(e) => patchFacebook({ body: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-brand-brown/20 p-3 text-sm"
                  placeholder="Facebook-specific caption…"
                />
              </label>
              <label className="block text-sm font-bold" htmlFor={fbCtaId}>
                Facebook CTA (optional)
                <textarea
                  id={fbCtaId}
                  rows={2}
                  disabled={fieldsDisabled}
                  value={state.facebook.cta}
                  onChange={(e) => patchFacebook({ cta: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-brand-brown/20 p-3 text-sm"
                />
              </label>
              <div className="rounded-xl border border-brand-brown/10 bg-cream-deep/40 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-brand-charcoal/60">
                  Facebook preview
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-brand-charcoal">
                  {facebookPreview.trim() ? facebookPreview : "Facebook caption and CTA only — no hashtags."}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block text-sm font-bold" htmlFor={igBodyId}>
                Instagram caption
                <textarea
                  id={igBodyId}
                  rows={4}
                  disabled={fieldsDisabled}
                  value={state.instagram.body}
                  onChange={(e) => patchInstagram({ body: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-brand-brown/20 p-3 text-sm"
                  placeholder="Instagram-specific caption…"
                />
              </label>
              <label className="block text-sm font-bold" htmlFor={igCtaId}>
                Instagram CTA (optional)
                <textarea
                  id={igCtaId}
                  rows={2}
                  disabled={fieldsDisabled}
                  value={state.instagram.cta}
                  onChange={(e) => patchInstagram({ cta: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-brand-brown/20 p-3 text-sm"
                />
              </label>
              <label className="block text-sm font-bold" htmlFor={igHashtagsId}>
                Instagram hashtags
                <input
                  id={igHashtagsId}
                  type="text"
                  disabled={fieldsDisabled}
                  value={formatHashtagInput(state.instagram.instagramHashtags)}
                  onChange={(e) =>
                    patchInstagram({ instagramHashtags: parseHashtagInput(e.target.value) })
                  }
                  className="mt-1 w-full rounded-xl border border-brand-brown/20 p-3 text-sm"
                  placeholder="TwilightFeather KidsBooks"
                />
              </label>
              <div className="rounded-xl border border-brand-brown/10 bg-cream-deep/40 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-brand-charcoal/60">
                  Instagram preview
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-brand-charcoal">
                  {instagramPreview.trim()
                    ? instagramPreview
                    : "Instagram caption, CTA, and hashtags."}
                </p>
              </div>
            </div>
          )}
        </>
      )}

      <label className="block text-sm font-bold" htmlFor={instructionsId}>
        Instructions (optional)
        <textarea
          id={instructionsId}
          rows={2}
          maxLength={CAPTION_CLIENT_INSTRUCTIONS_MAX_LENGTH}
          disabled={fieldsDisabled}
          value={state.instructions}
          onChange={(e) => onChange({ ...state, instructions: e.target.value })}
          className="mt-1 w-full rounded-xl border border-brand-brown/20 p-3 text-sm"
          placeholder="Optional guidance for caption generation — not necessarily literal copy"
        />
      </label>

      <div className="rounded-xl border border-brand-brown/15 bg-cream-deep/30 p-3">
        <p className="text-xs font-bold text-brand-charcoal/70">AI generation</p>
        {!generationReady && generationReadyReason ? (
          <p className="mt-1 text-xs text-brand-charcoal/55">{generationReadyReason}</p>
        ) : null}
        {state.genError ? (
          <p className="mt-2 text-xs font-semibold text-brand-orange-deep" role="alert">
            {state.genError}
          </p>
        ) : null}
        {state.provenance ? (
          <p className="mt-2 text-xs text-brand-charcoal/55">
            {state.provenance.mock
              ? "Test generation (mock)"
              : `Generated with ${state.provenance.provider}`}
            {state.provenance.model ? (
              <span className="text-brand-charcoal/45"> · {state.provenance.model}</span>
            ) : null}
          </p>
        ) : null}
        <button
          type="button"
          disabled={generateDisabled}
          onClick={onGenerate}
          className="mt-2 inline-flex h-9 items-center rounded-xl border border-brand-brown/20 bg-white px-3 text-sm font-bold text-brand-navy disabled:cursor-not-allowed disabled:text-brand-charcoal/40"
        >
          {generateLabel}
        </button>
      </div>

      {state.warnings.length > 0 ? (
        <ul className="list-disc pl-5 text-xs text-brand-orange-deep" role="status">
          {state.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      {state.stale && !state.staleAcknowledged ? (
        <div
          className="rounded-xl border border-brand-orange/30 bg-brand-orange/10 p-3 text-xs text-brand-orange-deep"
          role="status"
        >
          <p className="font-semibold">Caption inputs changed since generation.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={generateDisabled}
              onClick={onGenerate}
              className="inline-flex h-8 items-center rounded-lg border border-brand-orange/40 bg-white px-2.5 font-bold disabled:opacity-50"
            >
              Regenerate
            </button>
            <button
              type="button"
              disabled={fieldsDisabled}
              onClick={onKeepStaleCaption}
              className="inline-flex h-8 items-center rounded-lg border border-brand-brown/20 bg-white px-2.5 font-bold text-brand-navy disabled:opacity-50"
            >
              Keep Caption Anyway
            </button>
          </div>
        </div>
      ) : null}

      {state.stale && state.staleAcknowledged ? (
        <p className="text-xs text-brand-charcoal/55" role="status">
          Keeping current caption despite changed generation inputs.
        </p>
      ) : null}

      <div className="rounded-xl border border-brand-brown/10">
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-bold text-brand-navy"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          Advanced
          <span className="text-xs font-normal text-brand-charcoal/60">{advancedOpen ? "−" : "+"}</span>
        </button>
        {advancedOpen ? (
          <div className="space-y-3 border-t border-brand-brown/10 px-3 py-3">
            <label className="block text-sm font-bold">
              Audience
              <select
                disabled={fieldsDisabled}
                value={state.advanced.audience ?? ""}
                onChange={(e) => {
                  const value = e.target.value;
                  onChange({
                    ...state,
                    advanced: {
                      ...state.advanced,
                      audience: value ? (value as AudienceId) : null,
                    },
                  });
                }}
                className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm"
              >
                <option value="">Automatic</option>
                {CAPTION_ASSISTANT_AUDIENCES.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-bold">
              Category
              <select
                disabled={fieldsDisabled}
                value={state.advanced.category ?? ""}
                onChange={(e) => {
                  const value = e.target.value;
                  onChange({
                    ...state,
                    advanced: {
                      ...state.advanced,
                      category: value ? (value as ContentCategory) : null,
                    },
                  });
                }}
                className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm"
              >
                <option value="">Automatic</option>
                {CAPTION_ASSISTANT_CONTENT_CATEGORIES.map((id) => (
                  <option key={id} value={id}>
                    {id.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
      </div>
    </div>
  );
}
