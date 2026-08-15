import { PageSection } from "@/components/PageSection";
import { friends, getFriend } from "@/data/friends";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
};

export function generateStaticParams() {
  return friends.map((friend) => ({ id: friend.id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const friend = getFriend(id);

  return {
    title: friend ? `Meet ${friend.name} — Twilight.Feather` : "Meet our friends",
    description: friend?.tagline,
  };
}

export default async function FriendPage({ params }: Props) {
  const { id } = await params;
  const friend = getFriend(id);

  if (!friend) notFound();

  const otherFriend = friends.find((item) => item.id !== friend.id);
  const accent =
    friend.accent === "purple"
      ? {
          heading: "text-[#7050a5]",
          button: "bg-[#7050a5]",
          glow: "bg-[#7050a5]/20",
        }
      : {
          heading: "text-brand-blue-deep",
          button: "bg-brand-blue-deep",
          glow: "bg-brand-blue/25",
        };

  return (
    <main>
      <PageSection
        tone="cream"
        className="relative overflow-hidden"
        containerClassName="relative mx-auto grid max-w-5xl items-center gap-10 lg:grid-cols-[0.85fr_1.15fr]"
      >
        <div
          aria-hidden="true"
          className={`absolute -left-16 top-6 h-52 w-52 rounded-full blur-3xl ${accent.glow}`}
        />
        <div className="relative mx-auto aspect-[4/5] w-full max-w-sm overflow-hidden rounded-[2rem] border border-brand-brown/10 bg-white shadow-xl">
          {friend.imageSrc ? (
            <Image
              src={friend.imageSrc}
              alt={friend.name}
              fill
              priority
              sizes="(min-width: 1024px) 35vw, 90vw"
              className="object-contain object-bottom p-6"
            />
          ) : (
            <Image
              src="/children-reading.png"
              alt={friend.name}
              fill
              priority
              sizes="(min-width: 1024px) 35vw, 90vw"
              className="scale-[1.38] object-cover"
              style={{ objectPosition: friend.imagePosition }}
            />
          )}
        </div>

        <div className="relative text-center lg:text-left">
          <Link
            href="/#friends"
            className="inline-flex rounded-full border border-brand-brown/20 bg-white/65 px-4 py-2 text-sm font-bold text-brand-charcoal transition hover:bg-white"
          >
            ← Meet our friends
          </Link>
          <p className="mt-7 text-sm font-extrabold uppercase tracking-wider text-brand-orange-deep">
            Meet
          </p>
          <h1 className={`mt-1 text-5xl font-extrabold sm:text-6xl ${accent.heading}`}>
            {friend.name}
          </h1>
          <p className="mt-4 text-xl font-bold leading-relaxed text-section-navy">
            {friend.tagline}
          </p>
          <p className="mt-6 text-lg leading-relaxed text-brand-charcoal/80">
            {friend.introduction}
          </p>
          <p className="mt-4 text-lg leading-relaxed text-brand-charcoal/80">
            {friend.personality}
          </p>
        </div>
      </PageSection>

      <PageSection tone="navy" cloudTop="cream" containerClassName="mx-auto max-w-3xl text-center">
        <span aria-hidden="true" className="text-3xl text-brand-yellow-bright">
          ✦
        </span>
        <h2 className="mt-3 text-2xl font-extrabold text-white sm:text-3xl">
          Continue the adventure
        </h2>
        <p className="mt-3 text-white/80">
          Discover stories made to help little readers learn, grow, and feel
          brave.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link
            href="/books"
            className={`inline-flex rounded-xl px-5 py-3 text-sm font-extrabold text-white transition hover:brightness-110 ${accent.button}`}
          >
            Explore our books
          </Link>
          {otherFriend ? (
            <Link
              href={`/friends/${otherFriend.id}`}
              className="inline-flex rounded-xl border border-white/45 bg-white/10 px-5 py-3 text-sm font-extrabold text-white transition hover:bg-white/20"
            >
              Meet {otherFriend.name}
            </Link>
          ) : null}
        </div>
      </PageSection>
    </main>
  );
}
