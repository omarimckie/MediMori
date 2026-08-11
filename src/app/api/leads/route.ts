import { upsertLead } from "@/lib/leads-store";
import { NextResponse } from "next/server";

const DISCOUNT_CODE = "TWILIGHTFEATHER10";

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

  try {
    const { alreadySignedUp } = await upsertLead(email);

    return NextResponse.json({
      ok: true,
      discountCode: DISCOUNT_CODE,
      message: alreadySignedUp
        ? "You are already signed up. Use your 10% off code below."
        : "Thank you for signing up. Here is your 10% off code.",
    });
  } catch (error) {
    console.error("Failed to save email lead:", error);

    // Still hand the visitor their code if storage is temporarily down.
    return NextResponse.json({
      ok: true,
      discountCode: DISCOUNT_CODE,
      message:
        "Here is your 10% off code. We had trouble saving your email — please message us on social if you want to confirm you're on the list.",
    });
  }
}
