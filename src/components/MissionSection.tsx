import { PageSection } from "@/components/PageSection";
import {
  missionHeadline,
  missionHeading,
  missionIntroduction,
  missionPrinciples,
  missionVisualSrc,
  type MissionPrinciple,
} from "@/data/mission";
import Image from "next/image";

function PrincipleMotif({ motif }: { motif: MissionPrinciple["motif"] }) {
  const className = "h-9 w-9 shrink-0";

  if (motif === "heart") {
    return (
      <svg viewBox="0 0 36 36" className={className} aria-hidden="true">
        <circle cx="18" cy="18" r="16" fill="#7050a5" fillOpacity="0.14" />
        <path
          d="M18 26s-7.2-4.4-9.4-8.2C6.8 14.8 8 11.5 11.2 11c1.8-.3 3.4.6 4.3 2 0.9-1.4 2.5-2.3 4.3-2 3.2.5 4.4 3.8 2.6 6.8C25.2 21.6 18 26 18 26Z"
          fill="#7050a5"
        />
      </svg>
    );
  }

  if (motif === "book") {
    return (
      <svg viewBox="0 0 36 36" className={className} aria-hidden="true">
        <circle cx="18" cy="18" r="16" fill="#e8c547" fillOpacity="0.22" />
        <path
          d="M10 11.5c3.2-1 6.2-.4 8 1.2 1.8-1.6 4.8-2.2 8-1.2v13.2c-3.1-.8-5.9-.2-8 1.3-2.1-1.5-4.9-2.1-8-1.3V11.5Z"
          fill="#1f2a44"
        />
        <path d="M18 12.8v13.2" stroke="#fdf6e3" strokeWidth="1.4" />
        <path
          d="M11.2 14.2c2.2-.5 4.4 0 5.8 1.2M24.8 14.2c-2.2-.5-4.4 0-5.8 1.2"
          stroke="#e8c547"
          strokeWidth="1.2"
          fill="none"
        />
      </svg>
    );
  }

  if (motif === "spark") {
    return (
      <svg viewBox="0 0 36 36" className={className} aria-hidden="true">
        <circle cx="18" cy="18" r="16" fill="#e8c547" fillOpacity="0.2" />
        <path
          d="M18 7.5 20.2 15 28 18l-7.8 3-2.2 7.5-2.2-7.5L8 18l7.8-3Z"
          fill="#e8c547"
        />
        <path d="M27 10.5v3M28.5 12h-3M9.5 24.5v2.2M10.6 25.6H8.4" stroke="#7050a5" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }

  if (motif === "shield") {
    return (
      <svg viewBox="0 0 36 36" className={className} aria-hidden="true">
        <circle cx="18" cy="18" r="16" fill="#a8cbe6" fillOpacity="0.35" />
        <path
          d="M18 8.5c3.4 2 6.8 2.2 8.5 2.2v8.2c0 4.4-3.4 7.4-8.5 9.1-5.1-1.7-8.5-4.7-8.5-9.1V10.7c1.7 0 5.1-.2 8.5-2.2Z"
          fill="#6f9fc4"
        />
        <path
          d="M18 12.2v12.4"
          stroke="#fdf6e3"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <path
          d="M13.2 17.4h9.6"
          stroke="#fdf6e3"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 36 36" className={className} aria-hidden="true">
      <circle cx="18" cy="18" r="16" fill="#a8cbe6" fillOpacity="0.28" />
      <circle cx="18" cy="18" r="8.2" fill="#7ec3e8" stroke="#2f6690" strokeWidth="1.2" />
      <path
        d="M18 9.8c2.4 2.2 3.6 5 3.6 8.2s-1.2 6-3.6 8.2c-2.4-2.2-3.6-5-3.6-8.2s1.2-6 3.6-8.2Z"
        fill="none"
        stroke="#2f6690"
        strokeWidth="1"
      />
      <path
        d="M10.4 15.6h15.2M10.4 20.4h15.2"
        stroke="#2f6690"
        strokeWidth="0.9"
        opacity="0.7"
      />
    </svg>
  );
}

export function MissionSection() {
  return (
    <PageSection
      tone="white"
      id="mission"
      className="relative overflow-visible bg-transparent lg:!-mt-12 lg:!pb-16 lg:!pt-14"
      containerClassName="relative mx-auto max-w-7xl"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden select-none"
      >
        <div className="absolute -left-16 top-10 h-64 w-64 rounded-full bg-brand-lavender/25 blur-3xl" />
        <div className="absolute right-0 top-1/3 h-72 w-72 rounded-full bg-brand-lavender/20 blur-3xl" />
        <span className="absolute left-[18%] top-8 text-xl text-brand-gold/55">
          ✦
        </span>
        <span className="absolute right-[22%] top-16 hidden text-lg text-brand-gold/40 sm:block">
          ★
        </span>
      </div>

      <div className="relative grid items-start gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:gap-14 xl:gap-16">
        <div>
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="text-2xl text-brand-gold">
              ✦
            </span>
            <h2 className="text-3xl font-semibold tracking-tight text-brand-navy sm:text-4xl">
              {missionHeading}
            </h2>
          </div>

          <p className="tf-display mt-5 max-w-2xl text-3xl font-semibold leading-snug text-brand-navy sm:text-4xl">
            {missionHeadline}
          </p>

          <p className="mt-5 max-w-2xl text-[1.24rem] leading-relaxed text-brand-charcoal/85 sm:text-[1.38rem]">
            {missionIntroduction}
          </p>

          <ul className="mt-8 grid gap-6 sm:grid-cols-2 sm:gap-x-8 sm:gap-y-7">
            {missionPrinciples.map((principle) => (
              <li
                key={principle.name}
                className="flex gap-3 text-left last:sm:col-span-2 last:sm:mx-auto last:sm:max-w-md"
              >
                <PrincipleMotif motif={principle.motif} />
                <div>
                  <h3 className="text-[1.24rem] font-semibold tracking-wide text-brand-navy sm:text-[1.38rem]">
                    {principle.name}
                  </h3>
                  <p className="mt-1 text-[1.03rem] leading-relaxed text-brand-charcoal/80 sm:text-[1.10rem]">
                    {principle.explanation}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mx-auto flex w-full max-w-sm items-center justify-center lg:max-w-none lg:pt-6">
          <div
            aria-hidden="true"
            className="absolute inset-8 rounded-full bg-brand-lavender/30 blur-2xl"
          />
          <Image
            src={missionVisualSrc}
            alt="Watercolor Twilight Feather quill with gold sparkles"
            width={483}
            height={760}
            unoptimized
            sizes="(min-width: 1024px) 28vw, 70vw"
            className="relative h-auto w-[68%] max-w-[260px] rotate-[12deg] lg:w-[82%] lg:max-w-[320px]"
          />
        </div>
      </div>
    </PageSection>
  );
}
