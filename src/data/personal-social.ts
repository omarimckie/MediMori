export type PersonalSocialPlatform = "instagram" | "threads" | "bluesky";

export type PersonalSocialLink = {
  platform: PersonalSocialPlatform;
  handle: string;
  href: string;
};

export const personalSocialLinks: PersonalSocialLink[] = [
  {
    platform: "instagram",
    handle: "@yourhandle",
    href: "https://www.instagram.com/yourhandle/",
  },
  {
    platform: "threads",
    handle: "@yourhandle",
    href: "https://www.threads.net/@yourhandle",
  },
  {
    platform: "bluesky",
    handle: "@yourhandle.bsky.social",
    href: "https://bsky.app/profile/yourhandle.bsky.social",
  },
];
