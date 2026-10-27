/** Label for the operational empty-week control on Your Week. */
export const NEW_WEEK_BUTTON_LABEL = "New Week";

/** Week selector is shown only when multiple plans exist. */
export function shouldRenderWeekPlanSelector(planCount: number): boolean {
  return planCount > 1;
}

/** New Week must always be available for marketing admins on Your Week. */
export function shouldRenderNewWeekControl(planCount: number): boolean {
  void planCount;
  return true;
}
