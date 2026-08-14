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

function PinterestIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 3.2c-4.8 0-8.3 3.4-8.3 7.9 0 3.1 1.7 5.7 4.5 6.7.1-.5.3-1.4.5-2.1.1-.2 0-.4-.1-.6-.4-.8-.7-1.9-.7-3.1 0-3 2.2-5.2 5.2-5.2 2.8 0 4.3 1.7 4.3 3.7 0 2.2-1 5.2-1.5 8.1-.4 2.4 1.2 4.2 3.4 4.2 4 0 6.9-3.2 6.9-7.7 0-5.2-4.2-8.9-9.9-8.9Zm0 6.1c-1.6 0-2.9 1.1-2.9 2.8 0 1.1.4 2 .8 2.5.1.2.2.4.1.6-.1.7-.3 1.7-.4 1.9-.1.3-.3.3-.6.2-1.7-.7-2.5-2.5-2.5-4.4 0-3.1 2.3-5.9 6.7-5.9 3.5 0 5.7 2.5 5.7 5.2 0 3.5-1.6 6.1-3.8 6.1-1.2 0-2-1-1.7-2.1.3-1.3.9-2.8.9-3.8 0-.9-.5-1.6-1.5-1.6Z" />
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

function XIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M18.9 2.5h2.8l-6.2 7 7.3 12h-5.7l-4.5-7.4-6.5 7.4H3.3l6.6-7.6L2.9 2.5h5.8L12.7 9l6.2-6.5Zm-1 17.2h1.6L7.8 4.2H6.1l11.8 15.5Z" />
    </svg>
  );
}

const socialLinks = [
  { label: "Instagram", href: "https://www.instagram.com/twilight.feather/", Icon: InstagramIcon },
  { label: "Facebook", href: "https://www.facebook.com/twilight.feather/", Icon: FacebookIcon },
  { label: "Pinterest", href: "https://www.pinterest.com/twilight.feather/", Icon: PinterestIcon },
  { label: "TikTok", href: "https://tiktok.com/@twilightfeather", Icon: TikTokIcon },
  { label: "X", href: "https://x.com/twilightfeather", Icon: XIcon },
];

const navigationLinks = [
  { label: "Home", href: "/" },
  { label: "Books", href: "/books" },
  { label: "Resources", href: "/resources" },
  { label: "About Us", href: "/authors" },
];

export function SiteHeader() {
  return (
    <header className="border-b border-brand-brown/15 bg-cream/95 backdrop-blur-md">
      <div className="px-4 py-3 sm:px-8 sm:py-5 lg:px-10">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
        <Link href="/" className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <Image
            src="/logo.png"
            alt="Twilight.Feather"
            width={56}
            height={56}
            className="h-11 w-11 shrink-0 rounded-full border-2 border-brand-orange/40 object-cover shadow-sm sm:h-14 sm:w-14"
            priority
          />
          <div className="min-w-0 leading-tight">
            <span className="block text-lg font-extrabold tracking-tight sm:text-xl">
              <span className="text-brand-blue-deep">Twilight</span>
              <span className="text-brand-green-deep">.Feather</span>
            </span>
            <span className="mt-0.5 hidden text-xs font-medium text-brand-charcoal/70 sm:block">
              Empowering Little Minds, Nurturing Wellness
            </span>
          </div>
        </Link>

        <div className="flex min-w-0 flex-col gap-2 sm:items-end">
          <div className="hidden flex-wrap items-center justify-end gap-1.5 sm:flex">
            {socialLinks.map((social) => (
              <a
                key={social.label}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={social.label}
                title={social.label}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-blue/10 text-brand-charcoal/80 transition hover:bg-brand-green/15 hover:text-brand-charcoal"
              >
                <social.Icon className="h-4 w-4" />
                <span className="sr-only">{social.label}</span>
              </a>
            ))}
          </div>

          <nav
            aria-label="Primary navigation"
            className="flex flex-wrap items-center gap-1 text-xs font-semibold sm:justify-end sm:text-sm"
          >
            {navigationLinks.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="rounded-full px-2.5 py-2 text-brand-charcoal transition hover:bg-brand-blue/15 sm:px-3"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        </div>
      </div>
    </header>
  );
}
