export type MarketingWeekFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * POST helper for WeekClient actions. Returns an error message to show, or null on success.
 * Reloads content after a completed HTTP response (same as legacy act()).
 */
export async function runMarketingWeekPostAction(
  path: string,
  body: unknown,
  fetchFn: MarketingWeekFetch,
  reload: () => Promise<void>,
): Promise<string | null> {
  const response = await fetchFn(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  let data: { error?: string } = {};
  try {
    data = (await response.json()) as { error?: string };
  } catch {
    await reload();
    if (!response.ok) {
      return `Action failed (${response.status}).`;
    }
    return "Invalid server response.";
  }

  await reload();
  if (!response.ok) {
    return data.error ?? "Action failed";
  }
  return null;
}
