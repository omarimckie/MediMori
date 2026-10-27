import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { WorkspaceExportError, relativePathHash, type BinaryDetectedFormat, type BinaryFailureReason, type BinaryOwnerAction } from "./workspace-export-diagnostics";

export const SOURCE_SELECTION_POLICY_VERSION = 2;
export const SOURCE_SELECTION_LIMITS = Object.freeze({ maxFiles: 5_000, maxFileBytes: 32 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024 });
export function assertSourceFileCountLimit(count: number) { if (!Number.isSafeInteger(count) || count < 1 || count > SOURCE_SELECTION_LIMITS.maxFiles) fail("source_file_count_limit_exceeded"); }
export function assertSourceFileSizeLimit(size: number) { if (!Number.isSafeInteger(size) || size < 0 || size > SOURCE_SELECTION_LIMITS.maxFileBytes) fail("source_file_size_limit_exceeded"); }
export function assertSourceAggregateSizeLimit(size: bigint) { if (size < BigInt(0) || size > BigInt(SOURCE_SELECTION_LIMITS.maxTotalBytes)) fail("source_total_size_limit_exceeded"); }

type TreeEntry = { mode: "100644" | "100755"; type: "blob"; oid: string; path: string };
export type CanonicalSourceFile = { path: string; mode: TreeEntry["mode"]; oid: string; bytes: Buffer; sha256: string };
export type CanonicalSourceManifest = { root: string; commit: string; tree: string; files: CanonicalSourceFile[]; totalBytes: bigint; revision: string };

const safeBinaryExtensions = new Set([".png", ".jpg", ".jpeg", ".ico"]);
const MAX_ICC_PROFILE_BYTES = 1_048_576;
const MAX_ICC_COMPRESSED_BYTES = 1_048_576;
const MAX_ICC_TAGS = 128;
const MAX_JPEG_ICC_SEGMENTS = 32;
const MAX_C2PA_STORE_BYTES = 1_048_576;
const MAX_JUMBF_BOXES = 512;
const MAX_JUMBF_DEPTH = 8;
const secretPattern = /(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|(?:postgres(?:ql)?:\/\/)[^\s/:@]+:[^\s/@]+@[^\s]+|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}|vercel_blob_rw_[A-Za-z0-9_]{20,})/;

function fail(code: string, path = "", details: { detectedFormat?: BinaryDetectedFormat; binaryFailure?: BinaryFailureReason; metadataType?: "eXIf" | "iTXt" | "unknown"; recommendedOwnerAction?: BinaryOwnerAction } = {}) : never {
  throw new WorkspaceExportError(code as never, { operation: "manifest", ...(path ? { relativePathHash: relativePathHash(path), ...(path.length <= 512 ? { relativePath: path } : {}) } : {}), ...details });
}

function runGit(root: string, args: string[], input?: Buffer) {
  return new Promise<Buffer>((resolvePromise, reject) => {
    const child = spawn("git", ["-C", root, ...args], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let size = 0;
    child.stdout.on("data", (chunk: Buffer) => { size += chunk.length; if (size > SOURCE_SELECTION_LIMITS.maxTotalBytes + SOURCE_SELECTION_LIMITS.maxFiles * 128) { child.kill(); reject(new Error("git_output_limit")); return; } chunks.push(chunk); });
    child.on("error", () => reject(new Error("git_command_failed")));
    child.on("close", code => code === 0 ? resolvePromise(Buffer.concat(chunks)) : reject(new Error("git_command_failed")));
    child.stdin.end(input);
  });
}

function parseTree(raw: Buffer): TreeEntry[] {
  const entries: TreeEntry[] = [];
  let cursor = 0;
  while (cursor < raw.length) {
    const zero = raw.indexOf(0, cursor);
    if (zero < 0) fail("source_git_tree_invalid");
    const record = raw.subarray(cursor, zero);
    const tab = record.indexOf(9);
    if (tab < 0) fail("source_git_tree_invalid");
    const [mode, type, oid] = record.subarray(0, tab).toString("ascii").split(" ");
    const pathBytes = record.subarray(tab + 1);
    // ls-tree paths are UTF-8 in this project; reject byte sequences that do not round-trip.
    const path = pathBytes.toString("utf8");
    const components = path.split("/");
    const windowsUnsafe = components.some(part => !part || part === "." || part === ".." || /[\\:\u0000-\u001f\u007f]/.test(part) || /[ .]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part));
    if (!Buffer.from(path, "utf8").equals(pathBytes) || mode === "120000" || type === "commit") fail("source_git_entry_unsupported", path);
    if ((mode !== "100644" && mode !== "100755") || type !== "blob" || !/^[a-f0-9]{40}$/.test(oid ?? "") || !path || path.startsWith("/") || windowsUnsafe) fail("source_git_entry_unsupported", path);
    entries.push({ mode, type, oid, path });
    cursor = zero + 1;
  }
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const portablePaths = new Set<string>();
  for (const entry of entries) {
    const key = entry.path.toLowerCase();
    if (portablePaths.has(key)) fail("source_git_entry_unsupported", entry.path);
    portablePaths.add(key);
  }
  assertSourceFileCountLimit(entries.length);
  return entries;
}

function readBatch(root: string, entries: TreeEntry[]) {
  const uniqueOids = [...new Set(entries.map(entry => entry.oid))];
  return runGit(root, ["cat-file", "--batch"], Buffer.from(uniqueOids.map(oid => `${oid}\n`).join(""))).catch(() => fail("source_git_object_read_failed")).then(raw => {
    const objects = new Map<string, Buffer>();
    let offset = 0;
    for (const expectedOid of uniqueOids) {
      const end = raw.indexOf(10, offset);
      if (end < 0) fail("source_git_object_invalid");
      const header = raw.toString("ascii", offset, end).split(" ");
      const [oid, type, sizeText] = header;
      const size = Number(sizeText);
      if (oid !== expectedOid || type !== "blob") fail("source_git_object_invalid");
      assertSourceFileSizeLimit(size);
      offset = end + 1;
      const contentEnd = offset + size;
      if (contentEnd >= raw.length || raw[contentEnd] !== 10) fail("source_git_object_invalid");
      objects.set(oid, raw.subarray(offset, contentEnd));
      offset = contentEnd + 1;
    }
    if (offset !== raw.length) fail("source_git_object_invalid");
    return objects;
  });
}

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validIccProfile(profile: Buffer) {
  if (profile.length < 132 || profile.length > MAX_ICC_PROFILE_BYTES || profile.readUInt32BE(0) !== profile.length
    || ![2, 4].includes(profile[8]) || profile.toString("ascii", 36, 40) !== "acsp") return false;
  if (!["scnr", "mntr", "prtr"].includes(profile.toString("ascii", 12, 16))
    || !["RGB ", "GRAY", "CMYK"].includes(profile.toString("ascii", 16, 20))
    || !["XYZ ", "Lab "].includes(profile.toString("ascii", 20, 24))) return false;
  const tagCount = profile.readUInt32BE(128);
  const tableEnd = 132 + tagCount * 12;
  if (tagCount < 1 || tagCount > MAX_ICC_TAGS || tableEnd > profile.length) return false;
  const signatures = new Set<string>();
  const ranges: Array<[number, number]> = [];
  for (let index = 0; index < tagCount; index++) {
    const entry = 132 + index * 12;
    const signature = profile.toString("ascii", entry, entry + 4);
    const offset = profile.readUInt32BE(entry + 4);
    const size = profile.readUInt32BE(entry + 8);
    if (!/^[\x20-\x7e]{4}$/.test(signature) || signatures.has(signature)
      || offset < tableEnd || size < 8 || offset + size > profile.length) return false;
    signatures.add(signature);
    if (!/^[\x20-\x7e]{4}$/.test(profile.toString("ascii", offset, offset + 4))
      || profile.readUInt32BE(offset + 4) !== 0) return false;
    ranges.push([offset, offset + size]);
  }
  ranges.sort(([left], [right]) => left - right);
  for (let index = 1; index < ranges.length; index++) {
    const [previousStart, previousEnd] = ranges[index - 1];
    const [currentStart, currentEnd] = ranges[index];
    if (currentStart < previousEnd && (currentStart !== previousStart || currentEnd !== previousEnd)) return false;
  }
  return true;
}

function validPngIccp(data: Buffer) {
  const keywordEnd = data.indexOf(0);
  if (keywordEnd < 1 || keywordEnd > 79 || keywordEnd + 2 >= data.length) return false;
  const keyword = data.subarray(0, keywordEnd);
  if (keyword[0] === 32 || keyword[keyword.length - 1] === 32) return false;
  for (let index = 0; index < keyword.length; index++) {
    const byte = keyword[index];
    if (!(byte >= 32 && byte <= 126 || byte >= 161) || (byte === 32 && keyword[index - 1] === 32)) return false;
  }
  if (data[keywordEnd + 1] !== 0) return false;
  const compressed = data.subarray(keywordEnd + 2);
  if (compressed.length === 0 || compressed.length > MAX_ICC_COMPRESSED_BYTES) return false;
  try {
    const result = inflateSync(compressed, { maxOutputLength: MAX_ICC_PROFILE_BYTES, info: true });
    const decoded = result as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
    return decoded.engine.bytesWritten === compressed.length && validIccProfile(decoded.buffer);
  } catch {
    return false;
  }
}

const c2paUuids = Object.freeze({
  store: "6332706100110010800000aa00389b71",
  manifest: "63326d6100110010800000aa00389b71",
  assertions: "6332617300110010800000aa00389b71",
  claim: "6332636c00110010800000aa00389b71",
  signature: "6332637300110010800000aa00389b71",
});

type JumbfNode = { type: string; uuid?: string; label?: string; children?: JumbfNode[] };
type JumbfBudget = { boxes: number };

function parseJumbfBoxes(bytes: Buffer, start: number, end: number, budget: JumbfBudget, depth = 0): JumbfNode[] | null {
  if (depth > MAX_JUMBF_DEPTH) return null;
  const nodes: JumbfNode[] = [];
  let offset = start;
  while (offset < end) {
    if (++budget.boxes > MAX_JUMBF_BOXES || offset + 8 > end) return null;
    const size = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (size < 8 || size > end - offset || !/^[a-z]{4}$/.test(type)) return null;
    const boxEnd = offset + size;
    if (type === "jumd") {
      if (size < 27) return null;
      const uuid = bytes.subarray(offset + 8, offset + 24).toString("hex");
      const toggles = bytes[offset + 24];
      const labelEnd = bytes.indexOf(0, offset + 25);
      if ((toggles & ~0x13) !== 0 || (toggles & 0x02) === 0 || labelEnd < offset + 26) return null;
      const labelBytes = bytes.subarray(offset + 25, labelEnd);
      if (labelBytes.length === 0 || labelBytes.length > 255 || labelBytes.some(byte => byte < 0x20 || byte > 0x7e || [0x2f, 0x3b, 0x3f, 0x23].includes(byte))) return null;
      const privateOffset = labelEnd + 1;
      if ((toggles & 0x10) !== 0) {
        const privateLength = boxEnd - privateOffset;
        if ((privateLength !== 24 && privateLength !== 40) || bytes.readUInt32BE(privateOffset) !== privateLength
          || bytes.toString("ascii", privateOffset + 4, privateOffset + 8) !== "c2sh") return null;
      } else if (privateOffset !== boxEnd) return null;
      nodes.push({ type, uuid, label: labelBytes.toString("ascii") });
    } else if (type === "jumb") {
      const children = parseJumbfBoxes(bytes, offset + 8, boxEnd, budget, depth + 1);
      if (!children || children.length < 2 || children[0].type !== "jumd") return null;
      nodes.push({ type, uuid: children[0].uuid, label: children[0].label, children: children.slice(1) });
    } else if (["cbor", "bfdb", "bidb"].includes(type)) {
      if (size === 8) return null;
      nodes.push({ type });
    } else {
      return null;
    }
    offset = boxEnd;
  }
  return offset === end ? nodes : null;
}

/** Validate the bounded C2PA/JUMBF container shape, not signature authenticity or trust claims. */
function validateC2paStore(bytes: Buffer): BinaryFailureReason | undefined {
  if (bytes.length === 0 || bytes.length > MAX_C2PA_STORE_BYTES) return "c2pa_payload_oversized";
  const boxes = parseJumbfBoxes(bytes, 0, bytes.length, { boxes: 0 });
  if (!boxes || boxes.length !== 1 || boxes[0].type !== "jumb" || boxes[0].uuid !== c2paUuids.store || boxes[0].label !== "c2pa") return "c2pa_container_invalid";
  const rootChildren = boxes[0].children ?? [];
  if (rootChildren.length !== 1 || rootChildren[0].type !== "jumb") return "c2pa_container_invalid";
  const manifest = rootChildren[0];
  if (manifest.uuid !== c2paUuids.manifest || !/^urn:c2pa:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(manifest.label ?? "")) return "c2pa_container_invalid";
  const required = new Map<string, number>([[c2paUuids.assertions, 0], [c2paUuids.claim, 0], [c2paUuids.signature, 0]]);
  for (const child of manifest.children ?? []) {
    if (child.type !== "jumb" || !child.uuid) return "c2pa_container_invalid";
    const count = required.get(child.uuid);
    if (count === undefined || count > 0) return "c2pa_container_invalid";
    required.set(child.uuid, count + 1);
    if (child.uuid === c2paUuids.claim || child.uuid === c2paUuids.signature) {
      if (child.children?.length !== 1 || child.children[0].type !== "cbor") return "c2pa_container_invalid";
    } else {
      const assertions = child.children ?? [];
      if (assertions.length === 0 || assertions.some(assertion => assertion.type !== "jumb" || !assertion.uuid || !assertion.label || !assertion.children?.length
        || assertion.children.some(content => !["cbor", "bfdb", "bidb"].includes(content.type)))) return "c2pa_container_invalid";
    }
  }
  if ([...required.values()].some(count => count !== 1)) return "c2pa_container_invalid";
  return undefined;
}

function validatePng(bytes: Buffer, diagnostic?: { failure: BinaryFailureReason | undefined; metadataType?: "eXIf" | "iTXt" | "unknown" }) {
  if (diagnostic) diagnostic.failure = "invalid_structure";
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature)) return false;
  let offset = 8, sawHeader = false, sawData = false, sawEnd = false, sawIccProfile = false, sawPalette = false, sawC2pa = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset); offset += 4;
    if (length > bytes.length - offset - 8) return false;
    const type = bytes.toString("ascii", offset, offset + 4); offset += 4;
    const safeChunks = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "sBIT", "bKGD", "pHYs", "iCCP", "caBX"]);
    if (!/^[A-Za-z]{4}$/.test(type) || !safeChunks.has(type)) { if (diagnostic) { diagnostic.failure = "unsupported_metadata"; diagnostic.metadataType = type === "eXIf" || type === "iTXt" ? type : "unknown"; } return false; }
    if (!sawHeader && type !== "IHDR") return false;
    if (type === "IHDR") { if (sawHeader || length !== 13) return false; sawHeader = true; }
    if (type === "iCCP") {
      if (sawIccProfile || sawPalette || sawData || !validPngIccp(bytes.subarray(offset, offset + length))) return false;
      sawIccProfile = true;
    }
    if (type === "caBX") {
      if (sawC2pa || sawData) { if (diagnostic) diagnostic.failure = "c2pa_container_invalid"; return false; }
      sawC2pa = true;
      const c2paFailure = validateC2paStore(bytes.subarray(offset, offset + length));
      if (c2paFailure) { if (diagnostic) diagnostic.failure = c2paFailure; return false; }
    }
    if (type === "PLTE") sawPalette = true;
    if (type === "IDAT") sawData = true;
    const dataEnd = offset + length;
    const storedCrc = bytes.readUInt32BE(dataEnd);
    if (crc32(bytes.subarray(offset - 4, dataEnd)) !== storedCrc) { if (diagnostic && type === "caBX") diagnostic.failure = "c2pa_container_invalid"; return false; }
    if (type === "IEND") { if (length !== 0 || !sawData) return false; sawEnd = true; offset += 4; break; }
    offset += length + 4;
  }
  const valid = sawHeader && sawEnd && offset === bytes.length;
  if (valid && diagnostic) diagnostic.failure = undefined;
  return valid;
}

function validateIco(bytes: Buffer, diagnostic?: { failure: BinaryFailureReason | undefined }) {
  if (bytes.length < 22 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) return false;
  const count = bytes.readUInt16LE(4);
  if (count < 1 || count > 64 || 6 + count * 16 > bytes.length) return false;
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16, width = bytes[at] || 256, height = bytes[at + 1] || 256;
    const planes = bytes.readUInt16LE(at + 4), bitCount = bytes.readUInt16LE(at + 6);
    const size = bytes.readUInt32LE(at + 8), offset = bytes.readUInt32LE(at + 12);
    if (size === 0 || offset < 6 + count * 16 || offset + size > bytes.length) return false;
    ranges.push([offset, offset + size]);
    const image = bytes.subarray(offset, offset + size);
    const isPng = image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    if (isPng) {
      if (!validatePng(image) || image.readUInt32BE(16) !== width || image.readUInt32BE(20) !== height) return false;
      continue;
    }
    if (planes !== 1 || !validateIcoDib(image, width, height, bitCount)) {
      if (diagnostic) diagnostic.failure = "ico_dib_layout_unsupported";
      return false;
    }
  }
  ranges.sort(([a], [b]) => a - b);
  let expectedOffset = 6 + count * 16;
  for (const [start, end] of ranges) {
    if (start !== expectedOffset || end <= start) return false;
    expectedOffset = end;
  }
  return expectedOffset === bytes.length;
}

/** Accept only complete, uncompressed BITMAPINFOHEADER icon payloads with exact pixel/mask lengths. */
function validateIcoDib(bytes: Buffer, iconWidth: number, iconHeight: number, directoryBitCount: number) {
  if (bytes.length < 40 || bytes.readUInt32LE(0) !== 40) return false;
  const width = bytes.readInt32LE(4), doubledHeight = bytes.readInt32LE(8), planes = bytes.readUInt16LE(12);
  const bitCount = bytes.readUInt16LE(14), compression = bytes.readUInt32LE(16), imageSize = bytes.readUInt32LE(20), colorsUsed = bytes.readUInt32LE(32);
  if (width !== iconWidth || doubledHeight !== iconHeight * 2 || planes !== 1 || bitCount !== directoryBitCount
    || ![1, 4, 8, 16, 24, 32].includes(bitCount) || compression !== 0) return false;
  const paletteColors = bitCount <= 8 ? (colorsUsed || 2 ** bitCount) : 0;
  if ((bitCount > 8 && colorsUsed !== 0) || paletteColors > 2 ** Math.min(bitCount, 8)) return false;
  const xorStride = Math.ceil(iconWidth * bitCount / 32) * 4;
  const maskStride = Math.ceil(iconWidth / 32) * 4;
  const xorBytes = xorStride * iconHeight, maskBytes = maskStride * iconHeight;
  const expectedSize = 40 + paletteColors * 4 + xorBytes + maskBytes;
  return Number.isSafeInteger(expectedSize) && bytes.length === expectedSize && (imageSize === 0 || imageSize === xorBytes);
}

function detectBinaryFormat(bytes: Buffer): BinaryDetectedFormat {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (bytes.length >= 4 && bytes.readUInt16LE(0) === 0 && bytes.readUInt16LE(2) === 1) return "ico";
  return "unknown";
}

function validateBinary(path: string, bytes: Buffer, diagnostic: { format: BinaryDetectedFormat; failure: BinaryFailureReason | undefined }) {
  const ext = path.slice(path.lastIndexOf("/") + 1).toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  diagnostic.format = detectBinaryFormat(bytes);
  if (!safeBinaryExtensions.has(ext)) return false;
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length >= png.length && bytes.subarray(0, png.length).equals(png)) return validatePng(bytes, diagnostic);
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) { diagnostic.failure = "invalid_structure"; const valid = validateJpeg(bytes); if (valid) diagnostic.failure = undefined; return valid; }
  if (diagnostic.format === "ico") { diagnostic.failure = "invalid_structure"; const valid = validateIco(bytes, diagnostic); if (valid) diagnostic.failure = undefined; return valid; }
  return false;
}

/** Parse the complete JPEG marker stream, including markers between progressive scans. */
function validateJpeg(bytes: Buffer) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let offset = 2, sawFrame = false, sawScan = false, iccCount: number | null = null, iccSeen = 0, iccBytes = 0;
  const iccParts: Buffer[] = [];
  const iccSignature = Buffer.from("ICC_PROFILE\0", "ascii");
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) return false;
    const marker = bytes[offset++];
    if (marker === 0xd9) return sawFrame && sawScan && offset === bytes.length && (iccCount === null || iccSeen === iccCount);
    if (marker === 0xd8 || marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) return false;
    if (iccCount !== null && iccSeen < iccCount && marker !== 0xe2) return false;
    if (marker === 0xe2 && iccCount !== null && iccSeen === iccCount) return false;
    // APP1, APP3-APP15 and COM may carry identifying metadata; APP2 is accepted only for ICC.
    if ((marker >= 0xe1 && marker <= 0xef && marker !== 0xe2) || marker === 0xfe) return false;
    if (offset + 2 > bytes.length) return false;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return false;
    const segmentStart = offset + 2, segmentEnd = offset + segmentLength;
    if (marker === 0xe0 && bytes.toString("ascii", segmentStart, Math.min(segmentStart + 5, segmentEnd)) !== "JFIF\0" && bytes.toString("ascii", segmentStart, Math.min(segmentStart + 5, segmentEnd)) !== "JFXX\0") return false;
    if (marker === 0xe2) {
      // JPEG ICC APP2 segments belong before the frame header and first scan.
      if (sawFrame || sawScan) return false;
      if (segmentEnd - segmentStart < 15 || !bytes.subarray(segmentStart, segmentStart + iccSignature.length).equals(iccSignature)) return false;
      const sequence = bytes[segmentStart + 12], count = bytes[segmentStart + 13];
      const fragment = bytes.subarray(segmentStart + 14, segmentEnd);
      if (count < 1 || count > MAX_JPEG_ICC_SEGMENTS || sequence !== iccSeen + 1 || fragment.length === 0
        || (iccCount !== null && count !== iccCount)) return false;
      if (iccCount === null) {
        if (sequence !== 1) return false;
        iccCount = count;
      }
      iccBytes += fragment.length;
      if (iccBytes > MAX_ICC_PROFILE_BYTES) return false;
      iccParts.push(fragment);
      iccSeen++;
      if (iccSeen === iccCount && !validIccProfile(Buffer.concat(iccParts, iccBytes))) return false;
    }
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (segmentLength < 11) return false;
      const height = bytes.readUInt16BE(segmentStart + 1), width = bytes.readUInt16BE(segmentStart + 3), components = bytes[segmentStart + 5];
      if (!width || !height || components < 1 || components > 4 || segmentLength !== 8 + components * 3) return false;
      sawFrame = true;
    }
    offset = segmentEnd;
    if (marker !== 0xda) continue;
    if (!sawFrame || segmentLength < 8) return false;
    const scanComponents = bytes[segmentStart];
    if (scanComponents < 1 || scanComponents > 4 || segmentLength !== 6 + scanComponents * 2) return false;
    sawScan = true;
    let nextMarker = false;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) { offset++; continue; }
      const markerOffset = offset;
      let codeOffset = offset + 1;
      while (bytes[codeOffset] === 0xff) codeOffset++;
      if (codeOffset >= bytes.length) return false;
      const code = bytes[codeOffset];
      if (code === 0x00 || (code >= 0xd0 && code <= 0xd7)) { offset = codeOffset + 1; continue; }
      // Leave the marker for the outer parser so metadata markers after a scan are rejected too.
      offset = markerOffset;
      nextMarker = true;
      break;
    }
    if (!nextMarker) return false;
  }
  return false;
}

export function validateCanonicalSourceContent(path: string, bytes: Buffer) {
  let isText = false;
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); isText = !bytes.includes(0); } catch { /* binary classification below */ }
  if (!isText) {
    const diagnostic: { format: BinaryDetectedFormat; failure: BinaryFailureReason | undefined; metadataType?: "eXIf" | "iTXt" | "unknown" } = { format: "unknown", failure: undefined };
    if (!validateBinary(path, bytes, diagnostic)) {
      const failure = diagnostic.failure ?? (diagnostic.format === "png" || diagnostic.format === "jpeg" || diagnostic.format === "ico" ? "unsupported_metadata" : "invalid_structure");
      const action: BinaryOwnerAction = failure === "c2pa_container_invalid" || failure === "c2pa_payload_oversized"
        ? "review_c2pa_asset_without_stripping_credentials"
        : failure === "ico_dib_layout_unsupported" ? "provide_standard_ico_encoding"
        : failure === "unsupported_metadata" ? "review_unsupported_metadata_without_removing_it" : "review_or_replace_unsupported_binary";
      fail("source_binary_unclassified", path, { detectedFormat: diagnostic.format, binaryFailure: failure, ...(diagnostic.metadataType ? { metadataType: diagnostic.metadataType } : {}), recommendedOwnerAction: action });
    }
  }
  if (secretPattern.test(bytes.toString("utf8"))) fail("export_sensitive_content_rejected", path);
}

function revision(files: Array<{ path: string; sha256: string }>) {
  const tree = files.map(file => [file.path, file.sha256] as const).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return createHash("sha1").update(JSON.stringify(tree)).digest("hex");
}

export async function resolveCanonicalSourceManifest(sourceRoot: string): Promise<CanonicalSourceManifest> {
  const root = resolve(sourceRoot);
  let top: string, status: Buffer, head: Buffer, tree: Buffer, listing: Buffer;
  try {
    top = (await runGit(root, ["rev-parse", "--show-toplevel"])).toString("utf8").trim();
    head = await runGit(root, ["rev-parse", "HEAD"]);
    status = await runGit(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
    const fixedCommit = head.toString("ascii").trim();
    tree = await runGit(root, ["rev-parse", `${fixedCommit}^{tree}`]);
    listing = await runGit(root, ["ls-tree", "-rz", "--full-tree", fixedCommit]);
  } catch { fail("source_git_resolution_failed"); }
  if (resolve(top!) !== root || status!.length !== 0) fail("source_checkout_dirty");
  const commit = head!.toString("ascii").trim(), treeId = tree!.toString("ascii").trim();
  if (!/^[a-f0-9]{40}$/.test(commit) || !/^[a-f0-9]{40}$/.test(treeId)) fail("source_git_revision_invalid");
  const entries = parseTree(listing!);
  const objects = await readBatch(root, entries);
  let totalBytes = BigInt(0);
  const files: CanonicalSourceFile[] = entries.map(entry => {
    const bytes = objects.get(entry.oid);
    if (!bytes) fail("source_git_object_invalid", entry.path);
    assertSourceFileSizeLimit(bytes.length);
    totalBytes += BigInt(bytes.length);
    assertSourceAggregateSizeLimit(totalBytes);
    validateCanonicalSourceContent(entry.path, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    // Git object identity confirms the bytes belong to the immutable source tree.
    const oid = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    if (oid !== entry.oid) fail("source_git_object_invalid", entry.path);
    return { path: entry.path, mode: entry.mode, oid, bytes, sha256 };
  });
  await verifyCheckoutFiles(root, files);
  await verifyCanonicalSourceCheckout({ root, commit, tree: treeId, files, totalBytes, revision: revision(files) });
  return { root, commit, tree: treeId, files, totalBytes, revision: revision(files) };
}

export async function verifyCanonicalSourceCheckout(manifest: CanonicalSourceManifest) {
  const [status, head] = await Promise.all([
    runGit(manifest.root, ["status", "--porcelain=v1", "--untracked-files=all"]),
    runGit(manifest.root, ["rev-parse", "HEAD"]),
  ]).catch(() => fail("source_git_resolution_failed"));
  if (status.length !== 0 || head.toString("ascii").trim() !== manifest.commit) fail("source_checkout_changed_during_export");
  await verifyCheckoutFiles(manifest.root, manifest.files);
}

export async function verifyCheckoutFiles(root: string, files: CanonicalSourceFile[]) {
  for (const file of files) {
    const components = file.path.split("/");
    let parent = root;
    for (const component of components.slice(0, -1)) {
      parent = join(parent, component);
      let parentInfo;
      try { parentInfo = await lstat(parent); } catch { fail("source_file_missing", file.path); }
      if (!parentInfo!.isDirectory() || parentInfo!.isSymbolicLink()) fail("source_file_modified", file.path);
    }
    const full = join(root, ...components);
    let info;
    try { info = await lstat(full); } catch { fail("source_file_missing", file.path); }
    if (!info!.isFile() || info!.isSymbolicLink() || info!.size !== file.bytes.length) fail("source_file_modified", file.path);
    let content: Buffer;
    try { content = await readFile(full); } catch { fail("source_file_read_failed", file.path); }
    const oid = createHash("sha1").update(`blob ${content!.length}\0`).update(content!).digest("hex");
    if (oid !== file.oid) fail("source_file_modified", file.path);
  }
}

export async function copyCanonicalSourceManifest(manifest: CanonicalSourceManifest, destination: string) {
  for (const file of manifest.files) {
    const target = join(destination, ...file.path.split("/"));
    try { await mkdir(dirname(target), { recursive: true }); await writeFile(target, file.bytes, { flag: "wx", mode: file.mode === "100755" ? 0o755 : 0o644 }); }
    catch { fail("export_file_write_failed", file.path); }
  }
}

export function canonicalSourceManifestBytes(manifest: CanonicalSourceManifest) { return manifest.totalBytes; }
export function canonicalSourceManifestRevision(manifest: CanonicalSourceManifest) { return manifest.revision; }
