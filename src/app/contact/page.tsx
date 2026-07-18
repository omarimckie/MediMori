import { PageSection } from "@/components/PageSection";
import Link from "next/link";

export const metadata = {
  title: "Contact Us — Twilight.Feather",
  description: "Get in touch with the Twilight.Feather team.",
};

const socialLinks = [
  { label: "Instagram", href: "https://www.instagram.com/twilight.feather/" },
  { label: "Facebook", href: "https://www.facebook.com/twilight.feather/" },
  { label: "TikTok", href: "https://tiktok.com/@twilightfeather" },
];

export default function ContactPage() {
  return (
    <main>
      <PageSection tone="navy" containerClassName="mx-auto max-w-3xl text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
          Contact Us
        </h1>
        <p className="mt-4 text-white/80">
          We would love to hear from you — questions, feedback, or just to say
          hello.
        </p>
      </PageSection>

      <PageSection tone="white" cloudTop="navy" containerClassName="mx-auto max-w-3xl text-center">
        <h2 className="text-2xl font-extrabold text-brand-charcoal">
          Reach us on social media
        </h2>
        <p className="mt-3 text-brand-charcoal/80">
          The fastest way to reach the Twilight.Feather team is a message on
          any of our channels.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {socialLinks.map((social) => (
            <a
              key={social.label}
              href={social.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex rounded-xl border-2 border-[#7050a5] bg-white px-5 py-2.5 text-sm font-extrabold text-[#7050a5] transition hover:bg-[#7050a5] hover:text-white"
            >
              {social.label}
            </a>
          ))}
        </div>
        <p className="mt-10 text-brand-charcoal/70">
          Looking for our books instead?
        </p>
        <Link
          href="/#books"
          className="mt-3 inline-flex rounded-xl bg-brand-yellow-bright px-6 py-3 text-sm font-bold text-section-navy transition hover:brightness-95"
        >
          Browse our books
        </Link>
      </PageSection>
    </main>
  );
}
