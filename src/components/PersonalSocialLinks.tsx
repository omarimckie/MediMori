import {
  BlueskyIcon,
  InstagramIcon,
  ThreadsIcon,
} from "@/components/SocialIcons";
import { personalSocialLinks, type PersonalSocialPlatform } from "@/data/personal-social";
import type { ComponentType, SVGProps } from "react";

const platformIcons: Record<
  PersonalSocialPlatform,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  instagram: InstagramIcon,
  threads: ThreadsIcon,
  bluesky: BlueskyIcon,
};

const platformLabels: Record<PersonalSocialPlatform, string> = {
  instagram: "Instagram",
  threads: "Threads",
  bluesky: "Bluesky",
};

export function PersonalSocialLinks({
  align = "center",
  stopLinkPropagation = false,
}: {
  align?: "center" | "start";
  stopLinkPropagation?: boolean;
}) {
  const alignClass = align === "start" ? "items-start" : "items-center";

  return (
    <ul className={`mt-3 flex flex-col gap-2 ${alignClass}`}>
      {personalSocialLinks.map((link) => {
        const Icon = platformIcons[link.platform];

        return (
          <li key={link.platform}>
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={stopLinkPropagation ? (event) => event.stopPropagation() : undefined}
              className="inline-flex items-center gap-2 text-sm font-semibold text-brand-charcoal/80 transition hover:text-brand-blue-deep"
            >
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-blue/10 text-brand-charcoal/80">
                <Icon className="h-4 w-4" />
              </span>
              <span>
                <span className="sr-only">{platformLabels[link.platform]}: </span>
                {link.handle}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
