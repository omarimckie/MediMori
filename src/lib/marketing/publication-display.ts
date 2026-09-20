export function isMockPublicationProvider(provider: string): boolean {
  return provider.startsWith("mock") || provider.includes("mock_");
}

export function formatPublicationStatusLabel(publication: {
  status: string;
  provider: string;
}): string {
  if (publication.status === "published" && isMockPublicationProvider(publication.provider)) {
    return "mock published";
  }
  return publication.status.replaceAll("_", " ");
}

export function publishDueButtonLabel(mockMode: boolean): string {
  if (mockMode) {
    return "Publish due items (mock — no live networks)";
  }
  return "Publish due items (live Meta where configured)";
}
