import { readFileSync, writeFileSync } from "node:fs";
import Stripe from "stripe";

function loadEnvLocal() {
  const env = {};
  const text = readFileSync(".env.local", "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "");
  }
  return { env, text };
}

const { env, text } = loadEnvLocal();
const secret = env.STRIPE_SECRET_KEY?.trim();
if (!secret?.startsWith("sk_test_")) {
  console.error("STRIPE_SECRET_KEY in .env.local must be an sk_test_ key.");
  process.exit(1);
}

const stripe = new Stripe(secret);

const books = [
  {
    envKey: "STRIPE_TEST_PRICE_BOOK_ONE",
    bookId: "book-one",
    name: "Children Diseases: Sickle Cell (TEST)",
  },
  {
    envKey: "STRIPE_TEST_PRICE_BOOK_TWO",
    bookId: "book-two",
    name: "Health & Medicine Word Search Collection (TEST)",
  },
  {
    envKey: "STRIPE_TEST_PRICE_BOOK_THREE",
    bookId: "book-three",
    name: "Children Diseases: Asthma (TEST)",
  },
];

const created = {};

for (const book of books) {
  const product = await stripe.products.create({
    name: book.name,
    metadata: { bookId: book.bookId, env: "test" },
  });
  const price = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: 700,
    metadata: { bookId: book.bookId, env: "test" },
  });
  created[book.envKey] = price.id;
  console.log(`${book.bookId} -> ${price.id}`);
}

let next = text.replace(/\n*$/, "\n");
for (const [key, value] of Object.entries(created)) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(next)) next = next.replace(re, line);
  else next += `${line}\n`;
}
writeFileSync(".env.local", next);
console.log("Wrote test price IDs to .env.local");
