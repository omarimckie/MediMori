type EnvLike = Record<string, string | undefined>;

export type QstashSigningKeyConfig = {
  currentSigningKey: string;
  nextSigningKey: string;
  webhookUrl: string;
};

function readTrimmed(env: EnvLike, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

export function resolveQstashWebhookUrl(env: EnvLike = process.env): string | null {
  return readTrimmed(env, "QSTASH_WEBHOOK_URL");
}

export function resolveQstashSigningKeys(
  env: EnvLike = process.env,
): QstashSigningKeyConfig | null {
  const currentSigningKey = readTrimmed(env, "QSTASH_CURRENT_SIGNING_KEY");
  const nextSigningKey = readTrimmed(env, "QSTASH_NEXT_SIGNING_KEY");
  const webhookUrl = resolveQstashWebhookUrl(env);
  if (!currentSigningKey || !nextSigningKey || !webhookUrl) {
    return null;
  }
  return { currentSigningKey, nextSigningKey, webhookUrl };
}
