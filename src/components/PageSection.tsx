import type { ReactNode } from "react";

export type SectionTone = "navy" | "white" | "cream";

const toneStyles: Record<SectionTone, string> = {
  navy: "bg-section-navy text-white",
  white: "bg-cream text-brand-charcoal",
  cream: "bg-cream-deep text-brand-charcoal",
};

type Props = {
  tone: SectionTone;
  children: ReactNode;
  className?: string;
  id?: string;
  containerClassName?: string;
};

export function PageSection({
  tone,
  children,
  className = "",
  id,
  containerClassName = "mx-auto max-w-5xl",
}: Props) {
  return (
    <section
      id={id}
      className={`px-4 py-16 sm:px-6 sm:py-20 ${toneStyles[tone]} ${className}`}
    >
      <div className={containerClassName}>{children}</div>
    </section>
  );
}
