import { InstagramIcon } from "@/components/SocialIcons";
import type { PersonalSocialLink } from "@/data/personal-social";

export function PersonalSocialLinks({
  links,
  align = "center",
  stopLinkPropagation = false,
}: {
  links: PersonalSocialLink[];
  align?: "center" | "start";
  stopLinkPropagation?: boolean;
}) {
  const alignClass = align === "start" ? "items-start" : "items-center";

  if (!links.length) {
    return null;
  }

  return (
    <ul className={`mt-3 flex flex-col gap-2 ${alignClass}`}>
      {links.map((link) => (
        <li key={link.handle}>
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={stopLinkPropagation ? (event) => event.stopPropagation() : undefined}
            className="inline-flex items-center gap-2 text-sm font-semibold text-brand-charcoal/80 transition hover:text-brand-blue-deep"
          >
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-blue/10 text-brand-charcoal/80">
              <InstagramIcon className="h-4 w-4" />
            </span>
            <span>
              <span className="sr-only">Instagram: </span>
              {link.handle}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
