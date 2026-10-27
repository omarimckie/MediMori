export function marketingAuthError(authenticated: boolean) {
  if (authenticated) return null;
  return { error: "Unauthorized." as const, status: 401 as const };
}
