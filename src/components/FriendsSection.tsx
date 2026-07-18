import { PageSection } from "@/components/PageSection";
import { friends } from "@/data/friends";
import Image from "next/image";
import Link from "next/link";

const accentStyles = {
  purple: {
    card: "border-[#7050a5]/25 bg-[#f7f1ff]",
    title: "text-[#7050a5]",
    button: "border-[#7050a5]/45 text-[#7050a5] group-hover:bg-[#7050a5] group-hover:text-white",
  },
  blue: {
    card: "border-brand-blue/35 bg-[#eef7ff]",
    title: "text-brand-blue-deep",
    button: "border-brand-blue/50 text-brand-blue-deep group-hover:bg-brand-blue-deep group-hover:text-white",
  },
};

export function FriendsSection() {
  return (
    <PageSection
      tone="white"
      cloudTop="cream"
      className="relative overflow-visible"
      containerClassName="relative mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.35fr_0.8fr] lg:items-end"
    >
      <span
        aria-hidden="true"
        className="absolute -top-7 left-[12%] text-2xl text-brand-yellow"
      >
        ✦
      </span>
      <span
        aria-hidden="true"
        className="absolute right-[34%] top-1 hidden text-xl text-brand-orange sm:block"
      >
        ★
      </span>

      <div>
        <div className="mb-6 flex items-center justify-center gap-3 lg:justify-start">
          <span aria-hidden="true" className="text-2xl text-brand-yellow">
            ✦
          </span>
          <h2 className="text-3xl font-extrabold text-section-navy">
            Meet our friends
          </h2>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {friends.map((friend) => {
            const styles = accentStyles[friend.accent];

            return friend.torsoCrop && friend.imageSrc ? (
              <Link
                key={friend.id}
                href={`/friends/${friend.id}`}
                className="group relative block pt-8 transition hover:-translate-y-1"
                aria-label={`Meet ${friend.name}`}
              >
                {/* Card chrome stays rounded; portrait is a sibling so hair can clear the top edge. */}
                <div
                  className={`grid min-h-52 grid-cols-[42%_1fr] rounded-3xl border shadow-sm transition group-hover:shadow-lg ${styles.card}`}
                >
                  <div aria-hidden="true" className="min-h-52" />
                  <div className="flex flex-col items-start justify-center p-5">
                    <h3 className={`text-2xl font-extrabold ${styles.title}`}>
                      {friend.name}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-brand-charcoal/80">
                      {friend.tagline}
                    </p>
                    <span
                      className={`mt-5 inline-flex rounded-xl border px-4 py-2 text-sm font-bold transition ${styles.button}`}
                    >
                      Meet {friend.name}
                    </span>
                  </div>
                </div>
                <div className="absolute bottom-0 left-0 top-0 w-[42%]">
                  <Image
                    src={friend.cardImageSrc ?? friend.imageSrc}
                    alt={friend.name}
                    fill
                    sizes="(min-width: 640px) 18vw, 42vw"
                    className="object-cover object-top"
                    style={
                      friend.cardObjectPosition
                        ? { objectPosition: friend.cardObjectPosition }
                        : undefined
                    }
                  />
                </div>
              </Link>
            ) : (
              <Link
                key={friend.id}
                href={`/friends/${friend.id}`}
                className={`group grid min-h-52 grid-cols-[42%_1fr] overflow-hidden rounded-3xl border shadow-sm transition hover:-translate-y-1 hover:shadow-lg ${styles.card}`}
                aria-label={`Meet ${friend.name}`}
              >
                <div className="relative min-h-52 overflow-hidden bg-white">
                  {friend.imageSrc ? (
                    <Image
                      src={friend.imageSrc}
                      alt={friend.name}
                      fill
                      sizes="(min-width: 640px) 18vw, 42vw"
                      className="object-contain object-bottom p-2"
                    />
                  ) : (
                    <Image
                      src="/children-reading.png"
                      alt={friend.name}
                      fill
                      sizes="(min-width: 640px) 18vw, 42vw"
                      className="scale-[1.42] object-cover"
                      style={{ objectPosition: friend.imagePosition }}
                    />
                  )}
                </div>
                <div className="flex flex-col items-start justify-center p-5">
                  <h3 className={`text-2xl font-extrabold ${styles.title}`}>
                    {friend.name}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-brand-charcoal/80">
                    {friend.tagline}
                  </p>
                  <span
                    className={`mt-5 inline-flex rounded-xl border px-4 py-2 text-sm font-bold transition ${styles.button}`}
                  >
                    Meet {friend.name}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <aside className="relative overflow-hidden rounded-3xl border border-brand-blue/20 bg-[linear-gradient(145deg,#eef8ff_0%,#fffaf0_55%,#e9f4dc_100%)] p-7 shadow-sm sm:p-8">
        <div
          aria-hidden="true"
          className="absolute -bottom-10 -right-8 h-36 w-36 rounded-full bg-brand-green/25 blur-sm"
        />
        <div
          aria-hidden="true"
          className="absolute right-8 top-6 text-2xl text-brand-orange"
        >
          ♥
        </div>
        <h3 className="relative text-2xl font-extrabold text-section-navy">
          Our mission
        </h3>
        <p className="relative mt-4 leading-relaxed text-brand-charcoal/85">
          To empower children and families with stories that educate, inspire,
          and support better health for a brighter tomorrow.
        </p>
        <div className="relative mt-7 flex items-end justify-end gap-3">
          <span className="text-4xl text-[#7050a5]/70" aria-hidden="true">
            ❧
          </span>
          <div
            aria-hidden="true"
            className="h-16 w-20 rounded-t-full bg-brand-green/45"
          />
        </div>
      </aside>
    </PageSection>
  );
}
