import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  issueSmartUploadIntent,
  issueSmartUploadPreviewDerivativeIntent,
} from "./smart-upload-intent";
import { verifySmartUploadCaptionImageAccess } from "./smart-upload-caption-security";

const ORIGINAL_PATH = `marketing/public/${"a".repeat(32)}.png`;
const DERIVATIVE_PATH = `marketing/public/${"b".repeat(32)}.png`;
const OTHER_ORIGINAL = `marketing/public/${"c".repeat(32)}.png`;

const originalSecret = process.env.ADMIN_SESSION_SECRET;

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = "caption-security-test-secret";
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = originalSecret;
});

test("verifySmartUploadCaptionImageAccess accepts matching derivative pair with finalize linkage", () => {
  const originalIntent = issueSmartUploadIntent({ username: "owner", pathname: ORIGINAL_PATH }).uploadIntent;
  const derivativeIntent = issueSmartUploadPreviewDerivativeIntent({
    username: "owner",
    pathname: DERIVATIVE_PATH,
    originalPathname: ORIGINAL_PATH,
    finalizeKey: "fk-1",
    strategy: "pad",
    targetRatio: "4:5",
  }).uploadIntent;

  const ref = verifySmartUploadCaptionImageAccess({
    actorUsername: "owner",
    original: { uploadIntent: originalIntent, pathname: ORIGINAL_PATH },
    acceptedDerivative: { uploadIntent: derivativeIntent, pathname: DERIVATIVE_PATH },
    finalizeKey: "fk-1",
    strategy: "pad",
    targetRatio: "4:5",
  });
  assert.equal(ref.pathname, DERIVATIVE_PATH);
});

test("derivative without finalize linkage inputs rejected", () => {
  const originalIntent = issueSmartUploadIntent({ username: "owner", pathname: ORIGINAL_PATH }).uploadIntent;
  const derivativeIntent = issueSmartUploadPreviewDerivativeIntent({
    username: "owner",
    pathname: DERIVATIVE_PATH,
    originalPathname: ORIGINAL_PATH,
    finalizeKey: "fk-2",
    strategy: "crop",
    targetRatio: "1:1",
  }).uploadIntent;

  assert.throws(
    () =>
      verifySmartUploadCaptionImageAccess({
        actorUsername: "owner",
        original: { uploadIntent: originalIntent, pathname: ORIGINAL_PATH },
        acceptedDerivative: { uploadIntent: derivativeIntent, pathname: DERIVATIVE_PATH },
      }),
    /finalizeKey, strategy, and targetRatio are required/i,
  );
});

test("wrong original pathname for derivative rejected under finalize verifier", () => {
  const originalIntent = issueSmartUploadIntent({ username: "owner", pathname: ORIGINAL_PATH }).uploadIntent;
  const derivativeIntent = issueSmartUploadPreviewDerivativeIntent({
    username: "owner",
    pathname: DERIVATIVE_PATH,
    originalPathname: OTHER_ORIGINAL,
    finalizeKey: "fk-2",
    strategy: "crop",
    targetRatio: "1:1",
  }).uploadIntent;

  assert.throws(
    () =>
      verifySmartUploadCaptionImageAccess({
        actorUsername: "owner",
        original: { uploadIntent: originalIntent, pathname: ORIGINAL_PATH },
        acceptedDerivative: { uploadIntent: derivativeIntent, pathname: DERIVATIVE_PATH },
        finalizeKey: "fk-2",
        strategy: "crop",
        targetRatio: "1:1",
      }),
    /does not match/i,
  );
});

test("actor mismatch rejected", () => {
  const originalIntent = issueSmartUploadIntent({ username: "owner", pathname: ORIGINAL_PATH }).uploadIntent;
  assert.throws(
    () =>
      verifySmartUploadCaptionImageAccess({
        actorUsername: "intruder",
        original: { uploadIntent: originalIntent, pathname: ORIGINAL_PATH },
        acceptedDerivative: null,
      }),
    /match the current admin session/i,
  );
});
