import assert from "node:assert/strict";
import { test } from "node:test";
import { validateResourceFields } from "@/components/admin/marketing/ManualUploadModals";

function makeFormStub(fileState: { preview?: boolean; file?: boolean }): HTMLFormElement {
  return {
    querySelector(selector: string) {
      if (selector === 'input[name="preview"]') {
        return fileState.preview ? { files: [{ name: "preview.png" }] } : { files: [] };
      }
      if (selector === 'input[name="file"]') {
        return fileState.file ? { files: [{ name: "sheet.pdf" }] } : { files: [] };
      }
      return null;
    },
  } as HTMLFormElement;
}

test("validateResourceFields uses React field state for title and description", () => {
  const form = makeFormStub({});
  const errors = validateResourceFields(form, {
    title: "Sickle Cell: My Body & Me — Activity Sheet",
    description: "A short description.",
  });
  assert.equal(errors.title, undefined);
  assert.equal(errors.description, undefined);
  assert.equal(errors.preview, "Choose a preview image.");
  assert.equal(errors.file, "Choose a downloadable file.");
});

test("preview and downloadable file inputs are validated independently", () => {
  const previewOnly = makeFormStub({ preview: true });
  const previewErrors = validateResourceFields(previewOnly, {
    title: "Title",
    description: "Description",
  });
  assert.equal(previewErrors.preview, undefined);
  assert.equal(previewErrors.file, "Choose a downloadable file.");

  const fileOnly = makeFormStub({ file: true });
  const fileErrors = validateResourceFields(fileOnly, {
    title: "Title",
    description: "Description",
  });
  assert.equal(fileErrors.preview, "Choose a preview image.");
  assert.equal(fileErrors.file, undefined);
});
