/**
 * Stripe may retry the webhook when persistence fails.
 * Push delivery has its own job retry and must not force another Stripe retry.
 */
export function paidOrderWebhookHttpStatus(input: {
  orderPersisted: boolean;
  notificationJobPersisted: boolean;
}): 200 | 500 {
  if (!input.orderPersisted || !input.notificationJobPersisted) return 500;
  return 200;
}
