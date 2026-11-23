import { bufferGraphqlRequest } from "./buffer-graphql-client";

const CHANNELS_QUERY = `
query BufferOrganizationChannels($organizationId: ID!) {
  organization(id: $organizationId) {
    channels {
      id
      name
      service
    }
  }
}
`;

export type BufferChannel = {
  id: string;
  name: string;
  service: string;
};

type ChannelsPayload = {
  organization: { channels: BufferChannel[] } | null;
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
  return data.organization?.channels ?? [];
}

export function pickTikTokChannel(channels: BufferChannel[]): BufferChannel | null {
  return (
    channels.find((row) => row.service?.trim().toLowerCase() === "tiktok") ?? null
  );
}