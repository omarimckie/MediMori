import { BufferGraphqlError, bufferGraphqlRequest } from "./buffer-graphql-client";
import type { TikTokMediaKind } from "../buffer-tiktok-media";

export type BufferCreatePostMode = "shareNow" | "customScheduled";

export type BufferCreateTikTokPostInput = {
  channelId: string;
  text: string;
  schedulingType: "automatic";
  mode: BufferCreatePostMode;
  dueAt?: string;
  media: { kind: TikTokMediaKind; publicUrl: string };
  photoTitle?: string | null;
};

export type BufferCreatePostSuccess = {
  postId: string;
  dueAt: string | null;
  status: string | null;
};

const CREATE_POST_MUTATION = `
mutation BufferCreateTikTokPost($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess {
      post {
        id
        dueAt
        status
      }
    }
    ... on MutationError {
      message
    }
  }
}
`;

const POST_BY_ID_QUERY = `
query BufferPostById($id: ID!) {
  post(id: $id) {
    id
    status
    dueAt
    channelId
  }
}
`;

function buildAssets(media: { kind: TikTokMediaKind; publicUrl: string }) {
  if (media.kind === "video") {
    return [{ video: { url: media.publicUrl } }];
  }
  return [{ image: { url: media.publicUrl } }];
}

export function buildBufferCreatePostVariables(input: BufferCreateTikTokPostInput) {
  const metadata =
    input.media.kind === "image" && input.photoTitle?.trim()
      ? { tiktok: { title: input.photoTitle.trim() } }
      : undefined;

  return {
    input: {
      text: input.text,
      channelId: input.channelId,
      schedulingType: input.schedulingType,
      mode: input.mode,
      ...(input.mode === "customScheduled" && input.dueAt ? { dueAt: input.dueAt } : {}),
      assets: buildAssets(input.media),
      ...(metadata ? { metadata } : {}),
    },
  };
}

type CreatePostPayload = {
  createPost:
    | { __typename: "PostActionSuccess"; post: { id: string; dueAt: string | null; status: string | null } }
    | { __typename: "MutationError"; message: string };
};

export async function bufferCreateTikTokPost(
  input: BufferCreateTikTokPostInput,
  options?: Parameters<typeof bufferGraphqlRequest>[2],
): Promise<BufferCreatePostSuccess> {
  const data = await bufferGraphqlRequest<CreatePostPayload>(
    CREATE_POST_MUTATION,
    buildBufferCreatePostVariables(input),
    options,
  );
  const payload = data.createPost;
  if (payload.__typename === "MutationError") {
    throw new BufferGraphqlError(payload.message, { retryable: false });
  }
  return {
    postId: payload.post.id,
    dueAt: payload.post.dueAt,
    status: payload.post.status,
  };
}

type PostByIdPayload = {
  post: { id: string; status: string; dueAt: string | null; channelId: string } | null;
};

export async function bufferFetchPostById(
  postId: string,
  options?: Parameters<typeof bufferGraphqlRequest>[2],
): Promise<PostByIdPayload["post"]> {
  const data = await bufferGraphqlRequest<PostByIdPayload>(
    POST_BY_ID_QUERY,
    { id: postId },
    options,
  );
  return data.post;
}

export function mapBufferPostStatusToPublication(
  bufferStatus: string,
): "scheduled" | "published" | "failed" | "processing" {
  const normalized = bufferStatus.trim().toLowerCase();
  if (normalized === "sent" || normalized === "published") return "published";
  if (normalized === "error" || normalized === "failed") return "failed";
  if (normalized === "scheduled") return "scheduled";
  return "processing";
}