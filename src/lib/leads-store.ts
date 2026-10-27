import { get, list, put } from "@vercel/blob";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type Lead = {
  email: string;
  signedUpAt: string;
};

const BLOB_PATHNAME = "leads/leads.json";
const LOCAL_STORE_PATH = path.join(process.cwd(), "private", "leads.json");

function hasBlobToken(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

async function readLocalLeads(): Promise<Lead[]> {
  try {
    const raw = await readFile(LOCAL_STORE_PATH, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Lead[]) : [];
  } catch {
    return [];
  }
}

async function writeLocalLeads(leads: Lead[]): Promise<void> {
  await mkdir(path.dirname(LOCAL_STORE_PATH), { recursive: true });
  await writeFile(LOCAL_STORE_PATH, `${JSON.stringify(leads, null, 2)}\n`, "utf8");
}

async function parseLeadsJson(raw: string): Promise<Lead[]> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Lead[]) : [];
  } catch {
    return [];
  }
}

async function readBlobLeads(): Promise<Lead[]> {
  // Prefer private store (emails must not be public).
  try {
    const privateBlob = await get(BLOB_PATHNAME, { access: "private" });
    if (privateBlob?.statusCode === 200 && privateBlob.stream) {
      const raw = await new Response(privateBlob.stream).text();
      return parseLeadsJson(raw);
    }
  } catch {
    // Fall through to list-based lookup for older public blobs.
  }

  const { blobs } = await list({ prefix: "leads/", limit: 20 });
  const storeBlob = blobs.find((blob) => blob.pathname === BLOB_PATHNAME);
  if (!storeBlob) return [];

  const access = storeBlob.url.includes(".private.blob.") ? "private" : "public";
  if (access === "private") {
    const blobResult = await get(storeBlob.url, { access: "private" });
    if (!blobResult?.stream) return [];
    const raw = await new Response(blobResult.stream).text();
    return parseLeadsJson(raw);
  }

  const response = await fetch(storeBlob.url, { cache: "no-store" });
  if (!response.ok) return [];
  return parseLeadsJson(await response.text());
}

async function writeBlobLeads(leads: Lead[]): Promise<void> {
  await put(BLOB_PATHNAME, JSON.stringify(leads, null, 2), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export async function readStoredLeads(): Promise<Lead[]> {
  if (hasBlobToken()) {
    try {
      return await readBlobLeads();
    } catch {
      return readLocalLeads();
    }
  }

  return readLocalLeads();
}

export async function writeStoredLeads(leads: Lead[]): Promise<void> {
  if (hasBlobToken()) {
    try {
      await writeBlobLeads(leads);
      return;
    } catch {
      await writeLocalLeads(leads);
      return;
    }
  }

  await writeLocalLeads(leads);
}

/** Adds a lead if new. Returns whether the email was already on the list. */
export async function upsertLead(email: string): Promise<{ alreadySignedUp: boolean }> {
  const leads = await readStoredLeads();
  const alreadySignedUp = leads.some((lead) => lead.email === email);

  if (!alreadySignedUp) {
    await writeStoredLeads([
      ...leads,
      { email, signedUpAt: new Date().toISOString() },
    ]);
  }

  return { alreadySignedUp };
}

export function leadsToCsv(leads: Lead[]): string {
  const header = "email,signed_up_at";
  const rows = [...leads]
    .sort((a, b) => Date.parse(b.signedUpAt) - Date.parse(a.signedUpAt))
    .map((lead) => {
      const email = `"${lead.email.replace(/"/g, '""')}"`;
      return `${email},${lead.signedUpAt}`;
    });
  return `${header}\n${rows.join("\n")}\n`;
}
