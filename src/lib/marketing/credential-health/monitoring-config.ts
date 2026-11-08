import { validatePartialPublicationFailureEnabledAt } from "../publication-incidents/partial-publication-failure-config";

const MONITORING_ENABLED_AT_ENV = "MARKETING_CREDENTIAL_MONITORING_ENABLED_AT";
export const OPENAI_MONITORING_ENABLED_AT_ENV = "OPENAI_CREDENTIAL_MONITORING_ENABLED_AT";
export const INTEGRATION_MONITORING_ENABLED_AT_ENV =
  "MARKETING_INTEGRATION_CREDENTIAL_MONITORING_ENABLED_AT";

let monitoringEnabledAtOverride: string | null | undefined;

export function getCredentialMonitoringEnabledAtIso(
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (monitoringEnabledAtOverride !== undefined) {
    return monitoringEnabledAtOverride;
  }
  const raw = env[MONITORING_ENABLED_AT_ENV]?.trim();
  return raw || null;
}

export function isCredentialMonitoringEnabled(
  env: Record<string, string | undefined> = process.env,
  nowIso = new Date().toISOString(),
): boolean {
  const enabledAt = getCredentialMonitoringEnabledAtIso(env);
  if (!enabledAt) {
    return false;
  }
  const validation = validatePartialPublicationFailureEnabledAt(enabledAt);
  if (!validation.ok) {
    return false;
  }
  const enabledMs = Date.parse(validation.iso);
  const nowMs = Date.parse(nowIso);
  return Number.isFinite(enabledMs) && Number.isFinite(nowMs) && nowMs >= enabledMs;
}

export function setCredentialMonitoringEnabledAtForTests(iso: string | null): void {
  monitoringEnabledAtOverride = iso;
}

export function resetCredentialMonitoringEnabledAtForTests(): void {
  monitoringEnabledAtOverride = undefined;
}

let openAiMonitoringEnabledAtOverride: string | null | undefined;

export function getOpenAiCredentialMonitoringEnabledAtIso(
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (openAiMonitoringEnabledAtOverride !== undefined) {
    return openAiMonitoringEnabledAtOverride;
  }
  const raw = env[OPENAI_MONITORING_ENABLED_AT_ENV]?.trim();
  return raw || null;
}

export function isOpenAiCredentialMonitoringEnabled(
  env: Record<string, string | undefined> = process.env,
  nowIso = new Date().toISOString(),
): boolean {
  const enabledAt = getOpenAiCredentialMonitoringEnabledAtIso(env);
  if (!enabledAt) {
    return false;
  }
  const validation = validatePartialPublicationFailureEnabledAt(enabledAt);
  if (!validation.ok) {
    return false;
  }
  const enabledMs = Date.parse(validation.iso);
  const nowMs = Date.parse(nowIso);
  return Number.isFinite(enabledMs) && Number.isFinite(nowMs) && nowMs >= enabledMs;
}

export function setOpenAiCredentialMonitoringEnabledAtForTests(iso: string | null): void {
  openAiMonitoringEnabledAtOverride = iso;
}

export function resetOpenAiCredentialMonitoringEnabledAtForTests(): void {
  openAiMonitoringEnabledAtOverride = undefined;
}

let integrationMonitoringEnabledAtOverride: string | null | undefined;

export function getIntegrationCredentialMonitoringEnabledAtIso(
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (integrationMonitoringEnabledAtOverride !== undefined) {
    return integrationMonitoringEnabledAtOverride;
  }
  const raw = env[INTEGRATION_MONITORING_ENABLED_AT_ENV]?.trim();
  return raw || null;
}

export function isIntegrationCredentialMonitoringEnabled(
  env: Record<string, string | undefined> = process.env,
  nowIso = new Date().toISOString(),
): boolean {
  const enabledAt = getIntegrationCredentialMonitoringEnabledAtIso(env);
  if (!enabledAt) {
    return false;
  }
  const validation = validatePartialPublicationFailureEnabledAt(enabledAt);
  if (!validation.ok) {
    return false;
  }
  const enabledMs = Date.parse(validation.iso);
  const nowMs = Date.parse(nowIso);
  return Number.isFinite(enabledMs) && Number.isFinite(nowMs) && nowMs >= enabledMs;
}

export function setIntegrationCredentialMonitoringEnabledAtForTests(iso: string | null): void {
  integrationMonitoringEnabledAtOverride = iso;
}

export function resetIntegrationCredentialMonitoringEnabledAtForTests(): void {
  integrationMonitoringEnabledAtOverride = undefined;
}

export const META_APP_ID_ENV = "META_APP_ID";
export const META_APP_SECRET_ENV = "META_APP_SECRET";

export function getMetaAppCredentialsForDebugToken(
  env: Record<string, string | undefined> = process.env,
): { appId: string; appSecret: string } | null {
  const appId = env[META_APP_ID_ENV]?.trim();
  const appSecret = env[META_APP_SECRET_ENV]?.trim();
  if (!appId || !appSecret) {
    return null;
  }
  return { appId, appSecret };
}

/** Optional epoch marker to distinguish fingerprint-key rotation from token replacement. */
export function getCredentialFingerprintKeyEpoch(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.MARKETING_CREDENTIAL_FINGERPRINT_KEY_EPOCH?.trim() || "1";
}
