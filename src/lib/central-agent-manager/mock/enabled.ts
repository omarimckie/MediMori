export function isMockSatelliteHarnessEnabled(): boolean {
  return process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES === "true";
}
