export type PersonalSocialLink = {
  platform: "instagram";
  handle: string;
  href: string;
};

export function instagramLink(username: string): PersonalSocialLink {
  const handle = username.startsWith("@") ? username : `@${username}`;

  return {
    platform: "instagram",
    handle,
    href: `https://www.instagram.com/${handle.slice(1)}/`,
  };
}
