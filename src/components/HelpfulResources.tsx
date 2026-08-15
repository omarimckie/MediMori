import { PageSection } from "@/components/PageSection";
import Link from "next/link";

const categories = [
  {
    name: "Learn",
    description: "Opens our Resources page for trusted children's health information.",
    motif: "book" as const,
  },
  {
    name: "Explore",
    description: "Opens our Resources page for family-friendly wellness links we recommend.",
    motif: "spark" as const,
  },
  {
    name: "What's New",
    description: "Opens our Resources page — curated children's health and wellness links in one place.",
    motif: "star" as const,
  },
];

function CategoryMotif({ motif }: { motif: (typeof categories)[number]["motif"] }) {
  const className = "h-11 w-11 shrink-0";

  if (motif === "book") {
    return (
      <svg viewBox="0 0 36 36" className={className} aria-hidden="true">
        <circle cx="18" cy="18" r="16" fill="#c8b6e6" fillOpacity="0.28" />
        <path
          d="M10 11.5c3.2-1 6.2-.4 8 1.2 1.8-1.6 4.8-2.2 8-1.2v13.2c-3.1-.8-5.9-.2-8 1.3-2.1-1.5-4.9-2.1-8-1.3V11.5Z"
          fill="#fdf6e3"
        />
        <path d="M18 12.8v13.2" stroke="#1f2a44" strokeWidth="1.4" />
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
        <circle cx="18" cy="18" r="16" fill="#e8c547" fillOpacity="0.22" />
        <path
          d="M18 7.5 20.2 15 28 18l-7.8 3-2.2 7.5-2.2-7.5L8 18l7.8-3Z"
          fill="#e8c547"
        />
        <path
          d="M27 10.5v3M28.5 12h-3M9.5 24.5v2.2M10.6 25.6H8.4"
          stroke="#c8b6e6"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 36 36" className={className} aria-hidden="true">
      <circle cx="18" cy="18" r="16" fill="#c8b6e6" fillOpacity="0.22" />
      <path d="M14 11.5 15.2 15.4 19.2 16.6 15.2 17.8 14 21.7 12.8 17.8 8.8 16.6 12.8 15.4Z" fill="#e8c547" />
      <path d="M23.2 16.8 24.1 19.6 27 20.5 24.1 21.4 23.2 24.2 22.3 21.4 19.4 20.5 22.3 19.6Z" fill="#fdf6e3" />
      <circle cx="25.4" cy="12.2" r="1.1" fill="#e8c547" />
    </svg>
  );
}

export function HelpfulResources() {
  return (
    <PageSection
      tone="white"
      cloudTop="white"
      id="helpful-resources"
      className="relative -mb-px overflow-x-clip !py-9 sm:!py-20 lg:!py-28"
      containerClassName="relative mx-auto max-w-7xl"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 z-0 h-full w-screen -translate-x-1/2 select-none"
      >
        <div className="absolute left-[8%] top-10 h-72 w-72 rounded-full bg-brand-lavender/20 blur-3xl" />
        <div className="absolute right-[6%] top-1/3 h-80 w-80 rounded-full bg-brand-lavender/18 blur-3xl" />
        <div className="absolute left-1/2 top-[30%] h-[22rem] w-[min(92vw,48rem)] -translate-x-1/2 rounded-full bg-brand-lavender/16 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto max-w-2xl text-center">
        <div className="flex items-center justify-center gap-3">
          <span aria-hidden="true" className="text-2xl text-brand-yellow">
            ✦
          </span>
          <h2 className="text-3xl font-semibold tracking-tight text-brand-navy sm:text-4xl">
            Helpful Resources
          </h2>
        </div>
        <p className="mt-3 text-base leading-relaxed text-brand-charcoal/80 sm:mt-4 sm:text-lg">
          Trusted children&apos;s health and wellness resources for parents,
          caregivers, and educators — all on our Resources page.
        </p>
      </div>

      <div className="relative z-10 mt-6 grid gap-5 sm:mt-12 sm:grid-cols-3 sm:gap-10">
        {categories.map((category) => (
          <Link
            key={category.name}
            href="/resources"
            className="group flex items-start gap-3.5 text-left sm:flex-col sm:items-center sm:gap-3 sm:text-center"
          >
            <CategoryMotif motif={category.motif} />
            <div>
              <h3 className="text-xl font-semibold tracking-tight text-section-navy underline-offset-4 group-hover:underline">
                {category.name}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-brand-charcoal/75 sm:text-[0.95rem]">
                {category.description}
              </p>
            </div>
          </Link>
        ))}
      </div>

      <div className="relative z-10 mt-7 text-center sm:mt-12">
        <Link
          href="/resources"
          className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[#7050a5] px-6 py-3 font-extrabold text-white shadow-sm transition hover:brightness-95 sm:w-auto sm:min-w-[14rem] sm:px-8"
        >
          Explore Resources
        </Link>
      </div>
    </PageSection>
  );
}
