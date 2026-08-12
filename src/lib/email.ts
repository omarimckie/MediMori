import { getNewsletterDiscountCode } from "@/lib/newsletter-constants";
import { Resend } from "resend";

function getResendClient(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim();
  return key ? new Resend(key) : null;
}

function getFromAddress(): string | null {
  return process.env.RESEND_FROM_EMAIL?.trim() || null;
}

export function isConfirmationEmailConfigured(): boolean {
  return Boolean(getResendClient() && getFromAddress());
}

/** Adds the signup as a Resend Contact (and optional Segment/Topic). */
export async function addContactToNewsletterAudience(
  email: string,
): Promise<void> {
  const resend = getResendClient();
  if (!resend) return;

  // Prefer the newsletter-specific segment ID the user set in Vercel.
  const segmentId =
    process.env.RESEND_NEWSLETTER_ID?.trim() ||
    process.env.RESEND_SEGMENT_ID?.trim();
  // Keep supporting the old env name if someone already set it.
  const legacyAudienceId = process.env.RESEND_AUDIENCE_ID?.trim();
  const topicId = process.env.RESEND_TOPIC_ID?.trim();

  const { error } = await resend.contacts.create({
    email,
    unsubscribed: false,
    ...(segmentId
      ? { segments: [{ id: segmentId }] }
      : legacyAudienceId
        ? { audienceId: legacyAudienceId }
        : {}),
    ...(topicId
      ? { topics: [{ id: topicId, subscription: "opt_in" as const }] }
      : {}),
  });

  // Already on the list is fine.
  if (error && !/already|exists|conflict/i.test(error.message ?? "")) {
    throw new Error(error.message || "Could not add contact to Resend.");
  }
}

export async function sendSignupConfirmationEmail(
  email: string,
  options: { alreadySignedUp: boolean },
): Promise<void> {
  const resend = getResendClient();
  const from = getFromAddress();
  if (!resend || !from) {
    console.warn(
      "Signup confirmation email skipped: set RESEND_API_KEY and RESEND_FROM_EMAIL.",
    );
    return;
  }

  const code = getNewsletterDiscountCode();
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "https://twilight-feather.com";
  const booksUrl = `${siteUrl}/#books`;

  const subject = options.alreadySignedUp
    ? "You're already on the Twilight Feather list"
    : "Welcome to the Twilight Feather list — your 10% off code";

  const intro = options.alreadySignedUp
    ? "You're already on our list — thanks for signing up again. Here's your code in case you need it:"
    : "Thanks for joining the Twilight Feather family! You're on our news and updates list.";

  const { error } = await resend.emails.send({
    from,
    to: email,
    subject,
    html: `
      <div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; max-width: 560px; margin: 0 auto; color: #1a2b4b; line-height: 1.5;">
        <h1 style="font-size: 22px; margin-bottom: 12px;">Twilight Feather</h1>
        <p>${intro}</p>
        <p style="margin: 24px 0; padding: 16px 20px; background: #fdf6e3; border-radius: 12px; font-size: 18px;">
          <strong>Your 10% off code:</strong>
          <span style="letter-spacing: 0.04em;">${code}</span>
        </p>
        <p>
          Use this code at checkout when you buy an eBook on our website
          (enter it in the promotion code field on the payment page).
        </p>
        <p>
          <a href="${booksUrl}" style="display: inline-block; background: #f5b93f; color: #1a2b4b; text-decoration: none; font-weight: 700; padding: 12px 18px; border-radius: 12px;">
            Shop our books
          </a>
        </p>
        <p style="color: #5a6478; font-size: 13px; margin-top: 32px;">
          You'll occasionally hear from us about new stories, resources, and exclusive offers.
          If this wasn't you, you can ignore this email.
        </p>
      </div>
    `,
    text: [
      "Twilight Feather",
      "",
      intro,
      "",
      `Your 10% off code: ${code}`,
      "",
      "Use this code at checkout when you buy an eBook on our website.",
      `Shop: ${booksUrl}`,
    ].join("\n"),
  });

  if (error) {
    throw new Error(error.message || "Could not send confirmation email.");
  }
}
