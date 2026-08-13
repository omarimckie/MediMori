const highlights = [
  {
    title: "Written with care",
    description: "Created by healthcare professionals and parents who care deeply.",
    icon: (
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#7050a5]/15 text-2xl text-[#7050a5]">
        ♥
      </span>
    ),
  },
  {
    title: "Kid-friendly",
    description: "Easy to understand, engaging stories kids will love.",
    icon: (
      <span className="flex h-12 w-12 items-center justify-center text-3xl text-brand-yellow">
        ★
      </span>
    ),
  },
  {
    title: "Support for families",
    description: "Resources and tips to guide you every step of the way.",
    icon: (
      <span className="flex h-12 w-12 items-end justify-center gap-0.5 pb-1" aria-hidden="true">
        <span className="h-6 w-4 rounded-t-full bg-brand-green/80" />
        <span className="h-7 w-4 rounded-t-full bg-[#7050a5]/80" />
      </span>
    ),
  },
  {
    title: "Diverse & inclusive",
    description: "Stories that reflect the beautiful world our children live in.",
    icon: (
      <span
        aria-hidden="true"
        className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-blue/15"
      >
        <svg viewBox="0 0 24 24" className="h-7 w-7">
          <circle cx="12" cy="12" r="9" fill="#7ec3e8" />
          {/* Continents */}
          <path
            d="M6.5 7.5c1.4-.9 3-.6 4 .3.8.7.6 1.9-.3 2.4-1.2.6-2.8.4-3.7-.5-.7-.7-.8-1.6 0-2.2Z"
            fill="#6aa84f"
          />
          <path
            d="M13.5 12.2c1.6-.4 3.3.2 4.1 1.4.6 1-.1 2.2-1.2 2.5-1.4.4-3-.1-3.8-1.2-.6-.9-.2-2.3.9-2.7Z"
            fill="#6aa84f"
          />
          <path
            d="M8 14.5c.9-.2 1.8.3 2 1.1.2.8-.4 1.6-1.3 1.7-.9.1-1.7-.4-1.9-1.2-.2-.7.4-1.4 1.2-1.6Z"
            fill="#6aa84f"
          />
          <circle
            cx="12"
            cy="12"
            r="9"
            fill="none"
            stroke="#2f6690"
            strokeWidth="1.2"
          />
          {/* Meridian and equator hints */}
          <path
            d="M12 3a14.5 14.5 0 0 1 0 18M12 3a14.5 14.5 0 0 0 0 18M3.6 9.5h16.8M3.6 14.5h16.8"
            fill="none"
            stroke="#2f6690"
            strokeWidth="0.8"
            opacity="0.55"
          />
        </svg>
      </span>
    ),
  },
];

export function BookHighlights() {
  return (
    <div className="mt-16 border-t border-brand-brown/15 pt-12 sm:mt-20 sm:pt-14">
      <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
        {highlights.map((item) => (
          <div
            key={item.title}
            className="flex items-start gap-4 px-4 text-left lg:px-5"
          >
            <div className="shrink-0">{item.icon}</div>
            <div>
              <h3 className="text-lg font-extrabold text-section-navy">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-brand-charcoal/75">
                {item.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
