"use client";

import { useId, useState } from "react";
import type { AudienceId, ContentCategory } from "@/lib/marketing/types";
import {
  CAPTION_ASSISTANT_AUDIENCES,
  CAPTION_ASSISTANT_CONTENT_CATEGORIES,
  composeSharedCaptionPreview,
  formatHashtagInput,
  parseHashtagInput,
  type CaptionAssistantState,
} from "@/lib/marketing/smart-upload-caption-client-state";

type SmartUploadCaptionAssistantProps = {
  state: CaptionAssistantState;
  disabled?: boolean;
  onChange: (next: CaptionAssistantState) => void;
};

export function SmartUploadCaptionAssistant({
  state,
  disabled = false,
  onChange,
}: SmartUploadCaptionAssistantProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const bodyId = useId();
  const ctaId = useId();
  const hashtagsId = useId();
  const instructionsId = useId();
  const preview = composeSharedCaptionPreview(state.shared);

  function patchShared(partial: Partial<CaptionAssistantState["shared"]>) {
    onChange({
      ...state,
      shared: { ...state.shared, ...partial },
    });
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-brand-brown/15 bg-white p-3">
      <p className="text-sm font-bold text-brand-navy">Caption Assistant</p>

      <label className="block text-sm font-bold" htmlFor={bodyId}>
        Caption
        <textarea
          id={bodyId}
          rows={4}
          disabled={disabled}
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
          disabled={disabled}
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
          disabled={disabled}
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
          Composed preview
        </p>
        <p className="mt-2 whitespace-pre-wrap text-sm text-brand-charcoal">
          {preview.trim() ? preview : "Caption, CTA, and hashtags will appear here as you type."}
        </p>
        <p className="mt-2 text-xs text-brand-charcoal/55">
          This preview is what Submit valid will send for this image until per-platform finalize
          ships in a later phase.
        </p>
      </div>

      <div className="rounded-xl border border-dashed border-brand-brown/20 bg-cream-deep/30 p-3">
        <p className="text-xs font-bold text-brand-charcoal/70">AI generation</p>
        <p className="mt-1 text-xs text-brand-charcoal/55">
          Generate Caption will be available in the next release. You can write captions manually
          now.
        </p>
        <button
          type="button"
          disabled
          className="mt-2 inline-flex h-9 cursor-not-allowed items-center rounded-xl border border-brand-brown/20 bg-white px-3 text-sm font-bold text-brand-charcoal/40"
          aria-disabled="true"
        >
          Generate Caption (coming soon)
        </button>
      </div>

      <label className="block text-sm font-bold" htmlFor={instructionsId}>
        Instructions (optional)
        <textarea
          id={instructionsId}
          rows={2}
          disabled={disabled}
          value={state.instructions}
          onChange={(e) => onChange({ ...state, instructions: e.target.value })}
          className="mt-1 w-full rounded-xl border border-brand-brown/20 p-3 text-sm"
          placeholder="Optional guidance for caption generation — not necessarily literal copy"
        />
      </label>

      {state.warnings.length > 0 ? (
        <ul className="list-disc pl-5 text-xs text-brand-orange-deep" role="status">
          {state.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      {state.stale && !state.staleAcknowledged ? (
        <p className="text-xs font-semibold text-brand-orange-deep" role="status">
          Caption inputs changed since last generation. Regenerate or keep your current draft when
          generation is available.
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
                disabled={disabled}
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
                disabled={disabled}
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
