const secretPatterns = [
  /postgres(?:ql)?:\/\/[^\s]+/gi,
  /password\s*=\s*[^\s&]+/gi,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
];

export function toSafeApprovalAdapterMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Trusted approval storage is unavailable.";
  let message = raw;
  for (const pattern of secretPatterns) {
    message = message.replace(pattern, "[redacted]");
  }
  if (message.length > 240) {
    return `${message.slice(0, 237)}...`;
  }
  return message;
}

export function wrapApprovalAdapterError(error: unknown): Error {
  const message = toSafeApprovalAdapterMessage(error);
  return new Error(message);
}
