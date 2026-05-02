"use client";

import { BookCard } from "@/components/BookCard";
import { EmailSignup } from "@/components/EmailSignup";
import { getBooks } from "@/lib/books";
import { motion } from "framer-motion";
import Link from "next/link";

export default function Home() {
  const books = getBooks();

  return (
    <main>
      <motion.section
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="border-b border-brand-brown/10 bg-gradient-to-b from-white to-cream px-4 py-16 sm:px-6 sm:py-24"
      >
        <div className="mx-auto max-w-3xl text-center">
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
            className="text-4xl font-extrabold tracking-tight text-brand-charcoal sm:text-5xl"
          >
            Stories that help little ones{" "}
            <span className="text-brand-blue-deep">grow</span>,{" "}
            <span className="text-brand-green-deep">heal</span>, and feel{" "}
            <span className="text-brand-orange-deep">brave</span>.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.25, ease: "easeOut" }}
            className="mt-6 text-lg leading-relaxed text-brand-charcoal/80"
          >
            Twilight.Feather publishes gentle, colorful children’s books rooted in wellness
            and care. Choose a paperback on Amazon, or buy an eBook here for an instant
            download after checkout.
          </motion.p>
        </div>
      </motion.section>

      <EmailSignup />

      <section className="px-4 py-8 sm:px-6 sm:py-12">
        <div className="mx-auto max-w-5xl rounded-3xl border border-brand-orange/20 bg-white p-6 shadow-sm shadow-brand-brown/10 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-extrabold uppercase tracking-wider text-brand-orange-deep">
                New Section
              </p>
              <h2 className="mt-1 text-2xl font-extrabold text-brand-charcoal sm:text-3xl">
                Visit our blog
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-brand-charcoal/75 sm:text-base">
                Read wellness tips, family reading guidance, and updates from the
                Twilight.Feather team.
              </p>
            </div>
            <Link
              href="/blog"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-brand-orange-deep px-5 text-sm font-bold text-white transition hover:brightness-95"
            >
              Open blog
            </Link>
          </div>
        </div>
      </section>

      <section id="books" className="scroll-mt-24 px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-extrabold text-brand-charcoal">Our books</h2>
            <p className="mt-2 text-brand-charcoal/75">
              Two titles today — more stories on the way.
            </p>
          </div>
          <motion.div
            className="grid gap-10 md:grid-cols-2"
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
        </div>
      </section>
    </main>
  );
}
