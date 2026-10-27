import type { CheckoutSessionSummary } from "@/lib/checkout-session-summary";

export type SuccessViewState = "loading" | "physical" | "ebook" | "error";

export function successViewStateFromSummary(
  summary: CheckoutSessionSummary | null,
  loadFailed: boolean,
): SuccessViewState {
  if (loadFailed || !summary) {
    return "error";
  }
  if (summary.purchaseType === "physical") {
    return "physical";
  }
  return "ebook";
}

export function shouldFetchEbookDownloadIntent(viewState: SuccessViewState): boolean {
  return viewState === "ebook";
}
