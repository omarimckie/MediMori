/** Discount shown after email signup and valid at website Stripe checkout. */
export function getNewsletterDiscountCode(): string {
  const fromEnv = process.env.NEWSLETTER_DISCOUNT_CODE?.trim();
  return fromEnv || "TWILIGHTFEATHER10";
}
