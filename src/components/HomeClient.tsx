"use client";

import { BookCatalog } from "@/components/BookCatalog";
import { BookHighlights } from "@/components/BookHighlights";
import { EmailSignup } from "@/components/EmailSignup";
import { FriendsSection } from "@/components/FriendsSection";
import { PageSection } from "@/components/PageSection";
import { getBooks } from "@/lib/books";
import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";

function ScrollingRocket() {
  return (
    <motion.div
      aria-hidden="true"
      initial={{ opacity: 0, x: 70, y: 70, rotate: 24 }}
      whileInView={{ opacity: 0.8, x: 0, y: 0, rotate: 12 }}
      viewport={{ once: true, amount: 0.35 }}
      transition={{ duration: 1, ease: "easeOut" }}
      className="pointer-events-none absolute -right-3 top-10 z-0 hidden w-24 select-none lg:block xl:right-4"
    >
      <svg viewBox="0 0 100 150" role="presentation">
        <path
          d="M50 8C31 28 27 58 32 96h36c5-38 1-68-18-88Z"
          fill="#7050a5"
        />
        <path d="M50 8v88h18c5-38 1-68-18-88Z" fill="#543b84" />
        <circle cx="50" cy="50" r="12" fill="#f8dc75" stroke="#fff" strokeWidth="4" />
        <path d="m32 73-16 31 18-7Z" fill="#e78d56" />
        <path d="m68 73 16 31-18-7Z" fill="#e78d56" />
        <path d="M39 96h22l-4 15H43Z" fill="#263d63" />
        <path
          d="M43 111c0 14 7 28 7 28s7-14 7-28Z"
          fill="#f5b93f"
        />
        <path
          d="M47 111c0 9 3 17 3 17s3-8 3-17Z"
          fill="#ef6f4d"
        />
      </svg>
    </motion.div>
  );
}

function ScrollingPlanet() {
  return (
    <motion.div
      aria-hidden="true"
      initial={{ opacity: 0, scale: 0.65, rotate: -24 }}
      whileInView={{ opacity: 0.65, scale: 1, rotate: -12 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ duration: 0.9, ease: "easeOut" }}
      className="pointer-events-none absolute -left-8 top-1/2 z-0 hidden h-32 w-32 -translate-y-1/2 select-none md:block lg:left-5"
    >
      <div className="absolute inset-5 rounded-full bg-brand-blue shadow-[inset_-18px_-12px_0_rgba(112,80,165,0.35)]" />
      <div className="absolute inset-x-0 top-[50px] h-8 rounded-[50%] border-[7px] border-brand-orange/70" />
      <span className="absolute right-2 top-1 text-2xl text-brand-yellow">✦</span>
      <span className="absolute bottom-0 left-2 text-lg text-[#7050a5]">★</span>
    </motion.div>
  );
}

export type HomeBlogPost = {
  slug: string;
  title: string;
  dateLabel: string;
  imageUrl?: string;
};

type HomeClientProps = {
  latestPosts: HomeBlogPost[];
};

export function HomeClient({ latestPosts }: HomeClientProps) {
  const books = getBooks();

  return (
    <main>
      <PageSection
        tone="cream"
        className="relative overflow-hidden bg-[radial-gradient(circle_at_15%_20%,rgba(255,255,255,0.95),transparent_38%),radial-gradient(circle_at_85%_15%,rgba(216,205,241,0.55),transparent_34%)]"
        containerClassName="relative mx-auto grid max-w-6xl items-center gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-8"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 select-none"
        >
          {/* Watercolor cloud bank behind the children */}
          <div className="absolute bottom-0 right-0 h-[72%] w-full sm:w-[70%] lg:w-[60%]">
            <span className="absolute bottom-[6%] left-[8%] h-[45%] w-[62%] rounded-full bg-white/90 blur-2xl" />
            <span className="absolute bottom-[18%] right-[2%] h-[48%] w-[58%] rounded-full bg-[#e6dcf6]/80 blur-2xl" />
            <span className="absolute bottom-[30%] left-[24%] h-[40%] w-[52%] rounded-full bg-white/75 blur-3xl" />
            <span className="absolute bottom-0 right-[16%] h-[34%] w-[64%] rounded-full bg-[#efe7fa]/90 blur-xl" />
            <span className="absolute bottom-[42%] right-[6%] h-[30%] w-[38%] rounded-full bg-[#dfd2f2]/70 blur-2xl" />
            <span className="absolute bottom-[8%] left-0 h-[30%] w-[36%] rounded-full bg-[#f6eefe]/85 blur-xl" />
          </div>
          {/* Smaller drifting puffs near the moon */}
          <span className="absolute right-[2%] top-[10%] h-14 w-40 rounded-full bg-white/70 blur-xl" />
          <span className="absolute right-[20%] top-[22%] hidden h-12 w-32 rounded-full bg-[#eae0f8]/70 blur-xl sm:block" />

          <span className="absolute left-[2%] top-[7%] text-2xl text-brand-yellow">
            ✦
          </span>
          <span className="absolute left-[43%] top-[4%] text-xl text-brand-orange/70">
            ★
          </span>
          <span className="absolute left-[47%] top-[24%] hidden text-2xl text-[#8f76bc]/65 sm:block">
            ✦
          </span>
          <span className="absolute bottom-[20%] left-[45%] text-xl text-brand-blue/65">
            ★
          </span>
          <span className="absolute right-[4%] top-[38%] text-2xl text-brand-yellow/80">
            ✦
          </span>
          <span className="absolute bottom-[8%] right-[1%] hidden text-xl text-brand-orange/60 sm:block">
            ★
          </span>

          <div className="absolute right-[7%] top-[2%] h-14 w-14 rounded-full border-l-[12px] border-brand-yellow/70 sm:h-16 sm:w-16" />
          <div className="absolute right-[38%] top-[12%] hidden h-9 w-9 rounded-full bg-brand-blue/35 shadow-[inset_-7px_-5px_0_rgba(112,80,165,0.2)] sm:block">
            <div className="absolute -inset-x-3 top-3 h-3 rotate-[-18deg] rounded-[50%] border-2 border-brand-orange/45" />
          </div>
          <span className="absolute right-[29%] top-[7%] h-2.5 w-2.5 rounded-full bg-brand-orange/60" />
          <span className="absolute bottom-[29%] right-[43%] h-3 w-3 rounded-full bg-brand-green/55" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="relative z-10 text-center lg:text-left"
        >
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
            className="text-4xl font-extrabold tracking-tight text-section-navy sm:text-5xl lg:text-6xl"
          >
            Stories that help little ones{" "}
            <span className="inline-block text-[1.16em] leading-none text-brand-orange-deep sm:text-[1.2em]">
              grow
            </span>
            ,{" "}
            <span className="inline-block text-[1.16em] leading-none text-[#7050a5] sm:text-[1.2em]">
              heal
            </span>
            , and feel{" "}
            <span className="inline-block text-[1.16em] leading-none text-brand-blue-deep sm:text-[1.2em]">
              brave
            </span>
            .
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.25, ease: "easeOut" }}
            className="mt-6 text-lg leading-relaxed text-brand-charcoal/80"
          >
            Twilight.Feather publishes gentle, colorful children&apos;s books rooted in wellness
            and care.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.35, ease: "easeOut" }}
            className="mt-7 flex flex-wrap justify-center gap-3 lg:justify-start"
          >
            <Link
              href="/#books"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-[#7050a5] px-5 text-sm font-extrabold text-white transition hover:brightness-95"
            >
              Explore Our Books
            </Link>
            <Link
              href="/resources"
              className="inline-flex h-11 items-center justify-center rounded-xl border-2 border-[#7050a5] bg-white/65 px-5 text-sm font-extrabold text-[#7050a5] transition hover:bg-white"
            >
              Learn &amp; Grow Together
            </Link>
          </motion.div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 32 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7, delay: 0.15, ease: "easeOut" }}
          className="relative z-10 -mb-10 mix-blend-multiply sm:-mb-14 lg:-mb-20 lg:-mt-10"
        >
          <Image
            src="/children-reading.png"
            alt="Two children sitting together and reading a picture book"
            width={1024}
            height={819}
            priority
            sizes="(min-width: 1024px) 55vw, 100vw"
            className="h-auto w-full"
          />
        </motion.div>
      </PageSection>

      <div id="friends" className="scroll-mt-24">
        <FriendsSection />
      </div>

      <PageSection
        tone="cream"
        cloudTop="white"
        id="books"
        className="relative scroll-mt-24 overflow-hidden"
        containerClassName="mx-auto max-w-7xl"
      >
        <ScrollingRocket />
        <span
          aria-hidden="true"
          className="absolute left-[8%] top-16 text-2xl text-brand-yellow"
        >
          ✦
        </span>
        <span
          aria-hidden="true"
          className="absolute right-[26%] top-20 hidden text-xl text-brand-orange sm:block"
        >
          ★
        </span>
        <span
          aria-hidden="true"
          className="absolute bottom-14 left-[4%] hidden text-xl text-[#8f76bc]/70 sm:block"
        >
          ★
        </span>
        <div className="relative z-10">
          <div className="mb-10 text-center">
            <div className="flex items-center justify-center gap-3">
              <span aria-hidden="true" className="text-2xl text-brand-yellow">
                ✦
              </span>
              <h2 className="text-3xl font-extrabold text-section-navy">Our books</h2>
              <span aria-hidden="true" className="text-2xl text-brand-yellow">
                ✦
              </span>
            </div>
            <p className="mt-2 text-brand-charcoal/75">Three titles today — more stories on the way.</p>
          </div>
          <BookCatalog books={books} />
          <BookHighlights />
        </div>
      </PageSection>

      <PageSection tone="white" cloudTop="cream" className="relative overflow-hidden">
        <ScrollingPlanet />
        <div className="relative z-10">
          <EmailSignup />
        </div>
      </PageSection>

      <PageSection
        tone="navy"
        cloudTop="white"
        containerClassName="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.9fr_2.1fr] lg:items-start"
      >
        <div className="text-center lg:text-left">
          <h2 className="text-2xl font-extrabold text-white sm:text-3xl">
            From our blog
          </h2>
          <p className="mt-3 text-white/80">
            Read wellness tips, family guides, and updates from the Twilight
            Feather team.
          </p>
          <Link
            href="/blog"
            className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-brand-yellow-bright px-6 text-sm font-bold text-section-navy transition hover:brightness-95"
          >
            Open Blog
          </Link>
        </div>

        <div className="grid gap-6 sm:grid-cols-3">
          {latestPosts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="group block"
            >
              <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-white/10">
                {post.imageUrl ? (
                  <Image
                    src={post.imageUrl}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 22vw, (min-width: 640px) 30vw, 90vw"
                    className="object-cover transition duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center bg-[linear-gradient(135deg,#31497a_0%,#7050a5_100%)]">
                    <span aria-hidden="true" className="text-4xl text-brand-yellow-bright">
                      ✦
                    </span>
                  </div>
                )}
              </div>
              <h3 className="mt-3 text-base font-extrabold leading-snug text-white underline-offset-4 group-hover:underline">
                {post.title}
              </h3>
              <p className="mt-1.5 text-xs font-semibold text-white/65">
                {post.dateLabel}
              </p>
            </Link>
          ))}
        </div>
      </PageSection>
    </main>
  );
}
