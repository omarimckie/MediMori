import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { createFreshExport, diagnoseFreshExport } from "./workspace";
import { WorkspaceExportError, workspaceExportDiagnostic } from "./workspace-export-diagnostics";
import { assertSourceAggregateSizeLimit, assertSourceFileCountLimit, assertSourceFileSizeLimit, resolveCanonicalSourceManifest, SOURCE_SELECTION_LIMITS, validateCanonicalSourceContent } from "./source-manifest";

function git(root: string, ...args: string[]) { execFileSync("git", ["-C", root, ...args], { stdio: "ignore", windowsHide: true }); }
function gitOutput(root: string, ...args: string[]) { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true }).trim(); }
async function repo(root: string, files: Record<string, string> = {}) {
  await mkdir(root, { recursive: true });
  git(root, "init", "-q");
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, ...path.split("/")); await mkdir(join(full, ".."), { recursive: true }); await writeFile(full, content);
  }
  await commit(root);
}
async function commit(root: string) {
  git(root, "add", "-A");
  git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "fixture");
}
function errorCode(code: string) { return (error: unknown) => error instanceof WorkspaceExportError && error.code === code; }
function pngChunk(type: string, data: Buffer) {
  const typeBytes = Buffer.from(type), input = Buffer.concat([typeBytes, data]);
  let crc = 0xffffffff; for (const byte of input) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  const result = Buffer.alloc(4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  return Buffer.concat([length, input, result]);
}
function validPng(beforeData: Buffer[] = [], afterData: Buffer[] = []) {
  const signature = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1,0); ihdr.writeUInt32BE(1,4); ihdr.set([8,6,0,0,0],8);
  return Buffer.concat([signature,pngChunk("IHDR",ihdr),...beforeData,pngChunk("IDAT",deflateSync(Buffer.from([0,1,2,3,255]))),...afterData,pngChunk("IEND",Buffer.alloc(0))]);
}
function jumbfBox(type: string, payload: Buffer) { const header=Buffer.alloc(8);header.writeUInt32BE(payload.length+8,0);header.write(type,4,"ascii");return Buffer.concat([header,payload]); }
function jumbfDescriptor(uuid: string, label: string, toggles = 3) {
  const fields=[Buffer.from(uuid,"hex"),Buffer.from([toggles]),Buffer.from(label,"ascii"),Buffer.from([0])];
  if ((toggles & 0x10) !== 0) { const salt=Buffer.alloc(24);salt.writeUInt32BE(24,0);salt.write("c2sh",4,"ascii");fields.push(salt); }
  return Buffer.concat(fields);
}
function c2paStore() {
  const uuids={store:"6332706100110010800000aa00389b71",manifest:"63326d6100110010800000aa00389b71",assertions:"6332617300110010800000aa00389b71",claim:"6332636c00110010800000aa00389b71",signature:"6332637300110010800000aa00389b71",cbor:"63626f7200110010800000aa00389b71"};
  const assertion=jumbfBox("jumb",Buffer.concat([jumbfBox("jumd",jumbfDescriptor(uuids.cbor,"c2pa.actions.v2",19)),jumbfBox("cbor",Buffer.from([0xa0]))]));
  const assertions=jumbfBox("jumb",Buffer.concat([jumbfBox("jumd",jumbfDescriptor(uuids.assertions,"c2pa.assertions")),assertion]));
  const claim=jumbfBox("jumb",Buffer.concat([jumbfBox("jumd",jumbfDescriptor(uuids.claim,"c2pa.claim.v2")),jumbfBox("cbor",Buffer.from([0xa0]))]));
  const signature=jumbfBox("jumb",Buffer.concat([jumbfBox("jumd",jumbfDescriptor(uuids.signature,"c2pa.signature")),jumbfBox("cbor",Buffer.from([0xa0]))]));
  const manifest=jumbfBox("jumb",Buffer.concat([jumbfBox("jumd",jumbfDescriptor(uuids.manifest,"urn:c2pa:12345678-1234-1234-1234-123456789abc")),assertions,claim,signature]));
  return jumbfBox("jumb",Buffer.concat([jumbfBox("jumd",jumbfDescriptor(uuids.store,"c2pa")),manifest]));
}
function jpegSegment(marker: number, data: Buffer) { const length=Buffer.alloc(2);length.writeUInt16BE(data.length+2);return Buffer.concat([Buffer.from([0xff,marker]),length,data]); }
function validJpeg(beforeFrame: Buffer[] = [], afterFrame: Buffer[] = []) {
  const app=jpegSegment(0xe0,Buffer.concat([Buffer.from("JFIF\0","binary"),Buffer.alloc(9)]));
  const frame=jpegSegment(0xc0,Buffer.from([8,0,1,0,1,1,1,0x11,0]));
  const scan=jpegSegment(0xda,Buffer.from([1,1,0,0,63,0]));
  return Buffer.concat([Buffer.from([0xff,0xd8]),app,...beforeFrame,frame,...afterFrame,scan,Buffer.from([0x12,0xff,0x00,0x34,0xff,0xd9])]);
}
function validIccProfile(size = 152) {
  const profile=Buffer.alloc(size);profile.writeUInt32BE(size,0);profile[8]=4;profile.write("mntr",12,"ascii");profile.write("RGB ",16,"ascii");profile.write("XYZ ",20,"ascii");profile.write("acsp",36,"ascii");
  profile.writeUInt32BE(1,128);profile.write("desc",132,"ascii");profile.writeUInt32BE(144,136);profile.writeUInt32BE(8,140);profile.write("text",144,"ascii");
  return profile;
}
function iccJpegSegment(profilePart: Buffer, sequence: number, count: number) {
  return jpegSegment(0xe2,Buffer.concat([Buffer.from("ICC_PROFILE\0","ascii"),Buffer.from([sequence,count]),profilePart]));
}
function pngIccp(profile: Buffer, compressionMethod = 0, compressed = deflateSync(profile)) {
  return pngChunk("iCCP",Buffer.concat([Buffer.from("Test ICC\0","ascii"),Buffer.from([compressionMethod]),compressed]));
}
function validIcoDib() {
  const dib=Buffer.alloc(64);dib.writeUInt32LE(40,0);dib.writeInt32LE(2,4);dib.writeInt32LE(4,8);dib.writeUInt16LE(1,12);dib.writeUInt16LE(32,14);dib.writeUInt32LE(0,16);dib.writeUInt32LE(16,20);
  const ico=Buffer.alloc(22);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico[6]=2;ico[7]=2;ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(dib.length,14);ico.writeUInt32LE(22,18);
  return Buffer.concat([ico,dib]);
}

test("canonical manifest uses only Git-tracked files; ignored private and generated uploads cannot change S", async () => {
  const base = await mkdtemp(join(tmpdir(), "medimori-source-manifest-")), root = join(base,"repo");
  try {
    await repo(root,{".gitignore":"private/\npublic/marketing-uploads/\n*.scratch\n","docs/readme.md":"tracked source\n","next-env.d.ts":"declare const nextEnv: true;\n"});
    await mkdir(join(root,"private"),{recursive:true}); await writeFile(join(root,"private/secret.txt"),["OPENAI","_API_KEY=fake"].join(""));
    await mkdir(join(root,"public/marketing-uploads"),{recursive:true}); await writeFile(join(root,"public/marketing-uploads/generated.json"),"generated");
    await writeFile(join(root,"ignored.scratch"),"untracked ignored");
    const first = await resolveCanonicalSourceManifest(root);
    assert.deepEqual(first.files.map(file=>file.path),[".gitignore","docs/readme.md","next-env.d.ts"]);
    assert.equal(first.files.some(file=>file.path.startsWith("private/")),false);
    assert.equal(first.files.some(file=>file.path.startsWith("public/marketing-uploads/")),false);
    const before = first.revision;
    await writeFile(join(root,"private/another.txt"),"ignored local content");
    await writeFile(join(root,"public/marketing-uploads/another.json"),"generated again");
    assert.equal((await resolveCanonicalSourceManifest(root)).revision,before);
  } finally { await rm(base,{recursive:true,force:true}); }
});

test("repeated sanitized exports of one clean Git tree have identical deterministic S and clean owned exports", async () => {
  const base=await mkdtemp(join(tmpdir(),"medimori-source-repeat-")),root=join(base,"repo"),scratch=join(base,"scratch"),exports=join(scratch,"exports");
  try {
    await repo(root,{"docs/readme.md":"stable tracked input\n","next-env.d.ts":"declare const env: true;\n"}); await mkdir(exports,{recursive:true});
    const a=await diagnoseFreshExport(root,scratch,exports),b=await diagnoseFreshExport(root,scratch,exports);
    assert.equal(a.revision,b.revision);assert.equal(a.sourcePolicyVersion,2);assert.equal(a.sourceUnchanged,true);assert.equal(a.cleanup,"owned_diagnostic_directory_removed");assert.equal(a.fileCount,2);
    assert.deepEqual(await (await import("node:fs/promises")).readdir(exports),[]);
  } finally { await rm(base,{recursive:true,force:true}); }
});

test("tracked changes require a new immutable Git revision; dirty and untracked checkouts fail closed", async () => {
  const base=await mkdtemp(join(tmpdir(),"medimori-source-revision-")),root=join(base,"repo");
  try {
    await repo(root,{"docs/readme.md":"version one"});const first=await resolveCanonicalSourceManifest(root);
    await writeFile(join(root,"docs/readme.md"),"version two");await commit(root);const second=await resolveCanonicalSourceManifest(root);assert.notEqual(first.revision,second.revision);
    await writeFile(join(root,"docs/readme.md"),"uncommitted mutation");await assert.rejects(resolveCanonicalSourceManifest(root),errorCode("source_checkout_dirty"));
    git(root,"checkout","--","docs/readme.md");await writeFile(join(root,"untracked.txt"),"must not enter export");await assert.rejects(resolveCanonicalSourceManifest(root),errorCode("source_checkout_dirty"));
  } finally { await rm(base,{recursive:true,force:true}); }
});

test("missing or modified selected files and concurrent checkout changes fail closed", async () => {
  const base=await mkdtemp(join(tmpdir(),"medimori-source-race-")),root=join(base,"repo"),exports=join(base,"exports");
  try {
    await repo(root,{"docs/readme.md":"source"});await mkdir(exports,{recursive:true});const manifest=await resolveCanonicalSourceManifest(root);
    await writeFile(join(root,"docs/readme.md"),"changed after source resolution");
    await assert.rejects(createFreshExport(root,exports,manifest),error=>error instanceof WorkspaceExportError&&["source_checkout_dirty","source_file_modified","source_checkout_changed_during_export"].includes(error.code));
    assert.deepEqual(await (await import("node:fs/promises")).readdir(exports),[]);
  } finally { await rm(base,{recursive:true,force:true}); }
});

test("tracked symlinks and unsupported Git entry types are rejected", async t => {
  const base=await mkdtemp(join(tmpdir(),"medimori-source-entry-")),root=join(base,"repo");
  try {
    await repo(root,{"regular.txt":"regular"});
    try { await symlink(join(root,"regular.txt"),join(root,"linked.txt")); } catch(error) { if(error&&typeof error==="object"&&"code" in error&&["EPERM","EACCES","ENOTSUP"].includes(String(error.code))){t.skip("host policy does not permit test symlinks");return;} throw error; }
    await commit(root);await assert.rejects(resolveCanonicalSourceManifest(root),errorCode("source_git_entry_unsupported"));
  } finally { await rm(base,{recursive:true,force:true}); }
});

test("unsupported Git tree objects such as submodules are rejected", async () => {
  const base=await mkdtemp(join(tmpdir(),"medimori-source-gitlink-")),root=join(base,"repo");
  try {
    await repo(root,{"readme.md":"tracked"});
    const submodule=join(root,"external-submodule");await mkdir(submodule);git(submodule,"init","-q");await writeFile(join(submodule,"nested.txt"),"submodule");git(submodule,"add","nested.txt");git(submodule,"-c","user.name=Fixture","-c","user.email=fixture@example.invalid","commit","-qm","nested fixture");
    const submoduleCommit=gitOutput(submodule,"rev-parse","HEAD");
    git(root,"update-index","--add","--cacheinfo",`160000,${submoduleCommit},external-submodule`);
    git(root,"-c","user.name=Fixture","-c","user.email=fixture@example.invalid","commit","-qm","gitlink fixture");
    await assert.rejects(resolveCanonicalSourceManifest(root),errorCode("source_git_entry_unsupported"));
  } finally { await rm(base,{recursive:true,force:true}); }
});

test("file-count, individual-file and aggregate-byte limits are explicit and fail closed", () => {
  assert.equal(SOURCE_SELECTION_LIMITS.maxFiles,5000);assert.equal(SOURCE_SELECTION_LIMITS.maxFileBytes,32*1024*1024);assert.equal(SOURCE_SELECTION_LIMITS.maxTotalBytes,256*1024*1024);
  assert.throws(()=>assertSourceFileCountLimit(5001),errorCode("source_file_count_limit_exceeded"));
  assert.throws(()=>assertSourceFileSizeLimit(SOURCE_SELECTION_LIMITS.maxFileBytes+1),errorCode("source_file_size_limit_exceeded"));
  assert.throws(()=>assertSourceAggregateSizeLimit(BigInt(SOURCE_SELECTION_LIMITS.maxTotalBytes)+BigInt(1)),errorCode("source_total_size_limit_exceeded"));
});

test("credential scanning remains active and unknown or metadata-bearing binary files fail closed", async () => {
  const base=await mkdtemp(join(tmpdir(),"medimori-source-sensitive-")),root=join(base,"repo");
  try {
    const fake=["postgresql","://","fixture-user:fixture-password@fixture.invalid/db"].join("");
    await repo(root,{"diagnostic.fixture":fake});
    await assert.rejects(resolveCanonicalSourceManifest(root),errorCode("export_sensitive_content_rejected"));
    assert.throws(()=>validateCanonicalSourceContent("unknown.bin",Buffer.from([0,1,2])),errorCode("source_binary_unclassified"));
    const safe=validPng();assert.doesNotThrow(()=>validateCanonicalSourceContent("public/safe.png",safe));
    const jpeg=validJpeg();assert.doesNotThrow(()=>validateCanonicalSourceContent("public/mislabeled.png",jpeg));
    const metadata=Buffer.concat([jpeg.subarray(0,jpeg.length-2),jpegSegment(0xe1,Buffer.from("metadata")),jpeg.subarray(jpeg.length-2)]);
    assert.throws(()=>validateCanonicalSourceContent("public/metadata.jpg",metadata),errorCode("source_binary_unclassified"));
    const bad=Buffer.concat([safe.subarray(0,safe.length-12),pngChunk("tEXt",Buffer.from("synthetic metadata")),safe.subarray(safe.length-12)]);
    assert.throws(()=>validateCanonicalSourceContent("public/metadata.png",bad),errorCode("source_binary_unclassified"));
    const internationalText=validPng([pngChunk("iTXt",Buffer.from("Test\0\0\0\0\0synthetic metadata"))]);
    assert.throws(()=>validateCanonicalSourceContent("public/international-text.png",internationalText),error=>error instanceof WorkspaceExportError&&error.metadata.detectedFormat==="png"&&error.metadata.binaryFailure==="unsupported_metadata"&&error.metadata.metadataType==="iTXt");
    const exif=Buffer.concat([safe.subarray(0,safe.length-12),pngChunk("eXIf",Buffer.from("synthetic exif")),safe.subarray(safe.length-12)]);
    assert.throws(()=>validateCanonicalSourceContent("public/exif.png",exif),errorCode("source_binary_unclassified"));
    const corrupt=Buffer.from(safe);corrupt[corrupt.length-5]^=1;assert.throws(()=>validateCanonicalSourceContent("public/corrupt.png",corrupt),errorCode("source_binary_unclassified"));
    assert.doesNotThrow(()=>validateCanonicalSourceContent("src/app/icon.ico",validIcoDib()));
    assert.throws(()=>validateCanonicalSourceContent("src/app/icon.ico",Buffer.concat([validIcoDib(),Buffer.from("unclassified trailing data")])),errorCode("source_binary_unclassified"));
  } finally { await rm(base,{recursive:true,force:true}); }
});

test("bounded structurally valid ICC profiles are accepted in PNG and ordered JPEG APP2 segments", () => {
  const profile=validIccProfile();
  assert.doesNotThrow(()=>validateCanonicalSourceContent("public/profile.png",validPng([pngIccp(profile)])));
  assert.doesNotThrow(()=>validateCanonicalSourceContent("public/profile.jpg",validJpeg([iccJpegSegment(profile.subarray(0,73),1,2),iccJpegSegment(profile.subarray(73),2,2)])));
});

test("JPEG ICC profiles reject malformed, incomplete, duplicate, reordered, oversized, and non-ICC APP2 segments", () => {
  const profile=validIccProfile();
  assert.throws(()=>validateCanonicalSourceContent("public/bad.jpg",validJpeg([iccJpegSegment(Buffer.from("bad"),1,1)])),errorCode("source_binary_unclassified"));
  assert.throws(()=>validateCanonicalSourceContent("public/incomplete.jpg",validJpeg([iccJpegSegment(profile.subarray(0,70),1,2)])),errorCode("source_binary_unclassified"));
  assert.throws(()=>validateCanonicalSourceContent("public/duplicate.jpg",validJpeg([iccJpegSegment(profile.subarray(0,70),1,2),iccJpegSegment(profile.subarray(70),1,2)])),errorCode("source_binary_unclassified"));
  assert.throws(()=>validateCanonicalSourceContent("public/reordered.jpg",validJpeg([iccJpegSegment(profile.subarray(70),2,2),iccJpegSegment(profile.subarray(0,70),1,2)])),errorCode("source_binary_unclassified"));
  assert.throws(()=>validateCanonicalSourceContent("public/non-icc.jpg",validJpeg([jpegSegment(0xe2,Buffer.from("not an ICC profile"))])),errorCode("source_binary_unclassified"));
  assert.throws(()=>validateCanonicalSourceContent("public/late-icc.jpg",validJpeg([], [iccJpegSegment(profile,1,1)])),errorCode("source_binary_unclassified"));
  const oversized=validIccProfile(1_048_577),parts: Buffer[]=[];const chunkBytes=60_000,count=Math.ceil(oversized.length/chunkBytes);
  for(let index=0;index<count;index++)parts.push(iccJpegSegment(oversized.subarray(index*chunkBytes,(index+1)*chunkBytes),index+1,count));
  assert.throws(()=>validateCanonicalSourceContent("public/oversized.jpg",validJpeg(parts)),errorCode("source_binary_unclassified"));
});

test("PNG iCCP validates keyword, method, bounded inflate, ICC structure, and rejects duplicate profiles", () => {
  const profile=validIccProfile();
  assert.throws(()=>validateCanonicalSourceContent("public/bad-method.png",validPng([pngIccp(profile,1)])),errorCode("source_binary_unclassified"));
  const malformed=Buffer.from(profile);malformed.write("nope",36,"ascii");
  assert.throws(()=>validateCanonicalSourceContent("public/bad-profile.png",validPng([pngIccp(malformed)])),errorCode("source_binary_unclassified"));
  assert.throws(()=>validateCanonicalSourceContent("public/duplicate-profile.png",validPng([pngIccp(profile),pngIccp(profile)])),errorCode("source_binary_unclassified"));
  assert.throws(()=>validateCanonicalSourceContent("public/large-compressed.png",validPng([pngIccp(profile,0,Buffer.alloc(1_048_577,1))])),errorCode("source_binary_unclassified"));
  assert.throws(()=>validateCanonicalSourceContent("public/inflate-limit.png",validPng([pngIccp(Buffer.alloc(1_048_577))])),errorCode("source_binary_unclassified"));
  const badTagTable=Buffer.from(profile);badTagTable.writeUInt32BE(0xfffffff0,136);
  assert.throws(()=>validateCanonicalSourceContent("public/bad-tag-table.png",validPng([pngIccp(badTagTable)])),errorCode("source_binary_unclassified"));
});

test("C2PA PNG support accepts bounded JUMBF stores and rejects malformed, oversized, duplicate, or late stores with owner guidance", () => {
  const store = c2paStore();
  assert.doesNotThrow(() => validateCanonicalSourceContent("public/credentials.png", validPng([pngChunk("caBX", store)])));

  const malformed = Buffer.from(store); malformed.writeUInt32BE(0xfffffff0, 0);
  const cases: Array<[string, Buffer, string]> = [
    ["public/malformed.png", validPng([pngChunk("caBX", malformed)]), "c2pa_container_invalid"],
    ["public/oversized.png", validPng([pngChunk("caBX", Buffer.alloc(1_048_577, 1))]), "c2pa_payload_oversized"],
    ["public/duplicate.png", validPng([pngChunk("caBX", store), pngChunk("caBX", store)]), "c2pa_container_invalid"],
    ["public/late.png", validPng([], [pngChunk("caBX", store)]), "c2pa_container_invalid"],
  ];
  for (const [path, bytes, reason] of cases) {
    assert.throws(() => validateCanonicalSourceContent(path, bytes), error => {
      assert.ok(error instanceof WorkspaceExportError);
      assert.equal(error.code, "source_binary_unclassified");
      assert.equal(error.metadata.relativePath, path);
      assert.equal(error.metadata.detectedFormat, "png");
      assert.equal(error.metadata.binaryFailure, reason);
      assert.equal(error.metadata.recommendedOwnerAction, "review_c2pa_asset_without_stripping_credentials");
      const diagnostic = workspaceExportDiagnostic(error);
      assert.equal(diagnostic.file, path);
      assert.equal(diagnostic.detectedFormat, "png");
      assert.equal(diagnostic.failureReason, reason);
      assert.match(diagnostic.recommendedOwnerAction ?? "", /do not strip or rewrite/i);
      assert.equal(diagnostic.beforeClaim, true);
      assert.equal(diagnostic.providerCouldHaveBeenReached, false);
      assert.equal(diagnostic.dockerCouldHaveBeenReached, false);
      return true;
    });
  }

  const badCrc = Buffer.from(validPng([pngChunk("caBX", store)])); const caBxType = badCrc.indexOf(Buffer.from("caBX")); badCrc[caBxType + 4 + badCrc.readUInt32BE(caBxType - 4)] ^= 1;
  assert.throws(() => validateCanonicalSourceContent("public/bad-crc.png", badCrc), error => error instanceof WorkspaceExportError && error.metadata.binaryFailure === "c2pa_container_invalid");
});

test("approved replacement assets are accepted while unsupported metadata and ICO layouts retain precise owner diagnostics", async () => {
  const childrenPath = "public/children-reading.png", logoPath = "public/logo.png", iconPath = "src/app/favicon.ico";
  const children = await readFile(childrenPath), logo = await readFile(logoPath), icon = await readFile(iconPath);
  assert.doesNotThrow(() => validateCanonicalSourceContent(childrenPath, children));
  assert.doesNotThrow(() => validateCanonicalSourceContent(logoPath, logo));
  assert.doesNotThrow(() => validateCanonicalSourceContent(iconPath, icon));

  const unsupportedMetadata = validPng([pngChunk("eXIf", Buffer.from("synthetic exif"))]);
  assert.throws(() => validateCanonicalSourceContent(childrenPath, unsupportedMetadata), error => {
    assert.ok(error instanceof WorkspaceExportError);
    assert.equal(error.metadata.relativePath, childrenPath);
    assert.equal(error.metadata.detectedFormat, "png");
    assert.equal(error.metadata.binaryFailure, "unsupported_metadata");
    assert.equal(error.metadata.metadataType, "eXIf");
    assert.equal(error.metadata.recommendedOwnerAction, "review_unsupported_metadata_without_removing_it");
    const diagnostic = workspaceExportDiagnostic(error);
    assert.equal(diagnostic.file, childrenPath);
    assert.equal(diagnostic.detectedFormat, "png");
    assert.equal(diagnostic.failureReason, "unsupported_metadata");
    assert.equal(diagnostic.metadataType, "eXIf");
    assert.match(diagnostic.recommendedOwnerAction ?? "", /preserve the original metadata/i);
    return true;
  });

  const unsupportedIco = validIcoDib();
  unsupportedIco.writeUInt32LE(17, 42);
  const unsupportedIconPath = "src/app/unsupported-layout.ico";
  assert.throws(() => validateCanonicalSourceContent(unsupportedIconPath, unsupportedIco), error => {
    assert.ok(error instanceof WorkspaceExportError);
    assert.equal(error.metadata.relativePath, unsupportedIconPath);
    assert.equal(error.metadata.detectedFormat, "ico");
    assert.equal(error.metadata.binaryFailure, "ico_dib_layout_unsupported");
    assert.equal(error.metadata.recommendedOwnerAction, "provide_standard_ico_encoding");
    const diagnostic = workspaceExportDiagnostic(error);
    assert.equal(diagnostic.file, unsupportedIconPath);
    assert.equal(diagnostic.detectedFormat, "ico");
    assert.equal(diagnostic.failureReason, "ico_dib_layout_unsupported");
    assert.match(diagnostic.recommendedOwnerAction ?? "", /standard ICO/i);
    return true;
  });
  assert.doesNotThrow(() => validateCanonicalSourceContent("src/app/standard.ico", validIcoDib()));
});

test("next-env.d.ts is canonical source and the runner overlay is not part of provider-controlled source", async () => {
  const base=await mkdtemp(join(tmpdir(),"medimori-next-env-source-")),root=join(base,"repo");
  try {
    await repo(root,{"next-env.d.ts":"declare const runnerInput: true;\n","docs/readme.md":"tracked"});
    const first=await resolveCanonicalSourceManifest(root);assert.ok(first.files.some(file=>file.path==="next-env.d.ts"));
    await writeFile(join(root,"next-env.d.ts"),"declare const runnerInput: false;\n");await commit(root);
    const second=await resolveCanonicalSourceManifest(root);assert.notEqual(first.revision,second.revision);
  } finally { await rm(base,{recursive:true,force:true}); }
});
