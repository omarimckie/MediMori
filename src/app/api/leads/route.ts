import {
  addContactToNewsletterAudience,
  isConfirmationEmailConfigured,
  sendSignupConfirmationEmail,
} from "@/lib/email";
import { upsertLead } from "@/lib/leads-store";
import { getNewsletterDiscountCode } from "@/lib/newsletter-constants";
import { NextResponse } from "next/server";

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Invalid request body." },
      { status: 400 },
    );
  }

  const email =
    typeof payload === "object" &&
    payload !== null &&
    "email" in payload &&
    typeof (payload as { email: unknown }).email === "string"
      ? (payload as { email: string }).email.trim().toLowerCase()
      : "";

  if (!isValidEmail(email)) {
    return NextResponse.json(
      { ok: false, message: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  const discountCode = getNewsletterDiscountCode();

  try {
    const { alreadySignedUp } = await upsertLead(email);

    await addContactToNewsletterAudience(email).catch((error) => {
      console.error("Failed to add contact to newsletter audience:", error);
    });

    let confirmationEmailSent = false;
    if (isConfirmationEmailConfigured()) {
      try {
        await sendSignupConfirmationEmail(email, { alreadySignedUp });
        confirmationEmailSent = true;
      } catch (error) {
        console.error("Failed to send signup confirmation email:", error);
      }
    } else {
      console.warn(
        "Confirmation email not configured (RESEND_API_KEY / RESEND_FROM_EMAIL).",
      );
    }

    const baseMessage = alreadySignedUp
      ? "You are already signed up. Use your 10% off code below."
      : "Thank you for joining our list. Here is your 10% off code.";

    const emailNote = confirmationEmailSent
      ? " We also sent a confirmation to your inbox."
      : "";

    return NextResponse.json({
      ok: true,
      discountCode,
      confirmationEmailSent,
      message: `${baseMessage}${emailNote}`,
    });
  } catch (error) {
    console.error("Failed to save email lead:", error);

    return NextResponse.json({
      ok: true,
      discountCode,
      message:
        "Here is your 10% off code. We had trouble saving your email — please message us on social if you want to confirm you're on the list.",
    });
  }
}
