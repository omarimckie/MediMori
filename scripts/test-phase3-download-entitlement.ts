import { readFileSync } from "node:fs";
import { isReaderBookId } from "../src/lib/reader-catalog";
import { getEbookBlobPathname } from "../src/lib/ebook-blob";
import { customerEmailFromSession } from "../src/lib/checkout-ownership";
import type Stripe from "stripe";

function loadEnvLocal() {
  try {
    const env = readFileSync(".env.local", "utf8");
    for (const line of env.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq);
      const value = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // optional
  }
}

loadEnvLocal();

type Check = { name: string; pass: boolean; detail?: string };
const checks: Check[] = [];

function assert(name: string, pass: boolean, detail?: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function isPrivateBlobUrl(url: string) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.includes("blob.vercel-storage.com") &&
      parsed.search.length > 8
    );
  } catch {
    return false;
  }
}

async function run() {
  const downloadSource = readFileSync("src/app/api/download/route.ts", "utf8");

  assert(
    "K. Query bookId is not used to select a PDF",
    downloadSource.includes('searchParams.get("session_id")') &&
      !downloadSource.includes('searchParams.get("bookId")') &&
      downloadSource.includes("session.metadata?.bookId"),
  );
  assert(
    "L. Query filename is not used to select a PDF",
    !downloadSource.includes('searchParams.get("filename")') &&
      downloadSource.includes("getEbookBlobPathname(book.id)"),
  );
  assert(
    "H. Sickle Cell stays reader-only before any Blob signing",
    downloadSource.indexOf("isReaderBookId(book.id)") <
      downloadSource.indexOf('book.id === "book-two"') &&
      isReaderBookId("book-one"),
  );
  assert(
    "I. Asthma stays reader-only before any Blob signing",
    isReaderBookId("book-three") &&
      getEbookBlobPathname("book-one") === "Sickle Cell.pdf" &&
      getEbookBlobPathname("book-two") === "Word Search.pdf",
  );

  const queryEmail = customerEmailFromSession({
    customer_email: "Owner@Example.com",
    metadata: { bookId: "book-two", customerEmail: "ignored-if-customer-email-set" },
  } as Stripe.Checkout.Session);
  assert(
    "Email comes from Stripe session, not query string",
    queryEmail === "owner@example.com" &&
      !downloadSource.includes('searchParams.get("email")'),
  );

  if (!process.env.DATABASE_URL?.trim()) {
    console.log("SKIP  database download-entitlement tests");
    return;
  }

  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL.trim());
  const { recordPurchaseAndEntitlement, hasEntitlement } = await import(
    "../src/lib/purchases"
  );
  const { recordStripeRefundAndRecompute } = await import(
    "../src/lib/purchase-refunds"
  );
  const { createPrivateEbookDownloadUrl } = await import("../src/lib/ebook-blob");

  const stamp = Date.now();
  const email = `refund.phase3.${stamp}@example.com`;
  const emails = [email];

  async function cleanup() {
    await sql`DELETE FROM entitlements WHERE email = ${email}`;
    await sql`
      DELETE FROM purchase_refunds
      WHERE purchase_id IN (SELECT id FROM purchases WHERE email = ${email})
    `;
    await sql`DELETE FROM purchases WHERE email = ${email}`;
  }

  await cleanup();

  try {
    const first = await recordPurchaseAndEntitlement({
      email,
      bookId: "book-two",
      stripeCheckoutSessionId: `cs_test_p3_a_${stamp}`,
      stripePaymentIntentId: `pi_test_p3_a_${stamp}`,
      amountCents: 700,
      currency: "usd",
      stripeChargeId: `ch_test_p3_a_${stamp}`,
    });
    const entitled = await hasEntitlement(email, "book-two");
    assert("A/E. Paid Word Search + entitlement exists", entitled);

    if (entitled && process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
      const pathname = getEbookBlobPathname("book-two");
      const url = pathname ? await createPrivateEbookDownloadUrl(pathname) : "";
      const pdf = url
        ? await fetch(url, { headers: { Range: "bytes=0-4" } })
        : null;
      const buf = pdf ? Buffer.from(await pdf.arrayBuffer()) : Buffer.alloc(0);
      assert(
        "A. Entitled Word Search can mint a private Blob URL that is a PDF",
        Boolean(url) &&
          isPrivateBlobUrl(url) &&
          pathname === "Word Search.pdf" &&
          buf.subarray(0, 4).toString("utf8") === "%PDF",
      );
    } else {
      assert(
        "A. Entitled Word Search can mint a private Blob URL that is a PDF",
        false,
        "BLOB_READ_WRITE_TOKEN missing",
      );
    }

    assert(
      "B. No entitlement → download must not sign a Blob URL",
      !(await hasEntitlement(`nobody.phase3.${stamp}@example.com`, "book-two")),
    );

    await recordStripeRefundAndRecompute({
      stripeRefundId: `re_p3_partial_${stamp}`,
      amountCents: 200,
      currency: "usd",
      status: "succeeded",
      stripeChargeId: `ch_test_p3_a_${stamp}`,
      stripePaymentIntentId: `pi_test_p3_a_${stamp}`,
      reason: null,
      processedAt: new Date(),
    });
    assert(
      "D. Partial refund → entitlement remains (download still allowed)",
      await hasEntitlement(email, "book-two"),
    );

    const second = await recordPurchaseAndEntitlement({
      email,
      bookId: "book-two",
      stripeCheckoutSessionId: `cs_test_p3_b_${stamp}`,
      stripePaymentIntentId: `pi_test_p3_b_${stamp}`,
      amountCents: 700,
      currency: "usd",
      stripeChargeId: `ch_test_p3_b_${stamp}`,
    });
    assert(
      "E. Two Word Search purchases → entitlement exists",
      await hasEntitlement(email, "book-two"),
    );

    await recordStripeRefundAndRecompute({
      stripeRefundId: `re_p3_first_full_${stamp}`,
      amountCents: 700,
      currency: "usd",
      status: "succeeded",
      stripeChargeId: `ch_test_p3_a_${stamp}`,
      stripePaymentIntentId: `pi_test_p3_a_${stamp}`,
      reason: null,
      processedAt: new Date(),
    });
    assert(
      "F. One of two refunded → entitlement remains (old success URL still allowed)",
      await hasEntitlement(email, "book-two"),
    );

    await recordStripeRefundAndRecompute({
      stripeRefundId: `re_p3_second_full_${stamp}`,
      amountCents: 700,
      currency: "usd",
      status: "succeeded",
      stripeChargeId: `ch_test_p3_b_${stamp}`,
      stripePaymentIntentId: `pi_test_p3_b_${stamp}`,
      reason: null,
      processedAt: new Date(),
    });
    assert(
      "C/G. Both fully refunded → entitlement removed (both success URLs must 403)",
      !(await hasEntitlement(email, "book-two")),
    );

    void first;
    void second;
    void emails;

    const sickle = await recordPurchaseAndEntitlement({
      email,
      bookId: "book-one",
      stripeCheckoutSessionId: `cs_test_p3_sc_${stamp}`,
      stripePaymentIntentId: `pi_test_p3_sc_${stamp}`,
      amountCents: 700,
      currency: "usd",
      stripeChargeId: `ch_test_p3_sc_${stamp}`,
    });
    const asthma = await recordPurchaseAndEntitlement({
      email,
      bookId: "book-three",
      stripeCheckoutSessionId: `cs_test_p3_as_${stamp}`,
      stripePaymentIntentId: `pi_test_p3_as_${stamp}`,
      amountCents: 700,
      currency: "usd",
      stripeChargeId: `ch_test_p3_as_${stamp}`,
    });
    assert(
      "N. Sickle Cell reader entitlement still grants after Word Search revoke",
      (await hasEntitlement(email, "book-one")) && isReaderBookId("book-one"),
    );
    assert(
      "O. Asthma reader entitlement still grants after Word Search revoke",
      (await hasEntitlement(email, "book-three")) && isReaderBookId("book-three"),
    );
    void sickle;
    void asthma;

    try {
      const missing = await fetch("http://localhost:3000/api/download");
      const unpaid = await fetch(
        "http://localhost:3000/api/download?session_id=cs_test_invalid_phase3",
      );
      assert(
        "J. Missing/invalid session keeps existing 400 behavior",
        missing.status === 400 && unpaid.status === 400,
        `missing=${missing.status} invalid=${unpaid.status}`,
      );
      const library = await fetch(
        "http://localhost:3000/api/library/download?bookId=book-two",
        { redirect: "manual" },
      );
      assert(
        "M. My Books Word Search download still requires a library session",
        library.status === 302 &&
          (library.headers.get("location") ?? "").includes("/library"),
      );
    } catch {
      assert("J. Missing/invalid session keeps existing 400 behavior", false, "localhost not reachable");
      assert(
        "M. My Books Word Search download still requires a library session",
        false,
        "localhost not reachable",
      );
    }
  } finally {
    await cleanup();
  }
}

run()
  .then(() => {
    const failed = checks.filter((c) => !c.pass);
    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
    if (failed.length) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
