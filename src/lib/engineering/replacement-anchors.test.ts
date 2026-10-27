import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBoundedReplacementContext, issuedAnchorId, literalMatchCountUpToTwo, replacementProposalFormat, resolveReplacementProposal, sha256, type IssuedAnchor } from "./replacement-anchors";
import { DockerWorkspace } from "./workspace";

const plan = { summary: "Clarify deterministic exact replacement documentation", files: ["docs/demo.md"], operations: [], validations: ["lint", "typecheck", "security:check"] };
const image = "example/worker@sha256:" + "a".repeat(64);
const dependencies = "medimori-validation-dependencies";
const owner = { taskId: "11111111-1111-4111-8111-111111111111", runId: "22222222-2222-4222-8222-222222222222" };
const repeated = "This repeated documentation paragraph explains deterministic exact replacement matching with enough surrounding words to provide a useful literal anchor for controlled engineering work.";
const unique = "This unique documentation paragraph clarifies the revision-bound anchor protocol while preserving exact whitespace and deterministic replacement behavior for the approved worker.";
const boundedReplacementDocumentationFixture = `# Engineering agent\n\nThe engineering agent follows bounded replacement protocol rules for approved documentation changes.\n\n### M2C.6F host-issued unique anchors\n\nThe host constructs useful literal anchors from approved source context before provider dispatch. Matching is case-sensitive and whitespace-exact, and expected text must appear exactly once as a literal substring. Each issued anchor binds the approved path, source revision, and content hash so the host can verify the exact target before applying a bounded replacement.\n\nThe model selects an issued anchor ID and supplies replacement content only. The host verifies scope, revision, content hash, uniqueness, and overlap immediately before writing. If no suitable unique anchor can be issued, the proposal fails closed without another provider call.\n\n### Validation evidence\n\nValidation results and durable evidence are bounded and do not include unrestricted provider output or source contents.`;

function anchorFor(path: string, revision: string, content: string): IssuedAnchor {
  const contentSha256 = sha256(content);
  return { id: issuedAnchorId(path, revision, contentSha256), path, revision, contentSha256, content };
}

test("catalog excludes repeated candidates, issues bounded useful unique anchors, and binds IDs", () => {
  const revision = "a".repeat(40);
  const source = repeated + "\n\n" + repeated + "\n\n" + unique;
  const bundle = buildBoundedReplacementContext(plan, { revision, changedFiles: [], files: { "docs/demo.md": source } });
  const providerContext = JSON.parse(bundle.text) as { files: Record<string, string>; replacementAnchors: Array<{ id: string; path: string; text: string }> };
  assert.ok(bundle.anchors.length > 0);
  assert.ok(bundle.anchors.length <= 24);
  assert.ok(Buffer.byteLength(bundle.text) <= 24000);
  assert.ok(!bundle.anchors.some(anchor => anchor.content === repeated));
  for (const anchor of bundle.anchors) {
    assert.ok(Buffer.byteLength(anchor.content) >= 96);
    assert.ok((anchor.content.match(/[a-z0-9]{2,}/gi)?.length ?? 0) >= 8);
    assert.equal(literalMatchCountUpToTwo(source, anchor.content), 1);
    assert.equal(anchor.id, issuedAnchorId(anchor.path, revision, anchor.contentSha256));
    assert.equal(providerContext.files[anchor.path].includes(anchor.content), true);
  }
  assert.ok(providerContext.replacementAnchors.every(anchor => !("contentSha256" in anchor) && !("revision" in anchor)));
});

test("unique issued anchor resolves and applies with durable hash-only evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "m2c6f-anchor-apply-"));
  try {
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "docs/demo.md"), unique);
    const workspace = await DockerWorkspace.create(root, plan, image, dependencies, owner);
    const snapshot = await workspace.snapshot();
    const anchor = buildBoundedReplacementContext(plan, snapshot).anchors.find(item => item.content === unique);
    assert.ok(anchor);
    const format = replacementProposalFormat([anchor]);
    assert.deepEqual(format.schema.properties.replacements.items.properties.anchorId.enum, [anchor.id]);
    const resolved = resolveReplacementProposal(plan, JSON.stringify({ replacements: [{ anchorId: anchor.id, replacementText: "Updated approved documentation text." }] }), [anchor], snapshot.revision);
    const evidence = await workspace.apply(resolved, snapshot.revision);
    assert.equal(await readFile(join(root, "docs/demo.md"), "utf8"), "Updated approved documentation text.");
    assert.deepEqual(evidence.approvedPaths, ["docs/demo.md"]);
    assert.equal(evidence.replacementCount, 1);
    assert.equal(evidence.replacements[0].expectedSha256, anchor.contentSha256);
    assert.match(evidence.replacements[0].changeSha256, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(evidence).includes(unique), false);
    assert.equal(JSON.stringify(evidence).includes("Updated approved documentation text."), false);
    await workspace.dispose();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unknown IDs, stale revisions, out-of-scope paths, and content-hash mismatches are rejected", () => {
  const revision = "b".repeat(40);
  const anchor = anchorFor("docs/demo.md", revision, unique);
  const proposal = (anchorId: string) => JSON.stringify({ replacements: [{ anchorId, replacementText: "safe replacement" }] });
  assert.throws(() => resolveReplacementProposal(plan, proposal("f".repeat(64)), [anchor], revision), /rejected/);
  assert.throws(() => resolveReplacementProposal(plan, proposal(anchor.id), [anchor], "c".repeat(40)), /rejected/);
  const wrongPath = anchorFor("src/worker.ts", revision, unique);
  assert.throws(() => resolveReplacementProposal(plan, proposal(wrongPath.id), [wrongPath], revision), /rejected/);
  const wrongContent = { ...anchor, content: unique + " altered" };
  assert.throws(() => resolveReplacementProposal(plan, proposal(anchor.id), [wrongContent], revision), /rejected/);
  assert.throws(() => resolveReplacementProposal(plan, JSON.stringify({ replacements: [{ anchorId: anchor.id, expectedText: unique, replacementText: "safe replacement" }] }), [anchor], revision), /rejected/);
});

test("apply rechecks uniqueness against the complete current file before writing", async () => {
  const root = await mkdtemp(join(tmpdir(), "m2c6f-anchor-ambiguous-"));
  try {
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "docs/demo.md"), unique);
    const workspace = await DockerWorkspace.create(root, plan, image, dependencies, owner);
    const original = await workspace.snapshot();
    const anchor = buildBoundedReplacementContext(plan, original).anchors.find(item => item.content === unique);
    assert.ok(anchor);
    await writeFile(join(root, "docs/demo.md"), unique + "\n\n" + unique);
    // Simulate a file change between the workspace revision check and final literal-count check.
    workspace.snapshot = async () => ({ ...original, files: { ...original.files } });
    await assert.rejects(workspace.apply([{ anchor, replacement: "unsafe" }], original.revision), /ambiguous/);
    assert.equal(await readFile(join(root, "docs/demo.md"), "utf8"), unique + "\n\n" + unique);
    await workspace.dispose();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("overlapping unique anchors are rejected before any write", async () => {
  const root = await mkdtemp(join(tmpdir(), "m2c6f-anchor-overlap-"));
  try {
    await mkdir(join(root, "docs"), { recursive: true });
    const source = unique + " Additional deterministic context words complete the overlapping anchor fixture safely.";
    await writeFile(join(root, "docs/demo.md"), source);
    const workspace = await DockerWorkspace.create(root, plan, image, dependencies, owner);
    const snapshot = await workspace.snapshot();
    const left = source.slice(0, 130);
    const right = source.slice(70, 210);
    const anchors = [anchorFor("docs/demo.md", snapshot.revision, left), anchorFor("docs/demo.md", snapshot.revision, right)];
    assert.equal(literalMatchCountUpToTwo(source, left), 1);
    assert.equal(literalMatchCountUpToTwo(source, right), 1);
    await assert.rejects(workspace.apply(anchors.map(anchor => ({ anchor, replacement: "replacement" })), snapshot.revision), /overlap/);
    assert.equal(await readFile(join(root, "docs/demo.md"), "utf8"), source);
    await workspace.dispose();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("no useful unique anchor is issued for short source context", () => {
  const bundle = buildBoundedReplacementContext(plan, { revision: "d".repeat(40), changedFiles: [], files: { "docs/demo.md": "A tiny paragraph." } });
  assert.deepEqual(bundle.anchors, []);
});

test("Attempt 5 catalog distributes useful unique anchors into its requested M2C.6F section", async () => {
  const revision="0d450233768b056dad1d275038b38221e075101a";
  const path="docs/engineering-agent.md";
  const source=boundedReplacementDocumentationFixture;
  const approvedPlan={
    summary:"Clarify the bounded replacement protocol documentation.\n1. Inspect the existing bounded replacement documentation.\n2. Add a concise clarification that matching is case-sensitive and whitespace-exact.\n3. State that expected text must appear exactly once as a literal substring.\n4. Modify only docs/engineering-agent.md.\n5. Make no implementation or behavioral changes.\n6. Run the required validation checks and self-review.",
    files:[path],operations:[],validations:["test","lint","typecheck","build","security:check","test:engineering"],
  };
  const bundle=buildBoundedReplacementContext(approvedPlan,{revision,changedFiles:[],files:{[path]:source}});
  const providerContext=JSON.parse(bundle.text) as { files:Record<string,string>; replacementAnchors:Array<{id:string;path:string;text:string}> };
  assert.ok(bundle.anchors.length>0,"the approved file must have a bounded anchor catalog");
  assert.ok(bundle.anchors.length<=24);
  assert.ok(Buffer.byteLength(bundle.text)<=24000);
  const lines=source.split("\n");
  const targetStart=lines.findIndex(line=>/^### M2C\.6F host-issued unique anchors/i.test(line));
  assert.ok(targetStart>=0,"the approved documentation section must be present");
  let targetEnd=lines.findIndex((line,index)=>index>targetStart&&/^#{1,3}\s/.test(line));
  if(targetEnd<0)targetEnd=lines.length;
  const anchorLines:number[]=[];
  for(const anchor of bundle.anchors){
    assert.equal(anchor.path,path);
    assert.equal(anchor.revision,revision);
    assert.equal(literalMatchCountUpToTwo(source,anchor.content),1);
    assert.equal(anchor.contentSha256,sha256(anchor.content));
    assert.equal(anchor.id,issuedAnchorId(path,revision,anchor.contentSha256));
    assert.ok(providerContext.files[path].includes(anchor.content));
    anchorLines.push(source.slice(0,source.indexOf(anchor.content)).split("\n").length-1);
  }
  assert.equal(anchorLines.some(line=>line>=targetStart&&line<targetEnd),true,"the distributed catalog should include useful source context from the requested M2C.6F section");
  assert.ok(Buffer.byteLength(JSON.stringify(providerContext.replacementAnchors))<=6000);
});

test("exact documentation request passes the bounded proposal and evidence pipeline offline", async () => {
  const path="docs/engineering-agent.md";
  const source=boundedReplacementDocumentationFixture;
  const approvedPlan={
    summary:"Clarify the bounded replacement protocol documentation. Inspect the existing bounded replacement documentation. Add a concise clarification that matching is case-sensitive and whitespace-exact. State that expected text must appear exactly once as a literal substring. Modify only docs/engineering-agent.md. Make no implementation or behavioral changes. Run required validation checks and self-review.",
    files:[path],operations:[],validations:["test","lint","typecheck","build","security:check","test:engineering"],
  };
  const root=await mkdtemp(join(tmpdir(),"m2c6g-target-proposal-"));
  let workspace:DockerWorkspace|undefined;
  try {
    await mkdir(join(root,"docs"),{recursive:true});
    await writeFile(join(root,path),source,"utf8");
    workspace=await DockerWorkspace.create(root,approvedPlan,image,dependencies,{taskId:randomUUID(),runId:randomUUID()});
    const snapshot=await workspace.snapshot();
    const bundle=buildBoundedReplacementContext(approvedPlan,snapshot);
    const lines=source.split("\n");
    const targetStart=lines.findIndex(line=>/^### M2C\.6F host-issued unique anchors/i.test(line));
    let targetEnd=lines.findIndex((line,index)=>index>targetStart&&/^#{1,3}\s/.test(line));
    if(targetEnd<0)targetEnd=lines.length;
    const anchor=bundle.anchors.find(item=>{
      const line=source.slice(0,source.indexOf(item.content)).split("\n").length-1;
      return line>=targetStart&&line<targetEnd;
    });
    assert.ok(anchor,"the exact task must have an issued anchor in its requested documentation section");
    const format=replacementProposalFormat(bundle.anchors);
    assert.ok(format.schema.properties.replacements.items.properties.anchorId.enum.includes(anchor.id));
    const replacementText=`${anchor.content}\n\nMatching is case-sensitive and whitespace-exact; expected text must appear exactly once as a literal substring.`;
    const proposalText=JSON.stringify({replacements:[{anchorId:anchor.id,replacementText}]});
    const proposal=resolveReplacementProposal(approvedPlan,proposalText,bundle.anchors,snapshot.revision);
    const evidence=await workspace.apply(proposal,snapshot.revision);
    const resulting=await readFile(join(root,path),"utf8");
    assert.ok(resulting.includes("Matching is case-sensitive and whitespace-exact; expected text must appear exactly once as a literal substring."));
    assert.deepEqual(evidence.approvedPaths,[path]);
    assert.equal(evidence.replacementCount,1);
    assert.equal(evidence.files.length,1);
    assert.equal(evidence.files[0].path,path);
    assert.equal(evidence.files[0].beforeSha256,sha256(source));
    assert.equal(evidence.files[0].afterSha256,sha256(resulting));
    assert.match(evidence.workspaceRevision,/^[a-f0-9]{40}$/);
    assert.match(evidence.replacements[0].changeSha256,/^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(evidence).includes(anchor.content),false);
    assert.equal(JSON.stringify(evidence).includes(replacementText),false);
  } finally {
    await workspace?.dispose();
    await rm(root,{recursive:true,force:true});
  }
});
