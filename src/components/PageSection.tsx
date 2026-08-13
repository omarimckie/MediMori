import type { ReactNode } from "react";

export type SectionTone = "navy" | "white" | "cream";

const toneStyles: Record<SectionTone, string> = {
  navy: "bg-section-navy text-white",
  white: "bg-cream text-brand-charcoal",
  cream: "bg-cream-deep text-brand-charcoal",
};

const cloudFillStyles: Record<SectionTone, string> = {
  navy: "fill-section-navy",
  white: "fill-cream",
  cream: "fill-cream-deep",
};

type Props = {
  tone: SectionTone;
  children: ReactNode;
  className?: string;
  id?: string;
  containerClassName?: string;
  /**
   * Tone of the section directly above. When set, renders a puffy
   * cloud-shaped border along the top edge of this section.
   */
  cloudTop?: SectionTone;
};

function CloudEdge({ tone }: { tone: SectionTone }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1200 80"
      preserveAspectRatio="none"
      className={`pointer-events-none absolute inset-x-0 top-0 z-0 h-10 w-full sm:h-16 ${cloudFillStyles[tone]}`}
    >
      {/* Faint wide puffs — the soft outer haze of the clouds */}
      <path
        opacity="0.3"
        d="M0 0 H1200 V34 a100 40 0 0 1 -200 4 a100 44 0 0 1 -200 -6 a100 32 0 0 1 -200 2 a100 44 0 0 1 -200 -2 a100 36 0 0 1 -200 4 a100 42 0 0 1 -200 -6 Z"
      />
      {/* Mid puffs at a different rhythm for depth */}
      <path
        opacity="0.55"
        d="M0 0 H1200 V26 a75 34 0 0 1 -150 4 a75 26 0 0 1 -150 -4 a75 38 0 0 1 -150 2 a75 28 0 0 1 -150 -2 a75 34 0 0 1 -150 4 a75 24 0 0 1 -150 -4 a75 36 0 0 1 -150 2 a75 28 0 0 1 -150 -2 Z"
      />
      {/* Solid crisp cloud line on top */}
      <path d="M0 0 H1200 V18 a60 26 0 0 1 -120 2 a60 18 0 0 1 -120 -2 a60 30 0 0 1 -120 2 a60 20 0 0 1 -120 -2 a60 26 0 0 1 -120 2 a60 16 0 0 1 -120 -2 a60 28 0 0 1 -120 2 a60 20 0 0 1 -120 -2 a60 30 0 0 1 -120 2 a60 20 0 0 1 -120 -2 Z" />
    </svg>
  );
}

export function PageSection({
  tone,
  children,
  className = "",
  id,
  containerClassName = "tf-page-width",
  cloudTop,
}: Props) {
  return (
    <section
      id={id}
      className={`relative px-5 py-20 sm:px-8 sm:py-28 lg:px-10 lg:py-32 ${toneStyles[tone]} ${className}`}
    >
      {cloudTop ? <CloudEdge tone={cloudTop} /> : null}
      <div className={`relative ${containerClassName}`}>{children}</div>
    </section>
  );
}
