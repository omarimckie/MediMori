import { getNewsletterDiscountCode } from "@/lib/newsletter-constants";
import { Resend } from "resend";

export type NewsletterContactResult = {
  ok: boolean;
  contactCreated: boolean;
  segmentAttached: boolean;
  message?: string;
};

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

function getNewsletterSegmentId(): string | null {
  return (
    process.env.RESEND_NEWSLETTER_ID?.trim() ||
    process.env.RESEND_SEGMENT_ID?.trim() ||
    process.env.RESEND_AUDIENCE_ID?.trim() ||
    null
  );
}

/**
 * Adds the signup as a Resend Contact and attaches it to the newsletter segment.
 * Requires a Resend API key with Full Access (not sending-only).
 */
export async function addContactToNewsletterAudience(
  email: string,
): Promise<NewsletterContactResult> {
  const resend = getResendClient();
  if (!resend) {
    return {
      ok: false,
      contactCreated: false,
      segmentAttached: false,
      message: "RESEND_API_KEY is not set.",
    };
  }

  const segmentId = getNewsletterSegmentId();
  const topicId = process.env.RESEND_TOPIC_ID?.trim();

  if (!segmentId) {
    console.warn(
      "RESEND_NEWSLETTER_ID is not set — contact will be created without a newsletter segment.",
    );
  }

  const { error } = await resend.contacts.create({
    email,
    unsubscribed: false,
    ...(segmentId ? { segments: [{ id: segmentId }] } : {}),
    ...(topicId
      ? { topics: [{ id: topicId, subscription: "opt_in" as const }] }
      : {}),
  });

  const alreadyExists =
    Boolean(error) && /already|exists|conflict/i.test(error?.message ?? "");

  if (error && !alreadyExists) {
    const message = error.message || "Could not add contact to Resend.";
    console.error("Resend contacts.create failed:", {
      message,
      name: error.name,
      statusCode: "statusCode" in error ? error.statusCode : undefined,
    });
    return {
      ok: false,
      contactCreated: false,
      segmentAttached: false,
      message:
        /forbidden|permission|unauthorized|access/i.test(message)
          ? "Resend API key cannot manage Contacts. Create a Full Access API key in Resend and set RESEND_API_KEY in Vercel."
          : message,
    };
  }

  let segmentAttached = false;

  if (segmentId) {
    const { error: segmentError } = await resend.contacts.segments.add({
      email,
      segmentId,
    });

    if (
      segmentError &&
      !/already|exists|conflict/i.test(segmentError.message ?? "")
    ) {
      console.error("Resend contacts.segments.add failed:", segmentError);
      return {
        ok: false,
        contactCreated: !error || alreadyExists,
        segmentAttached: false,
        message:
          segmentError.message ||
          "Could not add contact to newsletter segment.",
      };
    }

    segmentAttached = true;
  }

  return {
    ok: true,
    contactCreated: !alreadyExists,
    segmentAttached,
  };
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
  const booksUrl = `${siteUrl}/books`;

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

export async function sendLibraryAccessEmail(
  email: string,
  accessUrl: string,
): Promise<void> {
  const resend = getResendClient();
  const from = getFromAddress();
  if (!resend || !from) {
    throw new Error("Access email is not configured (missing Resend).");
  }

  const { error } = await resend.emails.send({
    from,
    to: email,
    subject: "Your Twilight Feather books access link",
    html: `
      <div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; max-width: 560px; margin: 0 auto; color: #1a2b4b; line-height: 1.5;">
        <h1 style="font-size: 22px; margin-bottom: 12px;">Twilight Feather</h1>
        <p>Use this private link to open the books you purchased. It expires in 45 minutes and can be used once.</p>
        <p>
          <a href="${accessUrl}" style="display: inline-block; background: #f5b93f; color: #1a2b4b; text-decoration: none; font-weight: 700; padding: 12px 18px; border-radius: 12px;">
            Open my books
          </a>
        </p>
        <p style="color: #5a6478; font-size: 13px; margin-top: 32px;">
          If you did not request this, you can ignore this email. We never put your email address in the link.
        </p>
      </div>
    `,
    text: [
      "Twilight Feather",
      "",
      "Use this private link to open the books you purchased.",
      "It expires in 45 minutes and can be used once.",
      "",
      accessUrl,
      "",
      "If you did not request this, you can ignore this email.",
    ].join("\n"),
  });

  if (error) {
    throw new Error(error.message || "Could not send access email.");
  }
}
