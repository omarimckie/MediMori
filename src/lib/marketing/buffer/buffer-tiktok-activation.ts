import {
  isBufferTikTokLivePublishingAllowed,
  isMarketingBufferTikTokFeatureEnabled,
} from "./buffer-config";
export const MARKETING_BUFFER_TIKTOK_ACTIVATION_MODE_ENV = "MARKETING_BUFFER_TIKTOK_ACTIVATION_MODE";
export const MARKETING_BUFFER_TIKTOK_CONTROLLED_PUBLICATION_ID_ENV =
  "MARKETING_BUFFER_TIKTOK_CONTROLLED_PUBLICATION_ID";

export type BufferTikTokActivationMode = "disabled" | "controlled" | "automated";

export type BufferTikTokActivationConfig = {
  mode: BufferTikTokActivationMode;
  controlledPublicationId: string | null;
  configValid: boolean;
  configError: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const controlledSubmitTails = new Map<string, Promise<void>>();

function truthyLive(env: Record<string, string | undefined>): boolean {
  const live = env.MARKETING_BUFFER_TIKTOK_LIVE?.trim().toLowerCase();
  return live === "1" || live === "true" || live === "yes";
}

/** True when a code path would perform an outbound Buffer GraphQL mutation (not mock). */
export function isBufferTikTokOutboundLiveAttempt(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.MARKETING_MOCK_MODE !== "false") return false;
  if (!isMarketingBufferTikTokFeatureEnabled(env)) return false;
  return truthyLive(env);
}

export function parseBufferTikTokActivationConfig(
  env: Record<string, string | undefined> = process.env,
): BufferTikTokActivationConfig {
  const rawMode = env[MARKETING_BUFFER_TIKTOK_ACTIVATION_MODE_ENV]?.trim().toLowerCase() ?? "";
  const rawAllowlist = env[MARKETING_BUFFER_TIKTOK_CONTROLLED_PUBLICATION_ID_ENV]?.trim() ?? "";

  if (!rawMode) {
    return {
      mode: "disabled",
      controlledPublicationId: null,
      configValid: true,
      configError: null,
    };
  }

  if (rawMode === "disabled") {
    if (rawAllowlist) {
      return {
        mode: "disabled",
        controlledPublicationId: null,
        configValid: false,
        configError:
          "Controlled publication id must not be set when activation mode is disabled.",
      };
    }
    return {
      mode: "disabled",
      controlledPublicationId: null,
      configValid: true,
      configError: null,
    };
  }

  if (rawMode === "automated") {
    if (rawAllowlist) {
      return {
        mode: "automated",
        controlledPublicationId: null,
        configValid: false,
        configError:
          "MARKETING_BUFFER_TIKTOK_CONTROLLED_PUBLICATION_ID is only valid in controlled mode.",
      };
    }
    return {
      mode: "automated",
      controlledPublicationId: null,
      configValid: true,
      configError: null,
    };
  }

  if (rawMode === "controlled") {
    if (!rawAllowlist) {
      return {
        mode: "controlled",
        controlledPublicationId: null,
        configValid: false,
        configError:
          "Controlled mode requires exactly one MARKETING_BUFFER_TIKTOK_CONTROLLED_PUBLICATION_ID.",
      };
    }
    if (rawAllowlist.includes(",") || rawAllowlist.includes(" ")) {
      return {
        mode: "controlled",
        controlledPublicationId: null,
        configValid: false,
        configError: "Controlled mode allows exactly one publication id (no lists).",
      };
    }
    if (!UUID_PATTERN.test(rawAllowlist)) {
      return {
        mode: "controlled",
        controlledPublicationId: null,
        configValid: false,
        configError: "Controlled publication id must be a single UUID.",
      };
    }
    return {
      mode: "controlled",
      controlledPublicationId: rawAllowlist,
      configValid: true,
      configError: null,
    };
  }

  return {
    mode: "disabled",
    controlledPublicationId: null,
    configValid: false,
    configError: `Unknown ${MARKETING_BUFFER_TIKTOK_ACTIVATION_MODE_ENV}: ${rawMode}`,
  };
}

export type BufferTikTokLiveSubmissionGate =
  | { allow: true }
  | { allow: false; errorCode: string; reason: string };

export function evaluateBufferTikTokLiveSubmissionGate(
  publicationId: string,
  env: Record<string, string | undefined> = process.env,
): BufferTikTokLiveSubmissionGate {
  if (!isBufferTikTokOutboundLiveAttempt(env)) {
    return { allow: true };
  }
  if (!isBufferTikTokLivePublishingAllowed(env)) {
    return {
      allow: false,
      errorCode: "buffer_tiktok_live_blocked",
      reason: "Live Buffer publishing requires MARKETING_BUFFER_TIKTOK_LIVE=true.",
    };
  }

  const config = parseBufferTikTokActivationConfig(env);
  if (!config.configValid) {
    return {
      allow: false,
      errorCode: "buffer_tiktok_activation_config_invalid",
      reason: config.configError ?? "Invalid TikTok activation configuration.",
    };
  }

  if (config.mode === "disabled") {
    return {
      allow: false,
      errorCode: "buffer_tiktok_activation_disabled",
      reason: "TikTok activation mode is disabled.",
    };
  }

  if (config.mode === "controlled") {
    const allowed = config.controlledPublicationId;
    if (!allowed) {
      return {
        allow: false,
        errorCode: "buffer_tiktok_activation_controlled_empty",
        reason: "Controlled mode requires a publication allowlist.",
      };
    }
    if (publicationId !== allowed) {
      return {
        allow: false,
        errorCode: "buffer_tiktok_activation_not_allowlisted",
        reason: "Publication is not authorized for controlled TikTok activation.",
      };
    }
  }

  return { allow: true };
}

export async function withBufferTikTokControlledSubmitLock<T>(
  publicationId: string,
  env: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const config = parseBufferTikTokActivationConfig(env);
  if (config.mode !== "controlled" || config.controlledPublicationId !== publicationId) {
    return fn();
  }

  const previous = controlledSubmitTails.get(publicationId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  controlledSubmitTails.set(publicationId, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (controlledSubmitTails.get(publicationId) === tail) {
      controlledSubmitTails.delete(publicationId);
    }
  }
}

export function resetBufferTikTokControlledSubmitLocksForTests(): void {
  controlledSubmitTails.clear();
}