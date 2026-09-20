type MarketingLogFields = {
  operation: string;
  campaignId?: string | null;
  contentId?: string | null;
  provider?: string;
  success: boolean;
  durationMs?: number;
  estimatedCostUsd?: number;
  error?: string;
};

export function logMarketing(fields: MarketingLogFields) {
  const payload = {
    scope: "marketing_autopilot",
    ...fields,
    at: new Date().toISOString(),
  };
  if (fields.success) {
    console.info("[marketing]", payload);
  } else {
    console.error("[marketing]", payload);
  }
}
