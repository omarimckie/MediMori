import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFreshExport, diagnoseFreshExport, DockerWorkspace, preflightEngineeringScratch } from "./workspace";
import { WorkspaceExportError, workspaceExportCodes } from "./workspace-export-diagnostics";
import { verifyCiEvidence } from "./ci-evidence";
import { buildBoundedReplacementContext } from "./replacement-anchors";
import { initializeNextEnvPrivateOverlayCommand, validationVolumeMountArgs } from "./validation-volume-policy";
const plan={summary:"Document change",files:["docs/demo.md"],validations:["lint","typecheck","security:check"],operations:[]};
const image=`example/worker@sha256:${"a".repeat(64)}`;
const dependencyVolume="medimori-validation-dependencies";
const owner={taskId:"11111111-1111-4111-8111-111111111111",runId:"22222222-2222-4222-8222-222222222222"};
test("production validation routes only next-env.d.ts through private writable storage",()=>{
 const setup=initializeNextEnvPrivateOverlayCommand;
 assert.match(setup,/test -f \/workspace\/next-env\.d\.ts/);assert.match(setup,/test ! -L \/workspace\/next-env\.d\.ts/);
 assert.match(setup,/cp \/workspace\/next-env\.d\.ts \/private\/engineering-next-env\.d\.ts/);
 assert.match(setup,/ln -s private\/engineering-next-env\.d\.ts \/workspace\/next-env\.d\.ts/);
 assert.ok(setup.indexOf("chown -R")<setup.indexOf("ln -s private/engineering-next-env.d.ts"));
 assert.equal((setup.match(/ln -s private\/engineering-next-env\.d\.ts/g)??[]).length,1);
 const mounts=validationVolumeMountArgs({source:"owned-source",cache:"owned-cache",uploads:"owned-uploads",private:"owned-private",dependencies:"immutable-dependencies"}).join(" ");
 assert.match(mounts,/source=owned-source,target=\/workspace,readonly/);assert.match(mounts,/source=immutable-dependencies,target=\/workspace\/node_modules,readonly/);
 assert.match(mounts,/source=owned-private,target=\/workspace\/private(?!,readonly)/);assert.match(mounts,/source=owned-cache,target=\/workspace\/\.next/);assert.match(mounts,/source=owned-uploads,target=\/workspace\/public\/marketing-uploads/);
 assert.doesNotMatch(mounts,/target=\/workspace(?: |$)(?!,readonly)/);
});
test("validation ignores generated next-env output when binding source and proposal revisions",async()=>{
 const root=await mkdtemp(join(tmpdir(),"medimori-next-env-revision-"));
 try{
  await mkdir(join(root,"docs"));await writeFile(join(root,"docs/demo.md"),"stable approved source");await writeFile(join(root,"next-env.d.ts"),"declare const initial: true;");
  const w=await DockerWorkspace.create(root,plan,image,dependencyVolume,owner);const before=await w.snapshot();
  await writeFile(join(root,"next-env.d.ts"),"declare const runtimeGenerated: true;");
  assert.equal((await w.snapshot()).revision,before.revision);
 }finally{await rm(root,{recursive:true,force:true});}
});
test("scratch preflight checks the configured filesystem and refuses an export outside it",async()=>{
 const parent=await mkdtemp(join(tmpdir(),"medimori-scratch-preflight-"));const source=join(parent,"source"),scratch=join(parent,"scratch"),exports=join(scratch,"exports"),outside=join(parent,"outside");
 try{
  await mkdir(source);await mkdir(exports,{recursive:true});await mkdir(outside);await writeFile(join(source,"doc.md"),"bounded source");
  const result=await preflightEngineeringScratch(source,scratch,exports,BigInt(0));assert.equal(result.sourceBytes,BigInt(Buffer.byteLength("bounded source")));assert.ok(result.availableBytes>=result.requiredBytes);
  await assert.rejects(preflightEngineeringScratch(source,scratch,outside,BigInt(0)),/Invalid engineering scratch configuration/);
  await assert.rejects(preflightEngineeringScratch(source,join(parent,"missing"),exports,BigInt(0)));
 }finally{await rm(parent,{recursive:true,force:true});}
});
test("offline production export diagnostic is deterministic, sanitized, source-read-only, and ownership-scoped",async()=>{
 const root=await mkdtemp(join(tmpdir(),"medimori-export-diagnostic-"));const source=join(root,"checkout"),scratch=join(root,"scratch"),exports=join(scratch,"exports");
 try{
  await mkdir(join(source,"docs"),{recursive:true});await mkdir(exports,{recursive:true});await mkdir(join(source,"node_modules"),{recursive:true});
  await writeFile(join(source,"docs/readme.md"),"bounded documentation source");await writeFile(join(source,".env.example"),"DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require\n");
  await writeFile(join(source,".env.private"),"must not be exported");await writeFile(join(source,"node_modules/ignored.js"),"must not be exported");
  await writeFile(join(exports,"unrelated.keep"),"leave this unrelated scratch file alone");
  const original=await readFile(join(source,"docs/readme.md"),"utf8");
  const first=await diagnoseFreshExport(source,scratch,exports),second=await diagnoseFreshExport(source,scratch,exports);
  assert.equal(first.revision,second.revision);assert.equal(first.sourceUnchanged,true);assert.equal(first.cleanup,"owned_diagnostic_directory_removed");assert.equal(first.sensitiveExclusions,"verified");assert.equal(first.fileCount,2);
  assert.equal(await readFile(join(source,"docs/readme.md"),"utf8"),original);assert.equal(await readFile(join(exports,"unrelated.keep"),"utf8"),"leave this unrelated scratch file alone");
  assert.deepEqual((await readdir(exports)),["unrelated.keep"]);
 }finally{await rm(root,{recursive:true,force:true});}
});
test("export diagnostic fails closed on credential-shaped source content and preserves unrelated scratch",async()=>{
 const root=await mkdtemp(join(tmpdir(),"medimori-export-sensitive-"));const source=join(root,"checkout"),scratch=join(root,"scratch"),exports=join(scratch,"exports");
 try{
  await mkdir(join(source,"docs"),{recursive:true});await mkdir(exports,{recursive:true});await writeFile(join(source,"docs/sensitive.fixture"),["postgresql","://","fake-user:fake-password@host/db"].join(""));await writeFile(join(exports,"keep.txt"),"keep");
  await assert.rejects(diagnoseFreshExport(source,scratch,exports),error=>error instanceof WorkspaceExportError&&error.code==="export_sensitive_content_rejected"&&/^[a-f0-9]{16}$/.test(error.metadata.relativePathHash??"")&&!error.message.includes(root));
  assert.equal(await readFile(join(exports,"keep.txt"),"utf8"),"keep");assert.deepEqual(await readdir(exports),["keep.txt"]);
 }finally{await rm(root,{recursive:true,force:true});}
});
test("export setup errors use bounded root categories and no raw paths",async()=>{
 const root=await mkdtemp(join(tmpdir(),"medimori-export-categories-"));const source=join(root,"checkout"),scratch=join(root,"scratch"),exports=join(scratch,"exports");
 try{
  await mkdir(source);await mkdir(exports,{recursive:true});
  await assert.rejects(createFreshExport(join(root,"missing"),exports),error=>error instanceof WorkspaceExportError&&error.code==="source_root_unavailable"&&!error.message.includes(root));
  await assert.rejects(createFreshExport(source,join(root,"missing-export")),error=>error instanceof WorkspaceExportError&&error.code==="export_root_unavailable"&&!error.message.includes(root));
  assert.ok(workspaceExportCodes.includes("source_entry_unsupported"));assert.ok(workspaceExportCodes.includes("export_cleanup_failed"));
 }finally{await rm(root,{recursive:true,force:true});}
});
test("production exporter rejects symlink entries without exposing their paths",async t=>{
 const root=await mkdtemp(join(tmpdir(),"medimori-export-symlink-"));const source=join(root,"checkout"),scratch=join(root,"scratch"),exports=join(scratch,"exports");
 try{
  await mkdir(source);await mkdir(exports,{recursive:true});await writeFile(join(root,"outside.txt"),"outside");
  try{await symlink(join(root,"outside.txt"),join(source,"linked.txt"));}catch(error){if(error&&typeof error==="object"&&"code" in error&&["EPERM","EACCES","ENOTSUP"].includes(String(error.code))){t.skip("host policy does not permit creating a test symlink");return;}throw error;}
  await assert.rejects(createFreshExport(source,exports),error=>error instanceof WorkspaceExportError&&error.code==="source_symlink_rejected"&&/^[a-f0-9]{16}$/.test(error.metadata.relativePathHash??"")&&!error.message.includes(root));
  assert.equal(await readFile(join(root,"outside.txt"),"utf8"),"outside");assert.deepEqual(await readdir(exports),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});
test("export rejects secrets; tree revision binds protected files; anchor application rejects scope and stale revision",async()=>{
 const root=await mkdtemp(join(tmpdir(),"medimori-export-"));
 try{
  const source="Before begins a sufficiently descriptive exact replacement paragraph with deterministic matching context for the approved documentation change.";
  await mkdir(join(root,"docs"));await writeFile(join(root,"docs/demo.md"),source);await writeFile(join(root,"package.json"),"{}");
  await assert.rejects(DockerWorkspace.create(root,plan,"image:latest",dependencyVolume,owner));
  const w=await DockerWorkspace.create(root,plan,image,dependencyVolume,owner);const before=await w.snapshot();
  const anchor=buildBoundedReplacementContext(plan,before).anchors[0];assert.ok(anchor);
  const evidence=await w.apply([{anchor,replacement:"After"}],before.revision);const after=await w.snapshot();assert.notEqual(before.revision,after.revision);
  assert.equal(evidence.schemaVersion,1);assert.deepEqual(evidence.approvedPaths,["docs/demo.md"]);assert.equal(evidence.replacementCount,1);assert.equal(evidence.workspaceRevision,after.revision);
  assert.match(evidence.files[0].beforeSha256,/^[a-f0-9]{64}$/);assert.match(evidence.files[0].afterSha256,/^[a-f0-9]{64}$/);assert.equal(evidence.files[0].removedLines,1);assert.equal(evidence.files[0].addedLines,1);
  assert.equal(JSON.stringify(evidence).includes(source),false);assert.equal(JSON.stringify(evidence).includes("After"),false);
  await assert.rejects(w.apply([{anchor,replacement:"stale"}],before.revision));
  await assert.rejects(w.apply([{anchor:{...anchor,path:"package.json"},replacement:"malicious"}],after.revision));
  await assert.rejects(w.validate(["npm","run","lint; deploy"],after.revision,new AbortController().signal));
  await writeFile(join(root,"package.json"),'{"changed":true}');await assert.rejects(w.snapshot());
  await writeFile(join(root,".env.local"),"must never enter context");await assert.rejects(DockerWorkspace.create(root,plan,image,dependencyVolume,owner));
 }finally{await rm(root,{recursive:true,force:true});}
});
test("CI signature is bound to run, repair cycle, revision, command, expiry and pinned signing key",()=>{
 const {privateKey,publicKey}=generateKeyPairSync("ed25519");const pinned=publicKey.export({type:"spki",format:"pem"}).toString();
 const expected={runId:"run",cycle:1,revision:"a".repeat(40)};const now=100000;
 const evidence={...expected,command:"lint",outcome:"passed",receipt:"ci-1",expiresAt:now+10000};const payload=JSON.stringify(evidence);const signature=sign(null,Buffer.from(payload),privateKey).toString("base64");
 assert.equal(verifyCiEvidence(payload,signature,pinned,expected,now).receipt,"ci-1");
 for(const altered of [{...expected,runId:"other"},{...expected,cycle:2},{...expected,revision:"b".repeat(40)}])assert.throws(()=>verifyCiEvidence(payload,signature,pinned,altered,now));
 assert.throws(()=>verifyCiEvidence(payload,signature,pinned,expected,now+10001));
 assert.throws(()=>verifyCiEvidence(payload.replace('"passed"','"failed"'),signature,pinned,expected,now));
});
