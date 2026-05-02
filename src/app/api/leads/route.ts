import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const LEADS_FILE = path.join(process.cwd(), "private", "leads.json");
const DISCOUNT_CODE = "TWILIGHTFEATHER10";

type Lead = {
  email: string;
  signedUpAt: string;
};

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function readLeads(): Promise<Lead[]> {
  try {
    const raw = await readFile(LEADS_FILE, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Lead[]) : [];
  } catch {
    return [];
  }
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

  const leads = await readLeads();
  const exists = leads.some((lead) => lead.email === email);
  if (!exists) {
    leads.push({ email, signedUpAt: new Date().toISOString() });
    await mkdir(path.dirname(LEADS_FILE), { recursive: true });
    await writeFile(LEADS_FILE, JSON.stringify(leads, null, 2) + "\n", "utf8");
  }

  return NextResponse.json({
    ok: true,
    discountCode: DISCOUNT_CODE,
    message: exists
      ? "You are already signed up. Use your 10% off code below."
      : "Thank you for signing up. Here is your 10% off code.",
  });
}
