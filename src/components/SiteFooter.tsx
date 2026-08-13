import { InstagramIcon } from "@/components/SocialIcons";
import Image from "next/image";
import Link from "next/link";
import type { SVGProps } from "react";

function FacebookIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M13.7 21v-8.2h2.7l.4-3.2h-3.1V7.5c0-.9.3-1.5 1.6-1.5h1.7V3.1c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.4-4 4.2v2.4H8v3.2h2.6V21h3.1Z" />
    </svg>
  );
}

function TikTokIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M15.9 3c.4 1.8 1.5 3.2 3.3 3.8v2.9c-1.3 0-2.5-.3-3.6-1v6c0 3.1-2.6 5.6-5.7 5.6S4.2 17.8 4.2 14.7s2.6-5.6 5.7-5.6c.2 0 .4 0 .6.1v3c-.2-.1-.4-.1-.6-.1-1.4 0-2.6 1.1-2.6 2.6 0 1.4 1.1 2.6 2.6 2.6s2.7-1.1 2.7-2.6V3h3.3Z" />
    </svg>
  );
}

function MailIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      {...props}
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

const socialLinks = [
  { label: "Instagram", href: "https://www.instagram.com/twilight.feather/", Icon: InstagramIcon },
  { label: "Facebook", href: "https://www.facebook.com/twilight.feather/", Icon: FacebookIcon },
  { label: "TikTok", href: "https://tiktok.com/@twilightfeather", Icon: TikTokIcon },
  { label: "Email", href: "/contact", Icon: MailIcon },
];

const legalLinks = [
  { label: "Privacy Policy", href: "/privacy-policy" },
  { label: "Terms of Use", href: "/terms-of-use" },
  { label: "Contact Us", href: "/contact" },
];

export function SiteFooter() {
  return (
    <footer className="relative mt-auto bg-section-navy text-white">
      {/* Gentle light wave sweeping into the navy footer */}
      <svg
        aria-hidden="true"
        viewBox="0 0 1440 70"
        preserveAspectRatio="none"
        className="block h-10 w-full fill-cream sm:h-14"
      >
        <path d="M0 0h1440v18c-140 26-290 38-470 30-220-10-380-42-580-34C240 20 110 38 0 30Z" />
      </svg>

      {/* Starry accents */}
      <span aria-hidden="true" className="absolute left-[16%] top-16 text-xs text-white/40">
        ✦
      </span>
      <span
        aria-hidden="true"
        className="absolute right-[10%] top-20 hidden text-sm text-brand-yellow/50 sm:block"
      >
        ✦
      </span>
      <span
        aria-hidden="true"
        className="absolute bottom-6 right-[30%] hidden text-xs text-white/30 sm:block"
      >
        ★
      </span>

      <div className="tf-page-width flex flex-col items-center gap-8 px-5 pb-12 pt-8 sm:px-8 lg:flex-row lg:justify-between lg:gap-8 lg:px-10">
        {/* Feather + thank-you note */}
        <div className="flex items-center gap-3">
          <Image
            src="/feather-accent.png"
            alt=""
            aria-hidden="true"
            width={483}
            height={760}
            className="h-16 w-auto -rotate-12 select-none opacity-90"
          />
          <p
            className="max-w-44 text-sm italic leading-snug text-white/85"
            style={{ fontFamily: '"Segoe Script", "Bradley Hand", cursive' }}
          >
            Thank you for being part of our story.{" "}
            <span aria-hidden="true" className="not-italic text-white/70">♥</span>
          </p>
        </div>

        {/* Social icons */}
        <div className="flex items-center gap-3">
          {socialLinks.map((social) =>
            social.href.startsWith("/") ? (
              <Link
                key={social.label}
                href={social.href}
                aria-label={social.label}
                title={social.label}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/85 transition hover:bg-white/20 hover:text-white"
              >
                <social.Icon className="h-4.5 w-4.5" />
                <span className="sr-only">{social.label}</span>
              </Link>
            ) : (
              <a
                key={social.label}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={social.label}
                title={social.label}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/85 transition hover:bg-white/20 hover:text-white"
              >
                <social.Icon className="h-4.5 w-4.5" />
                <span className="sr-only">{social.label}</span>
              </a>
            ),
          )}
        </div>

        {/* Copyright */}
        <p className="text-sm text-white/75">
          © {new Date().getFullYear()} Twilight Feather. All rights reserved.
        </p>

        {/* Legal links */}
        <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
          {legalLinks.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="text-white/80 underline-offset-4 transition hover:text-white hover:underline"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
