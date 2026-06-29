import {
  BlueskyIcon,
  InstagramIcon,
  ThreadsIcon,
} from "@/components/SocialIcons";
import { personalSocialLinks, type PersonalSocialPlatform } from "@/data/personal-social";
import type { SVGProps, ComponentType } from "react";

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

export function PersonalSocialLinks() {
  return (
    <div className="mt-8">
      <h3 className="text-lg font-extrabold text-brand-blue-deep">
        Follow us personally
      </h3>
      <ul className="mt-4 flex flex-wrap justify-center gap-3 sm:justify-start">
        {personalSocialLinks.map((link) => {
          const Icon = platformIcons[link.platform];

          return (
            <li key={link.platform}>
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-brand-brown/20 bg-white px-4 py-2 text-sm font-semibold text-brand-charcoal/85 shadow-sm transition hover:border-brand-blue/30 hover:bg-brand-blue/5 hover:text-brand-blue-deep"
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-blue/10 text-brand-charcoal/80">
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
    </div>
  );
}
