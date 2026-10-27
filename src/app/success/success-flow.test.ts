import assert from "node:assert/strict";
import { test } from "node:test";
import {
  shouldFetchEbookDownloadIntent,
  successViewStateFromSummary,
} from "./success-flow";

test("physical session summary maps to physical view state", () => {
  assert.equal(
    successViewStateFromSummary(
      {
        purchaseType: "physical",
        bookId: "book-one",
        bookTitle: "Children Diseases: Sickle Cell",
        amountTotalCents: 1499,
        shippingCents: 499,
        quantity: 1,
        orderRecorded: true,
      },
      false,
    ),
    "physical",
  );
});

test("physical view state does not fetch ebook download intent", () => {
  assert.equal(shouldFetchEbookDownloadIntent("physical"), false);
});

test("ebook session summary maps to ebook view state", () => {
  assert.equal(
    successViewStateFromSummary({ purchaseType: "ebook" }, false),
    "ebook",
  );
});

test("ebook view state fetches ebook download intent", () => {
  assert.equal(shouldFetchEbookDownloadIntent("ebook"), true);
});

test("failed summary load maps to error view state", () => {
  assert.equal(successViewStateFromSummary(null, true), "error");
});

test("physical view state is not ebook — no ebook CTA path", () => {
  const state = successViewStateFromSummary(
    {
      purchaseType: "physical",
      bookId: "book-one",
      bookTitle: "Children Diseases: Sickle Cell",
      amountTotalCents: 1499,
      shippingCents: 499,
      quantity: 1,
      orderRecorded: true,
    },
    false,
  );
  assert.notEqual(state, "ebook");
  assert.equal(state, "physical");
});
