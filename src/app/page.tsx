"use client";

import { BookCard } from "@/components/BookCard";
import { EmailSignup } from "@/components/EmailSignup";
import { PageSection } from "@/components/PageSection";
import { getBooks } from "@/lib/books";
import { motion } from "framer-motion";
import Link from "next/link";

export default function Home() {
  const books = getBooks();

  return (
    <main>
      <PageSection tone="navy" containerClassName="mx-auto max-w-3xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
            className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl"
          >
            Stories that help little ones{" "}
            <span className="text-brand-yellow-bright">grow</span>,{" "}
            <span className="text-brand-yellow-bright">heal</span>, and feel{" "}
            <span className="text-brand-yellow-bright">brave</span>.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.25, ease: "easeOut" }}
            className="mt-6 text-lg leading-relaxed text-white/85"
          >
            Twilight.Feather publishes gentle, colorful children&apos;s books rooted in wellness
            and care. Choose a paperback on Amazon, or buy an eBook here for an instant
            download after checkout.
          </motion.p>
        </motion.div>
      </PageSection>

      <PageSection tone="white" id="books" className="scroll-mt-24">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-extrabold text-brand-charcoal">Our books</h2>
          <p className="mt-2 text-brand-charcoal/75">Three titles today — more stories on the way.</p>
        </div>
        <motion.div
          className="grid gap-10 md:grid-cols-2 lg:grid-cols-3"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.12 } },
          }}
        >
          {books.map((book) => (
            <motion.div
              key={book.id}
              variants={{
                hidden: { opacity: 0, y: 24 },
                visible: { opacity: 1, y: 0 },
              }}
              transition={{ duration: 0.45, ease: "easeOut" }}
            >
              <BookCard book={book} />
            </motion.div>
          ))}
        </motion.div>
      </PageSection>

      <PageSection tone="cream">
        <EmailSignup />
      </PageSection>

      <PageSection tone="navy">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-extrabold uppercase tracking-wider text-brand-yellow-bright">
            From our blog
          </p>
          <h2 className="mt-2 text-2xl font-extrabold text-white sm:text-3xl">
            Visit our blog
          </h2>
          <p className="mt-3 text-white/80">
            Read wellness tips, family reading guidance, and updates from the
            Twilight.Feather team.
          </p>
          <Link
            href="/blog"
            className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-brand-yellow-bright px-6 text-sm font-bold text-section-navy transition hover:brightness-95"
          >
            Open blog
          </Link>
        </div>
      </PageSection>
    </main>
  );
}
