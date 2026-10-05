import webpush from "web-push";

export type WebPushVapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

export function getWebPushVapidConfig(
  env: Record<string, string | undefined> = process.env,
): WebPushVapidConfig | null {
  const publicKey = env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject =
    env.WEB_PUSH_SUBJECT?.trim() || "mailto:hello@twilight-feather.com";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

export function configureWebPushVapid(config: WebPushVapidConfig): void {
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
}

export function getWebPushVapidPublicKey(): string | null {
  return getWebPushVapidConfig()?.publicKey ?? null;
}
