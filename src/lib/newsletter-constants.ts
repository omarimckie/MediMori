/** Discount shown after email signup; valid on eligible direct Stripe checkout (not Amazon). */
export function getNewsletterDiscountCode(): string {
  const fromEnv = process.env.NEWSLETTER_DISCOUNT_CODE?.trim();
  return fromEnv || "TWILIGHTFEATHER10";
}
