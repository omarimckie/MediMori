import { test } from "node:test";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { getSql } from "@/lib/db";
import { actOnTask as storeActOnTask, approvePreparedAttempt, authorizePreparedExecution, createTask, prepareInitialAttempt, recordRunEvidence, taskHistory } from "./store";
import { commandArgs, defaultRates, executablePlan, pricing, quote, workerLimits } from "./worker-policy";
import { context, edits, extractResponsesOutputText, openaiGenerate, replacementProposalFormat, replacementProposalSchema, runWorker, WorkerFailure, WorkerExitError, type Ingress, type IsolatedWorkspace, type ProposalEvidence } from "./worker";
import { authorizationDurationMs, terminalizationReserveMs, validationGateMaxMs } from "./worker-runtime-budget";
import { createFreshExport, exportedWorkspaceRevision } from "./workspace";
import { DockerCleanupError } from "./docker-ownership";
import { buildBoundedReplacementContext } from "./replacement-anchors";
import { ValidationPreparationError } from "./validation-diagnostics";

function gitFixture(root:string,...args:string[]){execFileSync("git",["-C",root,...args],{stdio:"ignore",windowsHide:true});}
async function commitGitFixture(root:string){gitFixture(root,"add","-A");gitFixture(root,"-c","user.name=Fixture","-c","user.email=fixture@example.invalid","commit","--allow-empty","-qm","fixture");}
const plan = { summary: "Small isolated change", files: ["README.md"], operations: [], validations: ["test","test:engineering","lint","typecheck","build","security:check"] };
const revision = "a".repeat(40);
const testTargetSha = "c".repeat(40);
const testSourceRevision = async () => revision;
const readTestPreimages = async (_sha: string, paths: readonly string[]) => Object.fromEntries(paths.map(path => [path,"d".repeat(64)]));
const actOnTask = (id: string, version: number, action: string, value: unknown, actor: string, database: ReturnType<typeof getSql>) => storeActOnTask(id,version,action,value,actor,database);
const richSource = "Original documentation paragraph provides deterministic replacement context with enough distinct words for a safe exact literal anchor during worker tests.";
const anchorFor = (source=richSource) => buildBoundedReplacementContext(plan,{revision,changedFiles:[],files:{"README.md":source}}).anchors[0]!;
function proposalFor(body:Record<string,unknown>, replacementText="updated") {
  const request=JSON.parse(String(body.input)) as {repository:string};
  const repo=JSON.parse(request.repository) as {replacementAnchors:Array<{id:string}>};
  return JSON.stringify({replacements:[{anchorId:repo.replacementAnchors[0].id,replacementText}]});
}
const reservation = (key: string, input = 100, output = 100, model = "gpt-6-luna") => ({ key, hash: "b".repeat(64), inputBound: input, outputBound: output, tokens: input+output, micros: quote(input, output, defaultRates[model as keyof typeof defaultRates]), model, rates: defaultRates[model as keyof typeof defaultRates] });
const proposalEvidence = (workspaceRevision=revision): ProposalEvidence => ({schemaVersion:1,approvedPaths:["README.md"],replacementCount:1,files:[{path:"README.md",beforeSha256:"c".repeat(64),afterSha256:"d".repeat(64),beforeBytes:8,afterBytes:7,removedLines:1,addedLines:1}],replacements:[{path:"README.md",expectedSha256:"e".repeat(64),replacementSha256:"f".repeat(64),changeSha256:"1".repeat(64)}],workspaceRevision});
async function fixture() {
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED="true";
  process.env.ENGINEERING_WORKER_ENABLED="true";
  const db = new PGlite();
  await db.exec("CREATE ROLE medimori_engineering_2c_worker");
  await db.exec(await readFile(new URL("../../../sql/engineering-schema.sql", import.meta.url),"utf8"));
  await db.exec(await readFile(new URL("../../../sql/engineering-worker.sql", import.meta.url),"utf8"));
  await db.exec(await readFile(new URL("../../../sql/engineering-lineage.sql", import.meta.url),"utf8"));
  await db.exec(await readFile(new URL("../../../sql/engineering-initial-attempt-preparation.sql", import.meta.url),"utf8"));
  await db.exec(await readFile(new URL("../../../sql/engineering-source-binding.sql", import.meta.url),"utf8"));
  await db.exec(await readFile(new URL("../../../sql/engineering-source-selection-policy.sql", import.meta.url),"utf8"));
  await db.exec(await readFile(new URL("../../../sql/engineering-approval-execution-separation.sql", import.meta.url),"utf8"));
  await db.exec(await readFile(new URL("../../../sql/engineering-prepared-subject-supersession.sql", import.meta.url),"utf8"));
  const sql = (async (strings: TemplateStringsArray,...values: unknown[]) => (await db.query(strings.reduce((s,p,i)=>s+(i?`$${i}`:"")+p,""),values)).rows) as unknown as ReturnType<typeof getSql>;
  let task=await createTask("Synthetic 2B fixture","human","a8888888-8888-4888-8888-888888888888",sql);
  task=await actOnTask(task.id,task.version,"transition","analyzing","human",sql);
  const approvalPlan={summary:"Bounded README proof",files:["README.md"],operations:[],validations:["test","lint","typecheck","build","security:check","test:engineering"]};
  task=await actOnTask(task.id,task.version,"plan",approvalPlan,"human",sql);
  await prepareInitialAttempt(task.id,task.version,randomUUID(),"human",sql,async()=>testTargetSha,readTestPreimages,testSourceRevision);
  task=(await taskHistory(task.id,sql)).task!;
  const prepared=(await sql`SELECT attempt_id FROM engineering_prepared_attempts WHERE task_id=${task.id}::uuid`)[0] as {attempt_id:string};
  await approvePreparedAttempt(task.id,task.version,prepared.attempt_id,"human",sql,async()=>testTargetSha,readTestPreimages,testSourceRevision);
  await authorizePreparedExecution(task.id,task.version,prepared.attempt_id,"human",sql,async()=>testTargetSha,readTestPreimages,testSourceRevision);
  const run=String((await taskHistory(task.id,sql)).runs[0].id);
  const ingress: Ingress=async(op,owner,epoch,data={})=>(await db.query<{result: Record<string,unknown>}>("SELECT engineering_worker($1::uuid,$2,$3,$4,$5::jsonb) result",[run,op,owner,epoch,JSON.stringify(op==="claim"?{preflightRevision:revision,...data}:data)])).rows[0].result;
  task=(await taskHistory(task.id,sql)).task!;
  return {db,sql,task,run,ingress,close:async()=>{await db.close();delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED;delete process.env.ENGINEERING_WORKER_ENABLED;}};
}
test("fresh export mismatch is safely diagnosed before claim with no lease, reservation, or call", async()=>{
  const f=await fixture();
  try {
    await f.db.exec(`CREATE FUNCTION public.test_source_mismatch_state(p_run uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
      SELECT jsonb_build_object('finishedAt',r.finished_at,'disposition',r.disposition,'leaseOwner',r.lease_owner,'preflightRevision',r.preflight_revision,
        'modelCalls',r.model_calls,'tokens',r.tokens,'costUsd',r.cost_usd,'reservedTokens',r.reserved_tokens,'reservedMicros',r.reserved_micros,
        'callCount',(SELECT count(*) FROM engineering_worker_calls c WHERE c.run_id=r.id),'event',
        (SELECT details FROM engineering_events e WHERE e.task_id=t.id AND e.action='source_revision_mismatch' ORDER BY e.created_at DESC LIMIT 1))
      FROM engineering_runs r JOIN engineering_tasks t ON t.id=r.task_id WHERE r.id=p_run
    $$`);
    await f.db.exec("SET SESSION AUTHORIZATION medimori_engineering_2c_worker");
    const result=await f.db.query<{ok:boolean}>("SELECT engineering_record_source_mismatch($1::uuid,$2) AS ok",[f.run,"b".repeat(40)]);
    assert.equal(result.rows[0].ok,true);
    const state=(await f.db.query("SELECT public.test_source_mismatch_state($1::uuid) AS state",[f.run])).rows[0] as {state:Record<string,unknown>};
    const run=state.state;
    assert.ok(run.finishedAt);assert.equal(run.disposition,"blocked");assert.equal(run.leaseOwner,null);assert.equal(run.preflightRevision,null);
    assert.equal(Number(run.modelCalls),0);assert.equal(Number(run.tokens),0);assert.equal(Number(run.costUsd),0);assert.equal(Number(run.reservedTokens),0);assert.equal(Number(run.reservedMicros),0);
    assert.equal(Number(run.callCount),0);
    const event=run.event as Record<string,unknown>;
    assert.equal(event.beforeClaim,true);
    assert.match(String(event.expectedSourceRevision),/^[a-f0-9]{40}$/);
    assert.match(String(event.actualSourceRevision),/^[a-f0-9]{40}$/);
  } finally { await f.close(); }
});
test("worker policy denies protected scope, missing validation, tools, unsafe rates and oversized context",()=>{
  assert.equal(workerLimits.outputTokens,8192);
  assert.ok(workerLimits.contextTokens+workerLimits.outputTokens<60000);
  assert.deepEqual(executablePlan(plan),plan);
  for(const path of ["src/admin-auth.ts","sql/demo.sql","src/lib/engineering/worker.ts",".env.local","package.json","src/../secret.ts","src/marketing/publish.ts"]) assert.throws(()=>executablePlan({...plan,files:[path]}));
  assert.throws(()=>executablePlan({...plan,validations:["lint"]}));
  assert.throws(()=>executablePlan({...plan,operations:["merge_main"]}));
  assert.throws(()=>commandArgs("lint && curl evil"));
  assert.throws(()=>pricing("gpt-6-astra" as never));
  assert.throws(()=>pricing("gpt-6-luna",{...defaultRates,"gpt-6-luna":{...defaultRates["gpt-6-luna"],input:0}}));
  assert.throws(()=>context(plan,{revision,changedFiles:["src/extra.ts"],files:{"README.md":""}}));
  assert.ok(Buffer.byteLength(context(plan,{revision,changedFiles:[],files:{"README.md":"x".repeat(24001)}}).text)<workerLimits.contextBytes);
  const anchor=anchorFor();
  assert.throws(()=>edits(plan,JSON.stringify({replacements:[{anchorId:anchor.id,expectedText:anchor.content,replacementText:"new"}]}),[anchor],revision),error=>error instanceof WorkerFailure&&error.diagnostic.shapeCategory==="unexpected_field");
  assert.throws(()=>edits(plan,JSON.stringify({replacements:[{anchorId:anchor.id,replacementText:"x".repeat(8001)}]}),[anchor],revision),error=>error instanceof WorkerFailure&&error.diagnostic.code==="proposal_invalid_content");
});

test("lineage ingress is read-only and claim rejects missing or mismatched provenance before dispatch",async()=>{
  for (const tamper of ["missing-run","mismatched-run","missing-plan","mismatched-plan"] as const) {
    const f=await fixture();
    try {
      const before=(await f.db.query("SELECT lease_owner,preflight_revision FROM engineering_runs WHERE id=$1::uuid",[f.run])).rows[0];
      const lineage=await f.ingress("lineage","lineage-read",0,{});
      assert.equal(lineage.run_id,f.run);
      assert.equal(lineage.target_repository,"omarimckie/MediMori");
      assert.equal(lineage.target_branch,"main");
      const afterRead=(await f.db.query("SELECT lease_owner,preflight_revision FROM engineering_runs WHERE id=$1::uuid",[f.run])).rows[0];
      assert.deepEqual(afterRead,before);
      // Simulate pre-existing/corrupt rows to verify worker-side fail-closed
      // behavior independently of the database immutability triggers.
      if(tamper==="missing-run"||tamper==="mismatched-run") await f.db.exec("ALTER TABLE engineering_run_lineage DISABLE TRIGGER engineering_run_lineage_immutable");
      else await f.db.exec("ALTER TABLE engineering_plan_lineage DISABLE TRIGGER engineering_plan_lineage_immutable");
      if(tamper==="missing-run") await f.db.query("DELETE FROM engineering_run_lineage WHERE run_id=$1::uuid",[f.run]);
      else if(tamper==="mismatched-run") await f.db.query("UPDATE engineering_run_lineage SET target_base_sha=$2 WHERE run_id=$1::uuid",[f.run,"d".repeat(40)]);
      else if(tamper==="missing-plan") await f.db.query("DELETE FROM engineering_plan_lineage WHERE task_id=$1::uuid",[f.task.id]);
      else await f.db.query("UPDATE engineering_plan_lineage SET target_base_sha=$2 WHERE task_id=$1::uuid",[f.task.id,"d".repeat(40)]);
      let providerCalls=0;
      const workspace:IsolatedWorkspace={snapshot:async()=>({revision,changedFiles:[],files:{"README.md":richSource}}),apply:async()=>proposalEvidence(),validate:async()=>({revision,outcome:"passed"})};
      await assert.rejects(runWorker(f.ingress,workspace,async()=>{providerCalls++;return{id:"never",model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:1,output_tokens:1},text:"{}"};}));
      assert.equal(providerCalls,0);
      const unchanged=(await f.db.query("SELECT lease_owner,preflight_revision,model_calls FROM engineering_runs WHERE id=$1::uuid",[f.run])).rows[0] as Record<string,unknown>;
      assert.equal(unchanged.lease_owner,null);
      assert.equal(unchanged.preflight_revision,null);
      assert.equal(Number(unchanged.model_calls),0);
    } finally { await f.close(); }
  }
});
test("canonical strict proposal schema is bounded, closed, and sent only for implementation",async()=>{
  const anchor=anchorFor();const format=replacementProposalFormat([anchor]);
  assert.equal(format.type,"json_schema");assert.equal(format.strict,true);
  assert.deepEqual(replacementProposalSchema.required,["replacements"]);assert.equal(replacementProposalSchema.additionalProperties,false);
  assert.equal(replacementProposalSchema.properties.replacements.minItems,1);assert.equal(replacementProposalSchema.properties.replacements.maxItems,8);
  const f=await fixture();try{
    const workspace:IsolatedWorkspace={snapshot:async()=>({revision,changedFiles:[],files:{"README.md":richSource}}),apply:async()=>proposalEvidence(),validate:async()=>({revision,outcome:"passed"})};const bodies:Record<string,unknown>[]=[],reservations:Record<string,unknown>[]=[];
    const ingress:Ingress=async(op,owner,epoch,data={})=>{if(op==="reserve")reservations.push(data);return f.ingress(op,owner,epoch,data);};
    await runWorker(ingress,workspace,async(body)=>{bodies.push(body);return{id:`schema-${bodies.length}`,model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:100,output_tokens:100},text:bodies.length===1?proposalFor(body):'{"passed":true}'};});
    const sentFormat=(bodies[0].text as {format:unknown}).format;
    assert.equal(JSON.stringify(sentFormat).includes("expectedText"),false);
    assert.deepEqual((sentFormat as {schema:{properties:{replacements:{items:{properties:{anchorId:{enum:string[]}}}}}}}).schema.properties.replacements.items.properties.anchorId.enum,buildBoundedReplacementContext(plan,{revision,changedFiles:[],files:{"README.md":richSource}}).anchors.map(item=>item.id));
    assert.equal(bodies[1].text,undefined);
    assert.ok(Number(reservations[0].inputBound)>Buffer.byteLength(JSON.stringify(sentFormat))+1024);
  }finally{await f.close();}
});
test("worker fails closed before reservation or provider dispatch when no useful unique anchor exists",async()=>{
  const f=await fixture();try{
    let calls=0;
    const workspace:IsolatedWorkspace={snapshot:async()=>({revision,changedFiles:[],files:{"README.md":"too short"}}),apply:async()=>assert.fail("No proposal can be applied without an issued anchor"),validate:async()=>assert.fail("No validation can run without an applied proposal")};
    await assert.rejects(runWorker(f.ingress,workspace,async()=>{calls++;throw new Error("provider must not be called");}),/bounded diagnostics/);
    assert.equal(calls,0);
    const run=(await f.db.query<{model_calls:number;cost_usd:string;reserved_tokens:number}>("SELECT * FROM engineering_runs")).rows[0];
    assert.equal(run.model_calls,0);assert.equal(run.cost_usd,"0.000000");assert.equal(run.reserved_tokens,0);
  }finally{await f.close();}
});
test("bounded proposal parser classifies malformed shapes without retaining values",()=>{
  const anchor=anchorFor();
  const cases:Array<[string,string]>=[
    ['[]',"top_level_not_object"],['{}',"missing_replacements"],['{"replacements":null}',"replacements_not_array"],
    ['{"replacements":[null]}',"replacement_not_object"],['{"replacements":[{"replacementText":"y"}]}',"other_schema_mismatch"],
    [JSON.stringify({replacements:[{anchorId:anchor.id}]}),"missing_replacement_text"],
    [JSON.stringify({replacements:[{anchorId:3,replacementText:"y"}]}),"wrong_field_type"],
    ['{"replacements":[],"extra":true}',"unexpected_field"],
    [JSON.stringify({replacements:[{anchorId:anchor.id,replacementText:"y",expectedText:anchor.content}]}),"unexpected_field"],
    ['{"replacements":[]}',"empty_replacements"],
    [JSON.stringify({replacements:Array.from({length:9},()=>({anchorId:anchor.id,replacementText:"y"}))}),"excessive_replacements"],
  ];
  for(const [text,category] of cases)assert.throws(()=>edits(plan,text,[anchor],revision),error=>error instanceof WorkerFailure&&error.diagnostic.shapeCategory===category);
  assert.throws(()=>edits(plan,'{"replacements":[', [anchor],revision),error=>error instanceof WorkerFailure&&error.diagnostic.code==="proposal_invalid_json");
  assert.throws(()=>edits(plan,JSON.stringify({replacements:[{anchorId:"f".repeat(64),replacementText:"two"}]}),[anchor],revision),error=>error instanceof WorkerFailure&&error.diagnostic.code==="proposal_invalid_content");
  assert.equal(extractResponsesOutputText({output:[{content:[{type:"output_text",text:"safe"},{type:"refusal",refusal:"do not retain"}]}]}),"safe");
  assert.equal(extractResponsesOutputText({output:[{content:"not content objects"}]}),"");
});
test("Responses adapter accepts a completed response and validates bounded identity and usage",async()=>{
  const originalFetch=globalThis.fetch;
  try{
    globalThis.fetch=async(_input,init)=>{
      assert.equal(init?.method,"POST");assert.equal(init?.signal instanceof AbortSignal,true);
      return Response.json({id:"resp_fixture_123",model:"gpt-6-luna",service_tier:"default",status:"completed",usage:{input_tokens:12,output_tokens:34},output:[{content:[{type:"output_text",text:"answer"}]}]});
    };
    const result=await openaiGenerate("fixture-key")({},new AbortController().signal);
    assert.deepEqual(result,{id:"resp_fixture_123",model:"gpt-6-luna",service_tier:"default",status:"completed",usage:{input_tokens:12,output_tokens:34},text:"answer",incomplete_reason:undefined});
  }finally{globalThis.fetch=originalFetch;}
});
test("Responses adapter rejects non-2xx without retrying",async()=>{
  const originalFetch=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async()=>{calls++;return new Response("error",{status:429});};
    await assert.rejects(openaiGenerate("fixture-key")({},new AbortController().signal),/HTTP 429.*uncertain.*no automatic resend/);
    assert.equal(calls,1);
  }finally{globalThis.fetch=originalFetch;}
});
test("Responses adapter treats malformed JSON and invalid envelopes as uncertain",async()=>{
  const originalFetch=globalThis.fetch;
  try{
    globalThis.fetch=async()=>new Response("{",{status:200,headers:{"Content-Type":"application/json"}});
    await assert.rejects(openaiGenerate("fixture-key")({},new AbortController().signal),/JSON invalid.*reservation retained/);
    const invalidResponses:unknown[]=[null,{},
      {id:"resp_fixture",model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:1,output_tokens:2}},
      {id:"",model:"gpt-6-luna",service_tier:"default",status:"completed",usage:{input_tokens:1,output_tokens:2}},
      {id:"resp_fixture",model:"gpt-6-luna",service_tier:"default",status:"queued",usage:{input_tokens:1,output_tokens:2}},
      {id:"resp_fixture",model:"gpt-6-luna",service_tier:"default",status:"completed",usage:{input_tokens:-1,output_tokens:2}},
      {id:"resp_fixture",model:"gpt-6-luna",service_tier:"default",status:"completed",usage:{input_tokens:1,output_tokens:1.5}},
      {id:"resp_fixture",model:"gpt-6-luna",status:"completed",usage:{input_tokens:1,output_tokens:2}},
    ];
    for(const invalid of invalidResponses){
      globalThis.fetch=async()=>Response.json(invalid);
      await assert.rejects(openaiGenerate("fixture-key")({},new AbortController().signal),/invalid|missing/i);
    }
  }finally{globalThis.fetch=originalFetch;}
});
test("Responses adapter treats aborts and transport errors as uncertain without retrying",async()=>{
  const originalFetch=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async()=>{calls++;throw Object.assign(new Error("private transport detail"),{name:"AbortError"});};
    await assert.rejects(openaiGenerate("fixture-key")({},new AbortController().signal),/transport outcome uncertain/);
    globalThis.fetch=async()=>{calls++;throw new Error("private transport detail");};
    await assert.rejects(openaiGenerate("fixture-key")({},new AbortController().signal),/transport outcome uncertain/);
    assert.equal(calls,2);
  }finally{globalThis.fetch=originalFetch;}
});
test("fresh sanitized export refreshes current source and excludes environment and Git data",async()=>{
  const parent=await mkdtemp(join(tmpdir(),"m2c6a-export-"));const source=join(parent,"source"),exports=join(parent,"exports");await mkdir(source);await mkdir(exports);gitFixture(source,"init","-q");
  try{
    await writeFile(join(source,".gitignore"),".env.local\n");await writeFile(join(source,"docs.md"),"current M2C.6A source\n");await writeFile(join(source,".env.local"),"SECRET_SENTINEL");await commitGitFixture(source);
    const fresh=await createFreshExport(source,exports);assert.equal(await readFile(join(fresh,"docs.md"),"utf8"),"current M2C.6A source\n");
    await assert.rejects(readFile(join(fresh,".env.local")));await assert.rejects(readFile(join(fresh,".git","config")));
    assert.match(await exportedWorkspaceRevision(fresh),/^[a-f0-9]{40}$/);
    await rm(fresh,{recursive:true,force:true});
  }finally{await rm(parent,{recursive:true,force:true});}
});
test("lease contention, fencing, expiry, human cancellation, narrow role and sanitized audit",async()=>{
  const f=await fixture();try {
    const claims=await Promise.allSettled([f.ingress("claim","one",0),f.ingress("claim","two",0)]);
    assert.equal(claims.filter(x=>x.status==="fulfilled").length,1);
    await assert.rejects(f.ingress("claim",null as never,0));
    await assert.rejects(f.ingress("heartbeat","one",null as never));
    await f.db.exec("UPDATE engineering_runs SET lease_until=now()-interval '1 second'");
    const next=await f.ingress("claim","new",0);
    await assert.rejects(f.ingress("heartbeat","one",1));
    await assert.rejects(recordRunEvidence(f.task.id,f.task.version,{kind:"cost",provider:"x",model:"x",operation:"x",tokens:0,estimatedCostUsd:0},"human",f.sql));
    await assert.rejects(actOnTask(f.task.id,f.task.version,"transition","validating","human",f.sql));
    await f.db.exec("SET ROLE medimori_engineering_worker");
    await assert.rejects(f.db.query("SELECT * FROM engineering_tasks"));
    await assert.rejects(f.db.query("UPDATE engineering_tasks SET status='implementing'"));
    await f.ingress("heartbeat","new",Number(next.lease_epoch));
    await f.db.exec("RESET ROLE");
    await actOnTask(f.task.id,f.task.version,"transition","cancelled","human",f.sql);
    await assert.rejects(f.ingress("heartbeat","new",Number(next.lease_epoch)));
    const events=(await f.db.query<{details:Record<string,unknown>}>("SELECT details FROM engineering_events WHERE action='heartbeat'")).rows;
    assert.deepEqual(Object.keys(events[0].details).sort(),["cycle","leaseEpoch","runId"]);
  }finally{await f.close();}
});
test("reservation races, idempotency, Luna to recorded Sol escalation, reconciliation and budget stops",async()=>{
  const f=await fixture();try {
    const s=await f.ingress("claim","one",0),epoch=Number(s.lease_epoch);
    const send=(op:string,data:Record<string,unknown>={})=>f.ingress(op,"one",epoch,data);
    await assert.rejects(send("reserve",reservation("output-too-large",100,workerLimits.outputTokens+1)));
    const outputMax=reservation("output-max",100,workerLimits.outputTokens);
    await send("reserve",outputMax);await send("sent",outputMax);
    await send("reconcile",{key:outputMax.key,hash:outputMax.hash,responseId:"max-output",input:100,output:workerLimits.outputTokens,micros:quote(100,workerLimits.outputTokens,defaultRates["gpt-6-luna"])});
    await assert.rejects(send("reserve",reservation("sol",100,100,"gpt-6.1-sol")));
    await send("escalate",{reason:"Explicit complex implementation escalation"});
    const races=await Promise.allSettled([send("reserve",reservation("one")),send("reserve",reservation("two"))]);
    assert.equal(races.filter(x=>x.status==="fulfilled").length,1);
    const c=(await f.db.query<{call_key:string}>("SELECT call_key FROM engineering_worker_calls WHERE call_key IN ('one','two')")).rows[0];
    const call=reservation(c.call_key);
    await send("reserve",call);
    await assert.rejects(send("reserve",{...call,hash:"c".repeat(64)}));
    await send("sent",call);await assert.rejects(send("sent",call));
    await assert.rejects(send("claim"));
    const actual={key:c.call_key,hash:call.hash,responseId:"response-1",input:10,output:10,micros:quote(10,10,call.rates)};
    await send("reconcile",actual);await send("reconcile",actual);
    await assert.rejects(send("reconcile",{...actual,input:11}));
    let run=(await f.db.query<{model_calls:number;reserved_tokens:number;cost_usd:string}>("SELECT * FROM engineering_runs")).rows[0];
    assert.equal(run.model_calls,2);assert.equal(run.reserved_tokens,0);
    await send("reserve",reservation("sol-paid",100,100,"gpt-6.1-sol"));await send("sent",reservation("sol-paid",100,100,"gpt-6.1-sol"));
    const solActual={key:"sol-paid",hash:call.hash,responseId:"response-2",input:10,output:10,micros:quote(10,10,defaultRates["gpt-6.1-sol"])};
    await send("reconcile",solActual);
    await f.db.exec("UPDATE engineering_runs SET cost_usd=.7499");
    await assert.rejects(send("reserve",reservation("budget")));
    await f.db.exec("UPDATE engineering_runs SET cost_usd=0,model_calls=12");
    await assert.rejects(send("reserve",reservation("calls")));
    await f.db.exec("UPDATE engineering_runs SET model_calls=0,tokens=59999");
    await assert.rejects(send("reserve",reservation("tokens")));
    await f.db.exec("UPDATE engineering_runs SET tokens=0");
    await assert.rejects(send("reserve",{...reservation("cheap"),micros:1}));
    await assert.rejects(send("reserve",{...reservation("astra"),model:"gpt-6-astra"}));
    run=(await f.db.query<typeof run>("SELECT * FROM engineering_runs")).rows[0];assert.equal(run.reserved_tokens,0);
  }finally{await f.close();}
});
test("trusted revision evidence, replay, three repairs, protected operations, stop at awaiting_merge",async()=>{
  const f=await fixture();try {
    const s=await f.ingress("claim","one",0);const send=(op:string,data:Record<string,unknown>={})=>f.ingress(op,"one",Number(s.lease_epoch),data);
    for(const op of ["merge_main","production_deploy","production_secrets","destructive_database","auth_security","payments","production_infrastructure","external_publish"]) await assert.rejects(send(op));
    await assert.rejects(send("revision",{revision}));
    await assert.rejects(send("proposal_evidence",{...proposalEvidence(revision),replacementText:"must not persist"}));
    await send("proposal_evidence",proposalEvidence(revision));await send("revision",{revision});await assert.rejects(send("review"));
    for(let cycle=0;cycle<3;cycle++){
      const e={key:`fail:${cycle}`,revision,command:"lint",outcome:"failed",source:"worker",diagnostic:{command:"lint",outcome:"failed",exitCode:1,containerExitCode:null,containerStatus:null,containerOomKilled:null,signal:null,timedOut:false,category:"command_failed",excerpt:[],failedTests:[],failedTestFiles:[]}};
      await send("validation",e);await send("validation",e);
      await assert.rejects(send("validation",{...e,outcome:"passed"}));
      await send("repair");await send("proposal_evidence",proposalEvidence(revision));await send("revision",{revision});
    }
    await assert.rejects(send("validation",{key:"fake",revision:"b".repeat(40),command:"lint",outcome:"passed",source:"worker"}));
    for(const command of plan.validations)await send("validation",{key:`pass:${command}`,revision,command,outcome:"passed",source:"ci",diagnostic:{command,outcome:"passed",exitCode:0,containerExitCode:null,containerStatus:null,containerOomKilled:null,signal:null,timedOut:false,category:null,excerpt:[],failedTests:[],failedTestFiles:[]}});
    await assert.rejects(send("repair"));await send("review");
    await assert.rejects(send("finish",{revision:"b".repeat(40),outcome:"passed"}));
    await send("finish",{revision,outcome:"passed"});
    assert.equal((await taskHistory(f.task.id,f.sql)).task!.status,"awaiting_merge");
    const storedEvidence=(await f.db.query<{details:Record<string,unknown>}>("SELECT details FROM engineering_events WHERE task_id=$1 AND action='proposal_evidence'",[f.task.id])).rows;
    assert.equal(storedEvidence.length,1);assert.equal(JSON.stringify(storedEvidence[0].details).includes("must not persist"),false);
    await assert.rejects(send("heartbeat"));await assert.rejects(f.ingress("claim","two",0));
  }finally{await f.close();}
});
test("real orchestrator with fake provider reaches awaiting_merge with two calls, no live AI",async()=>{
  const f=await fixture();try {
    let current=revision,content=richSource;
    const workspace:IsolatedWorkspace={snapshot:async()=>({revision:current,changedFiles:content===richSource?[]:plan.files,files:{"README.md":content}}),apply:async(replacements,rev)=>{assert.equal(rev,current);content=replacements[0].replacement;current="c".repeat(40);return proposalEvidence(current);},validate:async(args,rev)=>{assert.equal(args[0],"npm");return{revision:rev,outcome:"passed"};}};
    let calls=0;
    const result=await runWorker(f.ingress,workspace,async(body)=>{calls++;assert.equal(body.model,"gpt-6-luna");assert.deepEqual(body.tools,[]);return{id:`fake-${calls}`,model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:100,output_tokens:100},text:calls===1?proposalFor(body):'{"passed":true}'};});
    assert.equal(result.status,"awaiting_merge");assert.equal(calls,2);
    assert.equal((await f.db.query("SELECT * FROM engineering_costs")).rows.length,2);
    const evidence=(await f.db.query<{details:Record<string,unknown>}>("SELECT details FROM engineering_events WHERE task_id=$1 AND action='proposal_evidence'",[f.task.id])).rows;
    assert.equal(evidence.length,1);const stored=evidence[0].details.proposalEvidence as ProposalEvidence;assert.equal(stored.workspaceRevision,current);assert.equal(stored.replacementCount,1);assert.equal(JSON.stringify(stored).includes("original"),false);assert.equal(JSON.stringify(stored).includes("updated"),false);
    const progress=(await f.db.query<{details:Record<string,unknown>}>("SELECT details FROM engineering_events WHERE task_id=$1 AND action='validation_progress' ORDER BY created_at",[f.task.id])).rows.map(row=>row.details.progressStage);
    assert.deepEqual(progress,["post_apply_verified","validation_environment_prepare_started","validation_environment_prepare_succeeded","validation_cycle_started",...plan.validations.map(()=>"validation_gate_started")]);
  }finally{await f.close();}
});
test("post-apply preparation failures persist their bounded category and never start a gate",async()=>{
  const f=await fixture();try{
    let current=revision,calls=0,gateCalls=0;
    const workspace:IsolatedWorkspace={snapshot:async()=>({revision:current,changedFiles:current===revision?[]:plan.files,files:{"README.md":richSource}}),apply:async(_replacements,rev)=>{assert.equal(rev,current);current="c".repeat(40);return proposalEvidence(current);},prepareValidationEnvironment:async()=>{throw new ValidationPreparationError("validation_overlay_prepare_failed","next_env_overlay");},validate:async()=>{gateCalls++;return{revision:current,outcome:"passed"};}};
    await assert.rejects(runWorker(f.ingress,workspace,async(body)=>{calls++;return{id:"prep-failure",model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:100,output_tokens:100},text:proposalFor(body)};}),/bounded diagnostics/);
    assert.equal(calls,1);assert.equal(gateCalls,0);
    const block=(await f.db.query<{details:Record<string,unknown>}>("SELECT details FROM engineering_events WHERE task_id=$1 AND action='block'",[f.task.id])).rows[0].details.diagnostic as Record<string,unknown>;
    assert.equal(block.code,"validation_overlay_prepare_failed");assert.equal(block.validationStage,"next_env_overlay");assert.equal(block.validationRevision,"c".repeat(40));assert.equal(block.operation,"prepare_validation_environment");assert.equal(block.category,"validation_failure");assert.equal(block.cleanupOutcome,"not_attempted");
    const progress=(await f.db.query<{details:Record<string,unknown>}>("SELECT details FROM engineering_events WHERE task_id=$1 AND action='validation_progress' ORDER BY created_at",[f.task.id])).rows.map(row=>row.details.progressStage);
    assert.deepEqual(progress,["post_apply_verified","validation_environment_prepare_started"]);
    assert.equal((await f.db.query("SELECT * FROM engineering_validations WHERE run_id=$1::uuid",[f.run])).rows.length,0);
    assert.equal(JSON.stringify(block).includes("private"),false);
  }finally{await f.close();}
});
test("failed validation diagnostics are durably bounded and supplied to the authorized repair call",async()=>{
  const f=await fixture();try {
    let current=revision,content=richSource,calls=0;
    const repairedSource="Revised documentation paragraph provides deterministic replacement context with enough distinct words for a safe exact literal anchor during worker tests.";
    const finalSource="Final documentation paragraph provides deterministic replacement context with enough distinct words for a safe exact literal anchor during worker tests.";
    const workspace:IsolatedWorkspace={
      snapshot:async()=>({revision:current,changedFiles:content===richSource?[]:plan.files,files:{"README.md":content}}),
      apply:async(replacements,rev)=>{assert.equal(rev,current);content=replacements[0].replacement;current=String.fromCharCode(98+current.charCodeAt(0)-97).repeat(40);return proposalEvidence(current);},
      validate:async(args,rev,_signal,cycle)=>({revision:rev,command:args[2]!,outcome:cycle===0&&["build","test:engineering"].includes(args[2]!)?"failed":"passed",exitCode:cycle===0&&["build","test:engineering"].includes(args[2]!)?70:0,signal:cycle===0&&args[2]==="build"?"SIGSEGV":null,timedOut:false,category:cycle===0&&args[2]==="build"?"process_signaled":cycle===0&&args[2]==="test:engineering"?"command_failed":null,excerpt:args[2]==="build"?["Next.js 16.2.4"]:[],failedTests:args[2]==="test:engineering"?["offline scratch preflight fixture"]:[],failedTestFiles:args[2]==="test:engineering"?["src/lib/engineering/worker-initialization.test.ts"]:[],cycle:cycle??0}),
    };
    const bodies:Record<string,unknown>[]=[];
    const result=await runWorker(f.ingress,workspace,async(body)=>{calls++;bodies.push(body);return{id:`repair-evidence-${calls}`,model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:100,output_tokens:100},text:calls===1?proposalFor(body,repairedSource):calls===2?proposalFor(body,finalSource):'{"passed":true}'};});
    assert.equal(result.status,"awaiting_merge");assert.equal(calls,3);
    const repairInput=JSON.parse(String(bodies[1].input)) as {validationFailures:Array<{command:string;category:string;signal:string|null;failedTests:string[];failedTestFiles:string[]}>};
    assert.deepEqual(repairInput.validationFailures.map(item=>item.command),["build","test:engineering"]);
    assert.equal(repairInput.validationFailures[0].category,"process_signaled");
    assert.equal(repairInput.validationFailures[0].signal,"SIGSEGV");
    assert.deepEqual(repairInput.validationFailures[1].failedTestFiles,["src/lib/engineering/worker-initialization.test.ts"]);
    assert.deepEqual(repairInput.validationFailures[1].failedTests,["offline scratch preflight fixture"]);
    const stored=(await f.db.query<{summary:string;cycle:number;command:string}>("SELECT summary,cycle,command FROM engineering_validations WHERE run_id=$1::uuid AND outcome='failed' ORDER BY command",[f.run])).rows;
    assert.equal(stored.length,2);
    for(const row of stored){const evidence=JSON.parse(row.summary) as Record<string,unknown>;assert.equal(evidence.revision,"b".repeat(40));assert.equal(evidence.cycle,0);assert.equal(evidence.command,row.command);assert.equal(evidence.outcome,"failed");}
    const callStates=(await f.db.query<{call_key:string;processing_state:string}>("SELECT call_key,processing_state FROM engineering_worker_calls ORDER BY created_at")).rows;
    assert.deepEqual(callStates.map(item=>item.processing_state),["proposal_applied","proposal_applied","review_validated"]);
    const phases=(await f.db.query<{details:Record<string,unknown>}>("SELECT details FROM engineering_events WHERE action='call_progress' ORDER BY created_at")).rows;
    assert.ok(phases.some(row=>row.details.phase==="proposal_applied"));assert.ok(phases.some(row=>row.details.phase==="review_validated"));
  }finally{await f.close();}
});
test("applied proposal is durable before cleanup and cleanup failures persist only bounded diagnostics",async()=>{
  const f=await fixture();try{
    let current=revision,content=richSource;let calls=0;
    const workspace:IsolatedWorkspace={
      snapshot:async()=>({revision:current,changedFiles:content===richSource?[]:plan.files,files:{"README.md":content}}),
      apply:async(replacements,rev)=>{assert.equal(rev,current);content=replacements[0].replacement;current="c".repeat(40);return proposalEvidence(current);},
      validate:async()=>({revision:current,outcome:"passed"}),
      dispose:async()=>{throw new DockerCleanupError([{resourceType:"source-volume",category:"resource_in_use"}]);},
    };
    await assert.rejects(runWorker(f.ingress,workspace,async(body)=>{calls++;return{id:`cleanup-${calls}`,model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:100,output_tokens:100},text:calls===1?proposalFor(body):'{"passed":true}'};}));
    assert.equal(calls,2);assert.equal((await taskHistory(f.task.id,f.sql)).task!.status,"blocked");
    const events=(await f.db.query<{action:string;details:Record<string,unknown>}>("SELECT action,details FROM engineering_events WHERE task_id=$1 AND action IN ('proposal_evidence','block') ORDER BY created_at",[f.task.id])).rows;
    assert.equal(events.length,2);assert.ok(events.some(event=>event.action==="proposal_evidence"));
    const block=events.find(event=>event.action==="block")!;const diagnostic=block.details.diagnostic as {code:string;operation:string;category:string;cleanupOutcome:string;cleanupFailures:Array<{resourceType:string;category:string}>};
    assert.equal(diagnostic.code,"sandbox_cleanup_failed");assert.deepEqual(diagnostic.cleanupFailures,[{resourceType:"source-volume",category:"resource_in_use"}]);assert.equal(diagnostic.operation,"workspace_cleanup");assert.equal(diagnostic.category,"cleanup_failure");assert.equal(diagnostic.cleanupOutcome,"failed");
    assert.equal(JSON.stringify(events).includes("original"),false);assert.equal(JSON.stringify(events).includes("updated"),false);
  }finally{await f.close();}
});
test("primary diagnostic survives a separate cleanup failure",async()=>{
  const f=await fixture();try{
    const workspace:IsolatedWorkspace={snapshot:async()=>({revision,changedFiles:[],files:{"README.md":richSource}}),apply:async()=>assert.fail("invalid proposal must not apply"),validate:async()=>assert.fail("invalid proposal must not validate"),dispose:async()=>{throw new DockerCleanupError([{resourceType:"source-volume",category:"resource_in_use"}]);}};
    await assert.rejects(runWorker(f.ingress,workspace,async()=>({id:"primary-and-cleanup",model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:100,output_tokens:100},text:"not-json",status:"completed"})),/bounded diagnostics/);
    const details=(await f.db.query<{details:Record<string,unknown>}>("SELECT details FROM engineering_events WHERE task_id=$1 AND action='block'",[f.task.id])).rows[0].details;
    assert.deepEqual(details.diagnostic,{stage:"implementation",code:"proposal_invalid_json",responseId:"primary-and-cleanup",responseStatus:"completed",outputTokens:100,outputLimit:8192,operation:"apply_proposal",category:"proposal_failure",cleanupOutcome:"failed",cleanupFailures:[{resourceType:"source-volume",category:"resource_in_use"}]});
  }finally{await f.close();}
});
test("uncertain calls never resend, and cancellation still permits authoritative reconciliation",async()=>{
  const f=await fixture();try {
    const s=await f.ingress("claim","one",0),epoch=Number(s.lease_epoch);const send=(op:string,data:Record<string,unknown>={})=>f.ingress(op,"one",epoch,data);
    const c=reservation("uncertain");await send("reserve",c);await send("sent",c);await send("uncertain",c);
    await f.db.exec("UPDATE engineering_runs SET lease_until=now()-interval '1 second'");
    await assert.rejects(f.ingress("claim","two",0));
    await actOnTask(f.task.id,f.task.version,"transition","cancelled","human",f.sql);
    await send("reconcile",{key:c.key,hash:c.hash,responseId:"late",input:1,output:1,micros:3});
    assert.equal((await taskHistory(f.task.id,f.sql)).task!.status,"cancelled");
    assert.equal((await f.db.query<{reserved_tokens:number}>("SELECT * FROM engineering_runs")).rows[0].reserved_tokens,0);
  }finally{await f.close();}
});
test("unexpected authoritative usage exceeds reservation, is preserved, and blocks further calls",async()=>{
  const f=await fixture();try{
    const s=await f.ingress("claim","one",0);const send=(op:string,data:Record<string,unknown>={})=>f.ingress(op,"one",Number(s.lease_epoch),data);
    const c=reservation("overrun");
    await assert.rejects(send("reserve",{...c,rates:{endpoint:c.rates.endpoint,tier:c.rates.tier,regime:c.rates.regime}}));
    await send("reserve",c);await send("sent",c);
    await send("reconcile",{key:c.key,hash:c.hash,responseId:"overrun",input:200,output:200,micros:quote(200,200,c.rates)});
    assert.equal((await taskHistory(f.task.id,f.sql)).task!.status,"blocked");
    const actual=(await f.db.query<{actual_input:number;actual_output:number}>("SELECT * FROM engineering_worker_calls")).rows[0];
    assert.equal(actual.actual_input,200);assert.equal(actual.actual_output,200);
    await assert.rejects(send("reserve",reservation("next")));
  }finally{await f.close();}
});
test("provider transport failure makes one attempt, retains reservation and blocks execution",async()=>{
  const f=await fixture();try{
    let calls=0;
    const workspace:IsolatedWorkspace={snapshot:async()=>({revision,changedFiles:[],files:{"README.md":richSource}}),apply:async()=>assert.fail("No edits after failed call"),validate:async()=>assert.fail("No validation after failed call")};
    await assert.rejects(runWorker(f.ingress,workspace,async()=>{calls++;throw new Error("private transport detail");}),error=>{
      assert.ok(error instanceof WorkerExitError);
      assert.equal(error.report.primary.code,"worker_failure");
      assert.equal(JSON.stringify(error.report).includes("private transport detail"),false);
      return true;
    });
    assert.equal(calls,1);
    const call=(await f.db.query<{state:string;reserved_tokens:number}>("SELECT * FROM engineering_worker_calls")).rows[0];
    assert.equal(call.state,"uncertain");assert.ok(call.reserved_tokens>0);
    assert.equal((await taskHistory(f.task.id,f.sql)).task!.status,"blocked");
  }finally{await f.close();}
});
test("stale preflight revision blocks before provider dispatch",async()=>{
  const f=await fixture();try{
    let calls=0,blocked=false;
    const ingress:Ingress=async(op,owner,epoch,data={})=>{if(op==="claim")return{...await f.ingress(op,owner,epoch,data),preflight_revision:"f".repeat(40)};if(op==="block")blocked=true;return f.ingress(op,owner,epoch,data);};
    const workspace:IsolatedWorkspace={snapshot:async()=>({revision,changedFiles:[],files:{"README.md":richSource}}),apply:async()=>assert.fail(),validate:async()=>assert.fail()};
    await assert.rejects(runWorker(ingress,workspace,async()=>{calls++;throw new Error("should not dispatch");}),/binding mismatch/);
    assert.equal(calls,0);assert.equal(blocked,true);
  }finally{await f.close();}
});
test("a previously bound run cannot dispatch through a second worker invocation",async()=>{
  const f=await fixture();try{
    let calls=0,blocked=false;
    const ingress:Ingress=async(op,owner,epoch,data={})=>{if(op==="claim")return{...await f.ingress(op,owner,epoch,data),preflight_bound_now:false};if(op==="block")blocked=true;return f.ingress(op,owner,epoch,data);};
    const workspace:IsolatedWorkspace={snapshot:async()=>({revision,changedFiles:[],files:{"README.md":richSource}}),apply:async()=>assert.fail(),validate:async()=>assert.fail()};
    await assert.rejects(runWorker(ingress,workspace,async()=>{calls++;throw new Error("should not dispatch");}),/second worker invocation/);
    assert.equal(calls,0);assert.equal(blocked,true);
  }finally{await f.close();}
});
test("atomic claim binds the whole-tree preflight revision once",async()=>{
  const f=await fixture();try{
    const first=await f.ingress("claim","bound",0,{preflightRevision:revision});assert.equal(first.preflight_revision,revision);assert.equal(first.preflight_bound_now,true);
    await assert.rejects(f.ingress("claim","different",0,{preflightRevision:"f".repeat(40)}));
    const repeated=await f.ingress("claim","bound",0,{preflightRevision:revision});assert.equal(repeated.preflight_bound_now,false);
  }finally{await f.close();}
});
test("unexpected provider tier retains reservation and raw usage for operator reconciliation",async()=>{
  const f=await fixture();try{
    const s=await f.ingress("claim","one",0);const send=(op:string,data:Record<string,unknown>={})=>f.ingress(op,"one",Number(s.lease_epoch),data);
    const c=reservation("tier");await send("reserve",c);await send("sent",c);
    await send("reconcile",{key:c.key,hash:c.hash,responseId:"wrong-tier",input:10,output:10,reportedModel:c.model,tier:"priority"});
    const call=(await f.db.query<{state:string;actual_input:number;reported_tier:string}>("SELECT * FROM engineering_worker_calls")).rows[0];
    assert.equal(call.state,"uncertain");assert.equal(call.actual_input,10);assert.equal(call.reported_tier,"priority");
    const run=(await f.db.query<{reserved_tokens:number}>("SELECT * FROM engineering_runs")).rows[0];assert.equal(run.reserved_tokens,200);
    assert.equal((await taskHistory(f.task.id,f.sql)).task!.status,"blocked");
  }finally{await f.close();}
});
test("incomplete provider response is reconciled and leaves bounded diagnostic evidence",async()=>{
  const f=await fixture();try{
    const workspace:IsolatedWorkspace={snapshot:async()=>({revision,changedFiles:[],files:{"README.md":richSource}}),apply:async()=>assert.fail("Incomplete output must not be applied"),validate:async()=>assert.fail("Incomplete output must not be validated")};
    await assert.rejects(runWorker(f.ingress,workspace,async()=>({id:"resp_fixture",model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:4888,output_tokens:2048},text:'{"README.md":"partial',status:"incomplete",incomplete_reason:"max_output_tokens"})),/bounded diagnostics/);
    const events=(await f.db.query<{details:Record<string,unknown>}>("SELECT details FROM engineering_events WHERE action='block'")).rows;
    assert.deepEqual(events[0].details.diagnostic,{stage:"implementation",code:"provider_incomplete",operation:"provider_call",category:"provider_failure",cleanupOutcome:"not_attempted",responseId:"resp_fixture",responseStatus:"incomplete",incompleteReason:"max_output_tokens",outputTokens:2048,outputLimit:8192});
    assert.equal((await f.db.query("SELECT * FROM engineering_worker_calls WHERE state='settled'")).rows.length,1);
    assert.equal(JSON.stringify(events).includes("partial"),false);
  }finally{await f.close();}
});
test("malformed proposal is blocked with safe parser code and settled completion metadata",async()=>{
  const f=await fixture();try{
    const workspace:IsolatedWorkspace={snapshot:async()=>({revision,changedFiles:[],files:{"README.md":richSource}}),apply:async()=>assert.fail("Malformed output must not be applied"),validate:async()=>assert.fail("Malformed output must not be validated")};
    await assert.rejects(runWorker(f.ingress,workspace,async()=>({id:"resp_fixture",model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:100,output_tokens:2048},text:"not-json",status:"completed"})),/bounded diagnostics/);
    const details=(await f.db.query<{details:Record<string,unknown>}>("SELECT details FROM engineering_events WHERE action='block'")).rows[0].details;
    assert.deepEqual(details.diagnostic,{stage:"implementation",code:"proposal_invalid_json",operation:"apply_proposal",category:"proposal_failure",cleanupOutcome:"not_attempted",responseId:"resp_fixture",responseStatus:"completed",outputTokens:2048,outputLimit:8192});
    assert.equal(JSON.stringify(details).includes("not-json"),false);
  }finally{await f.close();}
});
test("completed invalid proposal records only allow-listed shape metadata",async()=>{
  const f=await fixture();try{
    const workspace:IsolatedWorkspace={snapshot:async()=>({revision,changedFiles:[],files:{"README.md":richSource}}),apply:async()=>assert.fail("Invalid proposal must not be applied"),validate:async()=>assert.fail("Invalid proposal must not validate")};
    await assert.rejects(runWorker(f.ingress,workspace,async()=>({id:"resp_fixture",model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:100,output_tokens:100},text:'{"unexpected":"private-sentinel"}',status:"completed"})),/bounded diagnostics/);
    const details=(await f.db.query<{details:Record<string,unknown>}>("SELECT details FROM engineering_events WHERE action='block'")).rows[0].details;
    assert.deepEqual(details.diagnostic,{stage:"implementation",code:"proposal_invalid_shape",operation:"apply_proposal",category:"proposal_failure",cleanupOutcome:"not_attempted",shapeCategory:"unexpected_field",responseId:"resp_fixture",responseStatus:"completed",outputTokens:100,outputLimit:8192});
    assert.equal(JSON.stringify(details).includes("private-sentinel"),false);
  }finally{await f.close();}
});
test("application failure records safe diagnostic and never validates",async()=>{
  const f=await fixture();try{
    const workspace:IsolatedWorkspace={snapshot:async()=>({revision,changedFiles:[],files:{"README.md":richSource}}),apply:async()=>{throw new Error("private filesystem detail")},validate:async()=>assert.fail("Rejected apply must not validate")};
    await assert.rejects(runWorker(f.ingress,workspace,async(body)=>({id:"resp_fixture",model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:100,output_tokens:100},text:proposalFor(body),status:"completed"})),/bounded diagnostics/);
    const details=(await f.db.query<{details:Record<string,unknown>}>("SELECT details FROM engineering_events WHERE action='block'")).rows[0].details;
    assert.deepEqual(details.diagnostic,{stage:"implementation",code:"replacement_apply_failed",operation:"apply_proposal",category:"proposal_failure",cleanupOutcome:"not_attempted",responseId:"resp_fixture",responseStatus:"completed",outputTokens:100,outputLimit:8192});
    assert.equal(JSON.stringify(details).includes("private filesystem detail"),false);
  }finally{await f.close();}
});
test("settled calls retain bounded response metadata when progress persistence fails",async()=>{
  const f=await fixture();try{
    let calls=0;
    const ingress:Ingress=async(op,owner,epoch,data={})=>{
      if(op==="call_progress"&&data.phase==="response_processed")throw new Error("private database host and password");
      return f.ingress(op,owner,epoch,data);
    };
    const workspace:IsolatedWorkspace={snapshot:async()=>({revision,changedFiles:[],files:{"README.md":richSource}}),apply:async()=>assert.fail("Response progress must persist before proposal processing"),validate:async()=>assert.fail("No validation without proposal processing")};
    await assert.rejects(runWorker(ingress,workspace,async()=>{calls++;return{id:"resp_progress_fixture",model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:100,output_tokens:60},text:'{"replacements":[]}',status:"completed"};}),/bounded diagnostics/);
    assert.equal(calls,1);
    const call=(await f.db.query<{state:string;processing_state:string;actual_input:number;actual_output:number}>("SELECT * FROM engineering_worker_calls")).rows[0];
    assert.equal(call.state,"settled");assert.equal(call.processing_state,"failed");assert.equal(call.actual_input,100);assert.equal(call.actual_output,60);
    const details=(await f.db.query<{details:Record<string,unknown>}>("SELECT details FROM engineering_events WHERE action='block'")).rows[0].details;
    assert.deepEqual(details.diagnostic,{stage:"implementation",code:"call_progress_persist_failed",operation:"provider_call",category:"provider_failure",cleanupOutcome:"not_attempted",progressPhase:"response_processed",responseId:"resp_progress_fixture",responseStatus:"completed",outputTokens:60,outputLimit:8192});
    assert.equal(JSON.stringify(details).includes("private database host"),false);
    assert.equal((await f.db.query("SELECT * FROM engineering_validations")).rows.length,0);
  }finally{await f.close();}
});
test("proposal-evidence transport ingress failure receives its own bounded settled-call category",async()=>{
  const f=await fixture();try{
    let content=richSource,calls=0;
    const ingress:Ingress=async(op,owner,epoch,data={})=>{
      if(op==="proposal_evidence")throw new Error("private filesystem or database detail");
      return f.ingress(op,owner,epoch,data);
    };
    const workspace:IsolatedWorkspace={snapshot:async()=>({revision,changedFiles:content===richSource?[]:plan.files,files:{"README.md":content}}),apply:async(replacements)=>{content=replacements[0].replacement;return proposalEvidence();},validate:async()=>assert.fail("Rejected evidence persistence must not validate")};
    await assert.rejects(runWorker(ingress,workspace,async(body)=>{calls++;return{id:"resp_evidence_fixture",model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:100,output_tokens:60},text:proposalFor(body),status:"completed"};}),/bounded diagnostics/);
    assert.equal(calls,1);
    const call=(await f.db.query<{state:string;processing_state:string}>("SELECT * FROM engineering_worker_calls")).rows[0];
    assert.equal(call.state,"settled");assert.equal(call.processing_state,"failed");
    const details=(await f.db.query<{details:Record<string,unknown>}>("SELECT details FROM engineering_events WHERE action='block'")).rows[0].details;
    assert.deepEqual(details.diagnostic,{stage:"implementation",code:"proposal_evidence_persist_failed",operation:"apply_proposal",category:"proposal_failure",cleanupOutcome:"not_attempted",replacementCount:1,responseId:"resp_evidence_fixture",responseStatus:"completed",outputTokens:60,outputLimit:8192});
    assert.equal(JSON.stringify(details).includes("private filesystem"),false);
    assert.equal((await f.db.query("SELECT * FROM engineering_events WHERE action='proposal_evidence'")).rows.length,0);
    assert.equal((await f.db.query("SELECT * FROM engineering_validations")).rows.length,0);
  }finally{await f.close();}
});
test("proposal-evidence ingress rejection is distinct from transport failures",async()=>{
  const f=await fixture();try{
    let content=richSource,calls=0;
    const ingress:Ingress=async(op,owner,epoch,data={})=>{
      if(op==="proposal_evidence")throw new Error("proposal_evidence_denied");
      return f.ingress(op,owner,epoch,data);
    };
    const workspace:IsolatedWorkspace={snapshot:async()=>({revision,changedFiles:content===richSource?[]:plan.files,files:{"README.md":content}}),apply:async(replacements)=>{content=replacements[0].replacement;return proposalEvidence();},validate:async()=>assert.fail("Rejected evidence persistence must not validate")};
    await assert.rejects(runWorker(ingress,workspace,async(body)=>{calls++;return{id:"resp_evidence_reject",model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:100,output_tokens:60},text:proposalFor(body),status:"completed"};}),/bounded diagnostics/);
    const details=(await f.db.query<{details:Record<string,unknown>}>("SELECT details FROM engineering_events WHERE action='block'")).rows[0].details;
    assert.equal((details.diagnostic as Record<string,unknown>).code,"proposal_evidence_rejected");
  }finally{await f.close();}
});
test("proposal-evidence lease ingress failure maps to lease_or_fence_lost",async()=>{
  const f=await fixture();try{
    let content=richSource,calls=0;
    const ingress:Ingress=async(op,owner,epoch,data={})=>{
      if(op==="proposal_evidence")throw new Error("lease_denied");
      return f.ingress(op,owner,epoch,data);
    };
    const workspace:IsolatedWorkspace={snapshot:async()=>({revision,changedFiles:content===richSource?[]:plan.files,files:{"README.md":content}}),apply:async(replacements)=>{content=replacements[0].replacement;return proposalEvidence();},validate:async()=>assert.fail("Rejected evidence persistence must not validate")};
    await assert.rejects(runWorker(ingress,workspace,async(body)=>{calls++;return{id:"resp_evidence_lease",model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:100,output_tokens:60},text:proposalFor(body),status:"completed"};}),/bounded diagnostics/);
    const details=(await f.db.query<{details:Record<string,unknown>}>("SELECT details FROM engineering_events WHERE action='block'")).rows[0].details;
    assert.equal((details.diagnostic as Record<string,unknown>).code,"lease_or_fence_lost");
  }finally{await f.close();}
});
test("terminal block ingress failure preserves primary diagnostic and reports unknown durable disposition",async()=>{
  const f=await fixture();try{
    const ingress:Ingress=async(op,owner,epoch,data={})=>{
      if(op==="block")throw new Error("lease_denied");
      return f.ingress(op,owner,epoch,data);
    };
    const workspace:IsolatedWorkspace={snapshot:async()=>({revision,changedFiles:[],files:{"README.md":richSource}}),apply:async()=>assert.fail(),validate:async()=>assert.fail()};
    await assert.rejects(runWorker(ingress,workspace,async()=>({id:"block-ingress-fail",model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:100,output_tokens:100},text:"not-json",status:"completed"})),error=>{
      assert.ok(error instanceof WorkerExitError);
      assert.equal(error.report.primary.code,"proposal_invalid_json");
      assert.equal(error.report.durableDisposition,"unknown");
      assert.equal(error.report.terminalization.blockRecorded,false);
      assert.equal(error.report.terminalization.ingressError,"lease_denied");
      return true;
    });
    assert.equal((await f.db.query("SELECT * FROM engineering_events WHERE task_id=$1 AND action='block'",[f.task.id])).rows.length,0);
  }finally{await f.close();}
});
test("primary validation failure with cleanup failure keeps proposal code in exit report",async()=>{
  const f=await fixture();try{
    const workspace:IsolatedWorkspace={snapshot:async()=>({revision,changedFiles:[],files:{"README.md":richSource}}),apply:async()=>assert.fail(),validate:async()=>assert.fail(),dispose:async()=>{throw new DockerCleanupError([{resourceType:"source-volume",category:"resource_in_use"}]);}};
    await assert.rejects(runWorker(f.ingress,workspace,async()=>({id:"primary-cleanup-terminal",model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:100,output_tokens:100},text:"not-json",status:"completed"})),error=>{
      assert.ok(error instanceof WorkerExitError);
      assert.equal(error.report.primary.code,"proposal_invalid_json");
      assert.equal(error.report.cleanupOutcome,"failed");
      assert.deepEqual(error.report.cleanupFailures,[{resourceType:"source-volume",category:"resource_in_use"}]);
      assert.equal(error.report.terminalization.blockRecorded,true);
      assert.equal(error.report.durableDisposition,"blocked");
      return true;
    });
  }finally{await f.close();}
});
test("declines validation cycle when remaining authorized runtime is below reserve plus gate maxima",async()=>{
  const f=await fixture();try{
    const runRow=(await f.db.query<{started_at:Date}>("SELECT started_at FROM engineering_runs WHERE id=$1::uuid",[f.run])).rows[0];
    const startedAtMs=runRow.started_at.getTime();
    let gateCalls=0;
    const workspace:IsolatedWorkspace={snapshot:async()=>({revision,changedFiles:[],files:{"README.md":richSource}}),apply:async()=>proposalEvidence(),validate:async()=>{gateCalls++;return{revision,outcome:"passed"};}};
    const nowMs=startedAtMs+authorizationDurationMs-terminalizationReserveMs-1;
    await assert.rejects(runWorker(f.ingress,workspace,async(body)=>({id:"deadline-cycle",model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:100,output_tokens:100},text:proposalFor(body)}),{now:()=>nowMs}),error=>{
      assert.ok(error instanceof WorkerExitError);
      assert.equal(error.report.primary.code,"runtime_deadline_exceeded");
      assert.equal(error.report.primary.validationStage,"validation_cycle");
      return true;
    });
    assert.equal(gateCalls,0);
  }finally{await f.close();}
});
test("declines a validation gate when its maximum duration exceeds remaining budget after reserve",async()=>{
  const f=await fixture();try{
    let current=revision;
    const runRow=(await f.db.query<{started_at:Date}>("SELECT started_at FROM engineering_runs WHERE id=$1::uuid",[f.run])).rows[0];
    const startedAtMs=runRow.started_at.getTime();
    const gateCount=6;
    const cycleMax=60_000+gateCount*validationGateMaxMs;
    let nowMs=startedAtMs+authorizationDurationMs-terminalizationReserveMs-cycleMax-1_000;
    const workspace:IsolatedWorkspace={
      snapshot:async()=>({revision:current,changedFiles:current===revision?[]:plan.files,files:{"README.md":richSource}}),
      apply:async(_replacements,rev)=>{assert.equal(rev,current);current="c".repeat(40);return proposalEvidence(current);},
      prepareValidationEnvironment:async()=>{nowMs=startedAtMs+authorizationDurationMs-terminalizationReserveMs-validationGateMaxMs+1;},
      validate:async()=>({revision:current,outcome:"passed"}),
    };
    await assert.rejects(runWorker(f.ingress,workspace,async(body)=>({id:"deadline-gate",model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:100,output_tokens:100},text:proposalFor(body)}),{now:()=>nowMs}),error=>{
      assert.ok(error instanceof WorkerExitError);
      assert.equal(error.report.primary.code,"runtime_deadline_exceeded");
      assert.equal(error.report.primary.validationStage,"validation_gate");
      assert.equal(error.report.primary.validationGate,"test");
      return true;
    });
  }finally{await f.close();}
});
test("declines another repair cycle when the next validation cycle exceeds remaining budget",async()=>{
  const f=await fixture();try{
    let current=revision,content=richSource,calls=0;
    const runRow=(await f.db.query<{started_at:Date}>("SELECT started_at FROM engineering_runs WHERE id=$1::uuid",[f.run])).rows[0];
    const startedAtMs=runRow.started_at.getTime();
    const gateCount=6;
    const cycleMax=60_000+gateCount*validationGateMaxMs;
    let nowMs=startedAtMs+authorizationDurationMs-terminalizationReserveMs-cycleMax-120_000;
    const workspace:IsolatedWorkspace={
      snapshot:async()=>({revision:current,changedFiles:content===richSource?[]:plan.files,files:{"README.md":content}}),
      apply:async(replacements,rev)=>{assert.equal(rev,current);content=replacements[0].replacement;current="c".repeat(40);return proposalEvidence(current);},
      validate:async(args,rev)=>{
        if(args[2]==="test:engineering"){
          nowMs=startedAtMs+authorizationDurationMs-terminalizationReserveMs-cycleMax+1;
        }
        return args[2]==="lint"?{revision:rev,outcome:"failed",exitCode:1,category:"command_failed"}:{revision:rev,outcome:"passed"};
      },
    };
    await assert.rejects(runWorker(f.ingress,workspace,async(body)=>{calls++;return{id:`repair-deadline-${calls}`,model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:100,output_tokens:100},text:proposalFor(body)};},{now:()=>nowMs}),error=>{
      assert.ok(error instanceof WorkerExitError);
      assert.equal(error.report.primary.code,"runtime_deadline_exceeded");
      assert.equal(error.report.primary.validationStage,"validation_cycle");
      return true;
    });
    assert.equal(calls,1);
  }finally{await f.close();}
});
test("interrupted validation gate without evidence receipt surfaces validation_protocol_error",async()=>{
  const f=await fixture();try{
    let current=revision;
    const workspace:IsolatedWorkspace={
      snapshot:async()=>({revision:current,changedFiles:current===revision?[]:plan.files,files:{"README.md":richSource}}),
      apply:async(_replacements,rev)=>{assert.equal(rev,current);current="c".repeat(40);return proposalEvidence(current);},
      validate:async(args)=>{if(args[2]==="lint")throw new Error("private docker host detail");return{revision:current,outcome:"passed"};},
    };
    await assert.rejects(runWorker(f.ingress,workspace,async(body)=>({id:"gate-interrupted",model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:100,output_tokens:100},text:proposalFor(body)})),error=>{
      assert.ok(error instanceof WorkerExitError);
      assert.equal(error.report.primary.code,"validation_protocol_error");
      assert.equal(error.report.primary.validationGate,"lint");
      return true;
    });
    assert.equal((await f.db.query("SELECT * FROM engineering_validations WHERE run_id=$1::uuid AND command='lint'",[f.run])).rows.length,0);
  }finally{await f.close();}
});
test("missing started_at fails closed before validation gates with structured exit",async()=>{
  const f=await fixture();try{
    let gateCalls=0,calls=0;
    const ingress:Ingress=async(op,owner,epoch,data={})=>{
      const result=await f.ingress(op,owner,epoch,data);
      if(op==="claim")return{...result,started_at:undefined};
      return result;
    };
    const workspace:IsolatedWorkspace={snapshot:async()=>({revision,changedFiles:[],files:{"README.md":richSource}}),apply:async()=>proposalEvidence(),validate:async()=>{gateCalls++;return{revision,outcome:"passed"};}};
    await assert.rejects(runWorker(ingress,workspace,async()=>{calls++;throw new Error("provider must not run");}),error=>{
      assert.ok(error instanceof WorkerExitError);
      assert.equal(error.report.primary.code,"worker_failure");
      assert.equal(error.report.primary.validationStage,"validation_cycle");
      return true;
    });
    assert.equal(calls,0);assert.equal(gateCalls,0);
  }finally{await f.close();}
});
test("malformed started_at fails closed before validation gates with structured exit",async()=>{
  const f=await fixture();try{
    let gateCalls=0;
    const ingress:Ingress=async(op,owner,epoch,data={})=>{
      const result=await f.ingress(op,owner,epoch,data);
      if(op==="claim")return{...result,started_at:"not-an-authorization-timestamp"};
      return result;
    };
    const workspace:IsolatedWorkspace={snapshot:async()=>({revision,changedFiles:[],files:{"README.md":richSource}}),apply:async()=>proposalEvidence(),validate:async()=>{gateCalls++;return{revision,outcome:"passed"};}};
    await assert.rejects(runWorker(ingress,workspace,async(body)=>({id:"malformed-started-at",model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:100,output_tokens:100},text:proposalFor(body)})),error=>{
      assert.ok(error instanceof WorkerExitError);
      assert.equal(error.report.primary.code,"worker_failure");
      return true;
    });
    assert.equal(gateCalls,0);
  }finally{await f.close();}
});
test("post-claim EngineeringInputError emits bounded exit report with preserved cleanup primary",async()=>{
  const f=await fixture();try{
    let current=revision,content=richSource,calls=0;
    const workspace:IsolatedWorkspace={
      snapshot:async()=>({revision:current,changedFiles:content===richSource?[]:plan.files,files:{"README.md":content}}),
      apply:async(replacements,rev)=>{assert.equal(rev,current);content=replacements[0].replacement;current="c".repeat(40);return proposalEvidence(current);},
      validate:async()=>({revision:current,outcome:"passed"}),
      dispose:async()=>{throw new DockerCleanupError([{resourceType:"source-volume",category:"resource_in_use"}]);},
    };
    await assert.rejects(runWorker(f.ingress,workspace,async(body)=>{calls++;return{id:`cleanup-exit-${calls}`,model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:100,output_tokens:100},text:calls===1?proposalFor(body):'{"passed":true}'};}),error=>{
      assert.ok(error instanceof WorkerExitError);
      assert.equal(error.report.primary.code,"sandbox_cleanup_failed");
      assert.equal(error.report.cleanupOutcome,"failed");
      assert.equal(error.report.durableDisposition,"blocked");
      assert.equal(JSON.stringify(error.report).includes("Sandbox resource cleanup failed"),false);
      return true;
    });
    assert.equal(calls,2);
  }finally{await f.close();}
});
test("post-claim self-review EngineeringInputError preserves worker_failure primary in exit report",async()=>{
  const f=await fixture();try{
    let current=revision,content=richSource,calls=0;
    const workspace:IsolatedWorkspace={
      snapshot:async()=>({revision:current,changedFiles:content===richSource?[]:plan.files,files:{"README.md":content}}),
      apply:async(replacements,rev)=>{assert.equal(rev,current);content=replacements[0].replacement;current="c".repeat(40);return proposalEvidence(current);},
      validate:async()=>({revision:current,outcome:"passed"}),
    };
    await assert.rejects(runWorker(f.ingress,workspace,async(body)=>{calls++;return{id:`review-exit-${calls}`,model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:100,output_tokens:100},text:calls===1?proposalFor(body):'{"passed":false}'};}),error=>{
      assert.ok(error instanceof WorkerExitError);
      assert.equal(error.report.primary.code,"worker_failure");
      assert.equal(JSON.stringify(error.report).includes("Self-review failed"),false);
      return true;
    });
    assert.equal(calls,2);
  }finally{await f.close();}
});
test("primary validation failure with cleanup and terminal block failures stay bounded and unknown disposition",async()=>{
  const f=await fixture();try{
    let current=revision;
    const ingress:Ingress=async(op,owner,epoch,data={})=>{
      if(op==="block")throw new Error("lease_denied");
      return f.ingress(op,owner,epoch,data);
    };
    const workspace:IsolatedWorkspace={
      snapshot:async()=>({revision:current,changedFiles:current===revision?[]:plan.files,files:{"README.md":richSource}}),
      apply:async(_replacements,rev)=>{assert.equal(rev,current);current="c".repeat(40);return proposalEvidence(current);},
      validate:async(args,rev)=>{
        if(args[2]==="lint")throw new Error("private docker detail");
        return{revision:rev,outcome:"passed"};
      },
      dispose:async()=>{throw new DockerCleanupError([{resourceType:"source-volume",category:"resource_in_use"}]);},
    };
    await assert.rejects(runWorker(ingress,workspace,async(body)=>({id:"triple-failure",model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:100,output_tokens:100},text:proposalFor(body)})),error=>{
      assert.ok(error instanceof WorkerExitError);
      assert.equal(error.report.primary.code,"validation_protocol_error");
      assert.equal(error.report.primary.validationGate,"lint");
      assert.notEqual(error.report.primary.code,"sandbox_cleanup_failed");
      assert.equal(error.report.cleanupOutcome,"failed");
      assert.deepEqual(error.report.cleanupFailures,[{resourceType:"source-volume",category:"resource_in_use"}]);
      assert.equal(error.report.terminalization.blockRecorded,false);
      assert.equal(error.report.terminalization.ingressError,"lease_denied");
      assert.equal(error.report.durableDisposition,"unknown");
      const serialized=JSON.stringify(error.report);
      assert.equal(serialized.includes("lease_denied"),true);
      assert.equal(serialized.includes("DATABASE_URL"),false);
      assert.equal(serialized.includes("private"),false);
      return true;
    });
    assert.equal((await f.db.query("SELECT * FROM engineering_events WHERE task_id=$1 AND action='block'",[f.task.id])).rows.length,0);
  }finally{await f.close();}
});
