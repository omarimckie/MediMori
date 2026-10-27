export type IncidentFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type IncidentMutationOutcome = {
  userMessage: string | null;
  success: boolean;
  conflict: boolean;
};

export function createIncidentMutationGate() {
  let inFlight = false;
  return {
    tryEnter(): boolean {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    exit(): void {
      inFlight = false;
    },
    get inFlight() {
      return inFlight;
    },
  };
}

export function validateResolutionSummaryInput(summary: string): string | null {
  if (!summary.trim()) {
    return "Enter a short resolution summary.";
  }
  return null;
}

export async function runIncidentTransitionMutation(input: {
  incidentId: string;
  targetStatus: string;
  incidentVersion: number;
  fetchFn: IncidentFetch;
  reload: () => Promise<void>;
}): Promise<IncidentMutationOutcome> {
  const res = await input.fetchFn(
    `/api/admin/marketing/incidents/${input.incidentId}/transition`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: input.targetStatus,
        incidentVersion: input.incidentVersion,
      }),
    },
  );

  if (res.status === 409) {
    await input.reload();
    return {
      success: false,
      conflict: true,
      userMessage:
        "This incident was updated elsewhere. The page has been refreshed — choose an action again if still needed.",
    };
  }

  const data = (await res.json()) as { error?: string };
  if (!res.ok) {
    return {
      success: false,
      conflict: false,
      userMessage: data.error ?? "Transition failed.",
    };
  }

  await input.reload();
  return { success: true, conflict: false, userMessage: "Status updated." };
}

export async function runIncidentResolveMutation(input: {
  incidentId: string;
  resolutionType: string;
  resolutionSummary: string;
  incidentVersion: number;
  fetchFn: IncidentFetch;
  reload: () => Promise<void>;
}): Promise<IncidentMutationOutcome & { closeResolvePanel: boolean }> {
  const summaryError = validateResolutionSummaryInput(input.resolutionSummary);
  if (summaryError) {
    return {
      success: false,
      conflict: false,
      userMessage: summaryError,
      closeResolvePanel: false,
    };
  }

  const res = await input.fetchFn(
    `/api/admin/marketing/incidents/${input.incidentId}/resolve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resolutionType: input.resolutionType,
        resolutionSummary: input.resolutionSummary.trim(),
        incidentVersion: input.incidentVersion,
      }),
    },
  );

  if (res.status === 409) {
    await input.reload();
    return {
      success: false,
      conflict: true,
      userMessage:
        "This incident was updated elsewhere. The page has been refreshed — resolve again only if still appropriate.",
      closeResolvePanel: true,
    };
  }

  const data = (await res.json()) as { error?: string };
  if (!res.ok) {
    return {
      success: false,
      conflict: false,
      userMessage: data.error ?? "Could not resolve incident.",
      closeResolvePanel: false,
    };
  }

  await input.reload();
  return {
    success: true,
    conflict: false,
    userMessage: "Incident resolved.",
    closeResolvePanel: true,
  };
}
