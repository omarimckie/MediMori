"use client";

import { PageSection } from "@/components/PageSection";
import { TfButton } from "@/components/ui/TfButton";
import { motion } from "framer-motion";
import Image from "next/image";

function HeroRocket() {
  return (
    <motion.div
      aria-hidden="true"
      initial={{ opacity: 0, x: 28, y: 36, rotate: 18 }}
      animate={{ opacity: 0.72, x: 0, y: 0, rotate: 10 }}
      transition={{ duration: 1.1, delay: 0.45, ease: "easeOut" }}
      className="pointer-events-none absolute right-0 top-[4%] z-[1] hidden w-[4.25rem] select-none sm:block md:right-1 md:top-[2%] lg:right-[1%] lg:top-0 lg:w-[5rem]"
    >
      <svg viewBox="0 0 100 150" role="presentation" className="h-auto w-full drop-shadow-sm">
        <path
          d="M50 8C31 28 27 58 32 96h36c5-38 1-68-18-88Z"
          fill="#7050a5"
        />
        <path d="M50 8v88h18c5-38 1-68-18-88Z" fill="#543b84" />
        <circle cx="50" cy="50" r="12" fill="#f8dc75" stroke="#fff" strokeWidth="4" />
        <path d="m32 73-16 31 18-7Z" fill="#e78d56" />
        <path d="m68 73 16 31-18-7Z" fill="#e78d56" />
        <path d="M39 96h22l-4 15H43Z" fill="#263d63" />
        <path d="M43 111c0 14 7 28 7 28s7-14 7-28Z" fill="#f5b93f" />
        <path d="M47 111c0 9 3 17 3 17s3-8 3-17Z" fill="#ef6f4d" />
      </svg>
    </motion.div>
  );
}

export function Hero() {
  return (
    <PageSection
      tone="cream"
      className="tf-hero relative overflow-hidden !pb-6 sm:!pt-12 sm:!pb-10 lg:!pt-14 lg:!pb-4"
      containerClassName="relative mx-auto grid max-w-7xl items-center gap-8 md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] md:gap-8 lg:gap-10 xl:gap-14"
    >
      {/* Soft lavender / cream atmosphere — continuous cloudscape */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 select-none">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_65%_50%_at_12%_18%,rgba(200,182,230,0.22),transparent_58%),radial-gradient(ellipse_55%_45%_at_88%_12%,rgba(168,203,230,0.16),transparent_55%),radial-gradient(ellipse_70%_55%_at_72%_92%,rgba(200,182,230,0.18),transparent_60%)]" />

        {/* Watercolor bank behind characters */}
        <div className="absolute bottom-0 right-0 h-[58%] w-full sm:h-[62%] sm:w-[72%] lg:h-[78%] lg:w-[58%]">
          <span className="absolute bottom-[4%] left-[6%] h-[48%] w-[64%] rounded-full bg-white/85 blur-2xl" />
          <span className="absolute bottom-[16%] right-[0%] h-[52%] w-[60%] rounded-full bg-[#e6dcf6]/70 blur-2xl" />
          <span className="absolute bottom-[28%] left-[22%] h-[42%] w-[54%] rounded-full bg-white/70 blur-3xl" />
          <span className="absolute bottom-0 right-[14%] h-[36%] w-[66%] rounded-full bg-[#efe7fa]/80 blur-xl" />
        </div>

        {/* Soft bottom cloud wash into the next section */}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent via-[color-mix(in_srgb,var(--cream)_55%,transparent)] to-[color-mix(in_srgb,var(--cream)_90%,transparent)] sm:h-28" />

        {/* Sparse stars / sparkles */}
        <span className="absolute left-[3%] top-[9%] text-xl text-brand-gold/80 sm:text-2xl">✦</span>
        <span className="absolute left-[38%] top-[5%] hidden text-lg text-brand-gold/55 sm:block">★</span>
        <span className="absolute right-[42%] top-[18%] hidden text-xl text-[#8f76bc]/50 lg:block">✦</span>
        <span className="absolute bottom-[34%] left-[48%] hidden text-lg text-brand-sky/70 lg:block">★</span>
      </div>

      <HeroRocket />

      <motion.div
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: "easeOut" }}
        className="relative z-10 order-1 mx-auto max-w-xl text-center md:mx-0 md:max-w-none md:text-left"
      >
        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }}
          className="text-[2.05rem] font-semibold leading-[1.15] tracking-tight text-brand-navy sm:text-4xl md:text-[2.65rem] lg:text-[3.15rem] xl:text-[3.35rem]"
        >
          Stories that help little ones{" "}
          <span className="text-brand-orange-deep">grow</span>,{" "}
          <span className="text-brand-green-deep">heal</span>, and feel{" "}
          <span className="text-brand-blue-deep">brave</span>.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2, ease: "easeOut" }}
          className="mx-auto mt-5 max-w-md text-base leading-relaxed text-brand-charcoal/80 sm:mt-6 sm:text-lg md:mx-0 md:max-w-lg"
        >
          Twilight.Feather publishes gentle, colorful children&apos;s books rooted
          in wellness and care.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3, ease: "easeOut" }}
          className="mt-7 flex w-full flex-col gap-3 sm:mt-8 sm:flex-row sm:flex-wrap sm:justify-center md:justify-start"
        >
          <TfButton href="/#books" variant="primary" className="w-full sm:w-auto">
            Explore Our Books
          </TfButton>
          <TfButton href="/resources" variant="ghost" className="w-full sm:w-auto">
            Learn &amp; Grow Together
          </TfButton>
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.18, ease: "easeOut" }}
        className="relative z-10 order-2 -mb-6 sm:-mb-8 md:-mb-12 md:-mt-4 lg:-mb-16 lg:-mt-8"
      >
        <Image
          src="/children-reading.png"
          alt="AJ and Amara sitting together and reading a picture book"
          width={1280}
          height={1024}
          priority
          unoptimized
          sizes="(min-width: 1024px) 48vw, (min-width: 640px) 70vw, 92vw"
          className="relative z-[1] mx-auto h-auto w-full max-w-xl object-contain lg:max-w-none"
        />
      </motion.div>
    </PageSection>
  );
}
