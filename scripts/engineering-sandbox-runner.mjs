import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { buildSandboxValidationPayload } from './validation-diagnostic-excerpt.mjs';
const command=process.argv[2];
if(!['test','test:engineering','lint','typecheck','build','security:check'].includes(command)||process.argv.length!==3)process.exit(64);
// Dependencies are a real, separately mounted read-only directory inside the
// workspace. Git metadata lives in private tmpfs; no host .git, credentials,
// network or remotes are available.
const modules='/workspace/node_modules';
const moduleInfo=lstatSync(modules);
if(!moduleInfo.isDirectory()||moduleInfo.isSymbolicLink())process.exit(65);
const probe=`${modules}/.engineering-readonly-${randomUUID()}`;
try{writeFileSync(probe,'probe',{flag:'wx'});unlinkSync(probe);process.exit(66);}
catch(error){if(!['EROFS','EACCES'].includes(error.code))process.exit(67);}
const env={...process.env,GIT_DIR:'/tmp/engineering-git',GIT_WORK_TREE:'/workspace',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'isolated-validation',GIT_AUTHOR_EMAIL:'validation@localhost',GIT_COMMITTER_NAME:'isolated-validation',GIT_COMMITTER_EMAIL:'validation@localhost'};
try{
 const initEnv={...env};delete initEnv.GIT_WORK_TREE;
 execFileSync('git',['init','--bare',env.GIT_DIR],{env:initEnv,stdio:'ignore'});
 execFileSync('git',['add','--all'],{env,stdio:'ignore'});
 execFileSync('git',['commit','--allow-empty','-m','Credential-free validation snapshot'],{env,stdio:'ignore'});
 const diagnosticBundler=process.env.ENGINEERING_BUILD_DIAGNOSTIC_BUNDLER;
 if(diagnosticBundler!==undefined&&(!['webpack'].includes(diagnosticBundler)||command!=='build'||process.env.ENGINEERING_BUILD_DIAGNOSTIC_TRACE!=='true'))process.exit(68);
 const npmArgs=diagnosticBundler==='webpack'?['run','build','--','--webpack']:['run',command];
 const result=spawnSync('npm',npmArgs,{env,encoding:'utf8',maxBuffer:16*1024*1024});
 const diagnostic={...buildSandboxValidationPayload(command,result.stdout,result.stderr,result),...(process.env.ENGINEERING_BUILD_DIAGNOSTIC_TRACE==='true'?{parentPid:process.pid,childPid:Number.isInteger(result.pid)?result.pid:null,childExecutable:'npm'}:{})};
 console.log(`ENGINEERING_VALIDATION_RESULT=${JSON.stringify(diagnostic)}`);
 if(result.error)process.exit(result.error.code==='ETIMEDOUT'?124:70);
 if(result.status!==0)process.exit(typeof result.status==='number'?result.status:70);
}catch(error){process.exit(typeof error.status==='number'?error.status:70);}
