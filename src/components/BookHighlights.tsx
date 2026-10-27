const highlights = [
  {
    title: "Written with care",
    description:
      "Created by healthcare professionals and parents who care deeply.",
    motif: "heart" as const,
  },
  {
    title: "Kid-friendly",
    description: "Easy to understand, engaging stories kids will love.",
    motif: "spark" as const,
  },
  {
    title: "Support for families",
    description: "Resources and tips to guide you every step of the way.",
    motif: "home" as const,
  },
  {
    title: "Diverse & inclusive",
    description:
      "Stories that reflect the beautiful world our children live in.",
    motif: "globe" as const,
  },
];

function ValueMotif({
  motif,
}: {
  motif: (typeof highlights)[number]["motif"];
}) {
  const className = "h-11 w-11 shrink-0 lg:h-14 lg:w-14";

  if (motif === "heart") {
    return (
      <svg viewBox="0 0 36 36" className={className} aria-hidden="true">
        <circle cx="18" cy="18" r="16" fill="#7050a5" fillOpacity="0.16" />
        <path
          d="M18 26s-7.2-4.4-9.4-8.2C6.8 14.8 8 11.5 11.2 11c1.8-.3 3.4.6 4.3 2 0.9-1.4 2.5-2.3 4.3-2 3.2.5 4.4 3.8 2.6 6.8C25.2 21.6 18 26 18 26Z"
          fill="#7050a5"
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
          stroke="#7050a5"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (motif === "home") {
    return (
      <svg viewBox="0 0 36 36" className={className} aria-hidden="true">
        <circle cx="18" cy="18" r="16" fill="#a8cbe6" fillOpacity="0.32" />
        <path
          d="M18 9.2 8.8 16.4v10.2h6.2v-5.4h6v5.4h6.2V16.4Z"
          fill="#6f9fc4"
        />
        <path d="M7.6 16.8 18 8.2l10.4 8.6" fill="none" stroke="#1f2a44" strokeWidth="1.3" strokeLinejoin="round" />
        <path
          d="M18 20.4s-2.6-1.6-3.4-3C14 16.2 14.4 15 15.6 14.8c.7-.1 1.3.3 1.6.8.3-.5.9-.9 1.6-.8 1.2.2 1.6 1.4 1 2.6-.8 1.4-3.4 3-3.4 3Z"
          fill="#7050a5"
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

export function BookHighlights() {
  return (
    <div id="values" className="mt-12 pt-8 sm:mt-14 sm:pt-10 lg:mt-16 lg:pt-12">
      <div className="mb-8 flex items-center justify-center gap-2 sm:mb-10 lg:mb-12">
        <span aria-hidden="true" className="text-lg text-brand-gold">
          ✦
        </span>
        <h3 className="text-[1.375rem] font-semibold tracking-tight text-brand-navy sm:text-[1.625rem] lg:text-[1.95rem]">
          Made with families in mind
        </h3>
      </div>

      <div className="grid gap-7 sm:grid-cols-2 sm:gap-x-8 sm:gap-y-8 lg:grid-cols-4 lg:gap-8">
        {highlights.map((item) => (
          <div
            key={item.title}
            className="flex items-start gap-1 text-left lg:flex-col lg:items-center lg:gap-0.5 lg:text-center"
          >
            <ValueMotif motif={item.motif} />
            <div>
              <h4 className="text-lg font-semibold tracking-tight text-section-navy lg:text-xl">
                {item.title}
              </h4>
              <p className="mt-1.5 text-[0.95rem] leading-relaxed text-brand-charcoal/80 lg:mt-2 lg:text-base">
                {item.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
