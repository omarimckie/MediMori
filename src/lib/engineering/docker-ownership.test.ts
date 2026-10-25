import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanupOwnedDockerResources, dockerOwnershipArgs, dockerOwnershipLabels, type DockerCommand } from "./docker-ownership";

const owner={taskId:"11111111-1111-4111-8111-111111111111",runId:"22222222-2222-4222-8222-222222222222"};

test("execution Docker resources carry exact task, run, and resource type labels",()=>{
  assert.deepEqual(dockerOwnershipArgs(owner,"source-volume"),[
    "--label",`${dockerOwnershipLabels.task}=${owner.taskId}`,
    "--label",`${dockerOwnershipLabels.run}=${owner.runId}`,
    "--label",`${dockerOwnershipLabels.type}=source-volume`,
  ]);
  assert.throws(()=>dockerOwnershipArgs({...owner,runId:"not-a-uuid"},"source-volume"));
});

test("owned cleanup is label-scoped, idempotent, and never invokes prune",async()=>{
  const calls:string[][]=[];let present=true;
  const docker:DockerCommand=async args=>{
    calls.push(args);
    const typeFilter=args.find(arg=>arg.startsWith(`label=${dockerOwnershipLabels.type}=`));
    if(args[0]==="ps"||args[0]==="volume"&&args[1]==="ls")return present&&["populate-container","source-volume"].some(type=>typeFilter===`label=${dockerOwnershipLabels.type}=${type}`)?`${args[0]==="ps"?"container-owned":"volume-owned"}\n`:"";
    if(args[0]==="rm"||args[0]==="volume"&&args[1]==="rm")return "removed";
    throw new Error("Unexpected Docker command.");
  };
  const first=await cleanupOwnedDockerResources(owner,docker);assert.equal(first.attempted,2);assert.equal(first.removed,2);assert.deepEqual(first.failures,[]);
  present=false;const second=await cleanupOwnedDockerResources(owner,docker);assert.equal(second.attempted,0);assert.equal(second.removed,0);assert.deepEqual(second.failures,[]);
  for(const args of calls){
    assert.ok(!args.includes("prune"));
    if(args[0]==="ps"||args[0]==="volume"&&args[1]==="ls"){
      assert.ok(args.includes(`label=${dockerOwnershipLabels.task}=${owner.taskId}`));
      assert.ok(args.includes(`label=${dockerOwnershipLabels.run}=${owner.runId}`));
      assert.ok(typeFilterExists(args));
    }
  }
});

function typeFilterExists(args:string[]) { return args.some(arg=>arg.startsWith(`label=${dockerOwnershipLabels.type}=`)); }
