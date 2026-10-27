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
      cloudTop="white"
      className="relative overflow-visible"
      containerClassName="relative mx-auto max-w-7xl"
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

        <div
          className={`grid gap-5 overflow-visible sm:grid-cols-2 ${
            friends.length >= 3 ? "lg:grid-cols-3" : "lg:grid-cols-2"
          }`}
        >
          {friends.map((friend) => {
            const styles = accentStyles[friend.accent];

            return friend.torsoCrop && friend.imageSrc ? (
              <Link
                key={friend.id}
                href={`/friends/${friend.id}`}
                className="group relative block overflow-visible pt-6 transition hover:-translate-y-1 sm:pt-8"
                aria-label={`Meet ${friend.name}`}
              >
                {/* Card chrome stays rounded; portrait is a sibling so hair can clear the top edge. */}
                <div
                  className={`grid min-h-60 grid-cols-[42%_1fr] rounded-3xl border shadow-sm transition group-hover:shadow-lg ${styles.card}`}
                >
                  <div aria-hidden="true" className="min-h-60" />
                  <div className="flex h-full flex-col items-start justify-start p-5 sm:p-7">
                    <h3 className={`text-[1.8rem] font-extrabold leading-none ${styles.title}`}>
                      {friend.name}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-brand-charcoal/80">
                      {friend.tagline}
                    </p>
                    <span
                      className={`mt-5 inline-flex rounded-xl border px-[1.38rem] py-[0.69rem] text-[0.97rem] font-bold transition sm:px-[1.65rem] sm:py-[0.83rem] ${styles.button}`}
                    >
                      Meet {friend.name}
                    </span>
                  </div>
                </div>
                <div className="absolute bottom-0 left-0 top-0 z-10 w-[42%] overflow-visible">
                  {friend.id === "aj" ? (
                    <div
                      className="absolute inset-0 overflow-visible"
                      style={{ clipPath: "inset(-5rem -4rem 0 -2.5rem)" }}
                    >
                      <img
                        src={friend.cardImageSrc ?? friend.imageSrc}
                        alt=""
                        className="absolute top-0 left-1/2 h-full w-auto max-w-none -translate-x-1/2 object-top"
                      />
                    </div>
                  ) : (
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
                  )}
                </div>
              </Link>
            ) : (
              <Link
                key={friend.id}
                href={`/friends/${friend.id}`}
                className={`group grid min-h-60 grid-cols-[42%_1fr] overflow-hidden rounded-3xl border shadow-sm transition hover:-translate-y-1 hover:shadow-lg ${styles.card}`}
                aria-label={`Meet ${friend.name}`}
              >
                <div className="relative min-h-60 overflow-hidden bg-white">
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
                <div className="flex h-full flex-col items-start justify-start p-6 sm:p-7">
                  <h3 className={`text-[1.8rem] font-extrabold leading-none ${styles.title}`}>
                    {friend.name}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-brand-charcoal/80">
                    {friend.tagline}
                  </p>
                    <span
                      className={`mt-5 inline-flex rounded-xl border px-[1.38rem] py-[0.69rem] text-[0.97rem] font-bold transition sm:px-[1.65rem] sm:py-[0.83rem] ${styles.button}`}
                    >
                      Meet {friend.name}
                    </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </PageSection>
  );
}
