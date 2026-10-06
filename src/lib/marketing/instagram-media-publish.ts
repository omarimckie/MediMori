import {
  buildMetaGraphUrl,
  defaultMetaSleep,
  INSTAGRAM_CONTAINER_POLL_INITIAL_DELAY_MS,
  INSTAGRAM_CONTAINER_POLL_BACKOFF_FACTOR,
  INSTAGRAM_CONTAINER_POLL_MAX_DELAY_MS,
  postMetaForm,
  type MetaGraphResult,
} from "./meta";

/**
 * Publish attempts when status polling has already returned FINISHED.
 * Initial media_publish plus retries only for meta_media_not_ready (same container).
 *
 * INSTAGRAM_MEDIA_PUBLISH_NOT_READY_MAX_ATTEMPTS (4) is an engineering-bounded
 * retry policy — not a Meta SLA or externally validated readiness guarantee.
 * Inter-attempt delays reuse container-poll backoff constants (400ms base, ×2,
 * 8s cap) for internal consistency; three retries after the first failure add at
 * most ~2.8s sleep on top of the existing ≤40s readiness poll budget.
 *
 * On exhaustion the publication fails with provider_creation_id retained; owner
 * recovery is required rather than creating another container in this path.
 */
export const INSTAGRAM_MEDIA_PUBLISH_NOT_READY_MAX_ATTEMPTS = 4;

export type PublishInstagramMediaInput = {
  userId: string;
  graphVersion: string;
  accessToken: string;
  containerId: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  secrets?: Array<string | null | undefined>;
};

function notReadyDelayMs(retryIndex: number): number {
  return Math.min(
    INSTAGRAM_CONTAINER_POLL_INITIAL_DELAY_MS *
      INSTAGRAM_CONTAINER_POLL_BACKOFF_FACTOR ** retryIndex,
    INSTAGRAM_CONTAINER_POLL_MAX_DELAY_MS,
  );
}

export async function publishInstagramMediaAfterContainerReady(
  input: PublishInstagramMediaInput,
): Promise<MetaGraphResult<{ id?: string }>> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const sleep = input.sleep ?? defaultMetaSleep;
  const secrets = input.secrets ?? [input.accessToken];
  const publishUrl = buildMetaGraphUrl(
    "https://graph.instagram.com",
    input.graphVersion,
    `/${input.userId}/media_publish`,
  );

  let lastResult: MetaGraphResult<{ id?: string }> | null = null;
  for (let attempt = 0; attempt < INSTAGRAM_MEDIA_PUBLISH_NOT_READY_MAX_ATTEMPTS; attempt += 1) {
    const published = await postMetaForm<{ id?: string }>(
      publishUrl,
      {
        creation_id: input.containerId,
        access_token: input.accessToken,
      },
      secrets,
      fetchImpl,
    );
    if (published.ok) {
      return published;
    }
    lastResult = published;
    if (published.errorCode !== "meta_media_not_ready") {
      return published;
    }
    const isLastAttempt = attempt >= INSTAGRAM_MEDIA_PUBLISH_NOT_READY_MAX_ATTEMPTS - 1;
    if (isLastAttempt) {
      return published;
    }
    await sleep(notReadyDelayMs(attempt));
  }

  return (
    lastResult ?? {
      ok: false,
      error: "meta_malformed_response: Instagram media_publish did not run.",
      errorCode: "meta_malformed_response",
      retryable: false,
    }
  );
}
