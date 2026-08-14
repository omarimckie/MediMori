"use client";

import { BookCatalog } from "@/components/BookCatalog";
import { BookHighlights } from "@/components/BookHighlights";
import { EmailSignup } from "@/components/EmailSignup";
import { FriendsSection } from "@/components/FriendsSection";
import { HelpfulResources } from "@/components/HelpfulResources";
import { Hero } from "@/components/Hero";
import { MissionSection } from "@/components/MissionSection";
import { PageSection } from "@/components/PageSection";
import { getBooks } from "@/lib/books";
import { motion } from "framer-motion";

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

export function HomeClient() {
  const books = getBooks();

  return (
    <main>
      <Hero />

      <div id="friends" className="scroll-mt-24">
        <FriendsSection />
      </div>

      <MissionSection />

      <PageSection
        tone="white"
        cloudTop="white"
        id="books"
        className="relative scroll-mt-24 overflow-hidden bg-transparent"
        containerClassName="relative mx-auto max-w-7xl"
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
          className="absolute right-[18%] top-24 hidden text-xl text-brand-gold/70 lg:block"
        >
          ★
        </span>
        <div className="relative z-10">
          <div className="mb-10 text-center sm:mb-12">
            <div className="flex items-center justify-center gap-3">
              <span aria-hidden="true" className="text-2xl text-brand-yellow">
                ✦
              </span>
              <h2 className="text-3xl font-semibold tracking-tight text-brand-navy sm:text-4xl">
                Our books
              </h2>
              <span aria-hidden="true" className="text-2xl text-brand-yellow">
                ✦
              </span>
            </div>
            <p className="mt-3 text-brand-charcoal/75">
              Three titles today — more stories on the way.
            </p>
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

      <HelpfulResources />
    </main>
  );
}
