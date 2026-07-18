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
        className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-brand-blue/25"
      >
        <span className="absolute inset-x-1 top-2 h-2 rounded-full bg-brand-green/70" />
        <span className="absolute inset-y-2 left-1 w-2 rounded-full bg-brand-blue-deep/55" />
        <span className="absolute bottom-2 right-1.5 h-2.5 w-3 rounded-full bg-brand-green/55" />
      </span>
    ),
  },
];

export function BookHighlights() {
  return (
    <div className="mt-14 border-t border-brand-brown/15 pt-10">
      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">
        {highlights.map((item, index) => (
          <div
            key={item.title}
            className={`flex flex-col items-center px-4 text-center lg:px-6 ${
              index > 0 ? "lg:border-l lg:border-brand-brown/15" : ""
            }`}
          >
            {item.icon}
            <h3 className="mt-4 text-lg font-extrabold text-section-navy">
              {item.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-brand-charcoal/75">
              {item.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
