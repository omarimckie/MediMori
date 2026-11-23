import { bufferGraphqlRequest } from "./buffer-graphql-client";

/**
 * Matches Buffer GraphQL schema: `OrganizationId` input on `channels(input:)`.
 * @see https://developers.buffer.com/guides/data-model.html
 */
const CHANNELS_QUERY = `
query BufferOrganizationChannels($organizationId: OrganizationId!) {
  channels(input: { organizationId: $organizationId }) {
    id
    name
    service
    isDisconnected
    isLocked
  }
}
`;

export type BufferChannel = {
  id: string;
  name: string;
  service: string;
  isDisconnected?: boolean;
  isLocked?: boolean;
};

type ChannelsPayload = {
  channels: BufferChannel[];
};

export async function bufferListOrganizationChannels(
  organizationId: string,
  options?: Parameters<typeof bufferGraphqlRequest>[2],
): Promise<BufferChannel[]> {
  const data = await bufferGraphqlRequest<ChannelsPayload>(
    CHANNELS_QUERY,
    { organizationId },
    options,
  );
  return data.channels ?? [];
}

export function isTikTokService(service: string | null | undefined): boolean {
  return service?.trim().toLowerCase() === "tiktok";
}

export function isTikTokChannelUsable(channel: BufferChannel): boolean {
  if (!isTikTokService(channel.service)) return false;
  if (channel.isDisconnected === true) return false;
  if (channel.isLocked === true) return false;
  return true;
}

export function listTikTokChannels(channels: BufferChannel[]): BufferChannel[] {
  return channels.filter((row) => isTikTokService(row.service));
}

/**
 * Picks the first connected, unlocked TikTok channel, or a preferred id when usable.
 */
export function pickTikTokChannel(
  channels: BufferChannel[],
  preferredChannelId?: string | null,
): BufferChannel | null {
  const tiktok = listTikTokChannels(channels);
  const preferred = preferredChannelId?.trim();
  if (preferred) {
    const match = tiktok.find((row) => row.id === preferred && isTikTokChannelUsable(row));
    if (match) return match;
  }
  return tiktok.find((row) => isTikTokChannelUsable(row)) ?? null;
}