import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
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
 const output=`${result.stdout??''}\n${result.stderr??''}`;
 const testMatches=[...output.matchAll(/^\s*not ok\s+\d+\s+-\s+(.{1,200})\s*$/gm)];
 const failedTests=[...new Set(testMatches.map(match=>match[1].replace(/[\r\n\t\x00-\x1f\x7f"'`]/g,' ').replace(/(?:[A-Za-z]:)?[/\\][^\s:]+/g,'[path]').slice(0,200)))].slice(0,8);
 const failedTestFiles=[...new Set(testMatches.flatMap(match=>{const block=output.slice(match.index,match.index+6000);const path=block.match(/\/workspace\/(src\/lib\/engineering\/[A-Za-z0-9_.-]+\.test\.tsx?):\d+/);return path&&!path[1].includes('..')?[path[1]]:[]}))].slice(0,8);
 const excerpt=[];
 if(/next build/i.test(output))excerpt.push('Next.js build command started');
 const nextVersion=output.match(/Next\.js\s+v?(\d+\.\d+\.\d+)/i);if(nextVersion)excerpt.push(`Next.js ${nextVersion[1]}`);
 const phase=output.match(/(?:Creating an optimized production build|Compiling|Collecting page data|Generating static pages|Finalizing page optimization)/i);if(phase)excerpt.push(phase[0]);
 excerpt.push(...failedTests.map(name=>`failed test: ${name}`));
 const safeOutput=[...new Set(excerpt)].slice(0,8).join('\n');
 const diagnostic={exitCode:Number.isInteger(result.status)?result.status:null,signal:['SIGABRT','SIGBUS','SIGFPE','SIGILL','SIGKILL','SIGSEGV','SIGTERM'].includes(result.signal)?result.signal:null,timedOut:result.error?.code==='ETIMEDOUT',output:safeOutput,failedTests,failedTestFiles,...(process.env.ENGINEERING_BUILD_DIAGNOSTIC_TRACE==='true'?{parentPid:process.pid,childPid:Number.isInteger(result.pid)?result.pid:null,childExecutable:'npm'}:{})};
 console.log(`ENGINEERING_VALIDATION_RESULT=${JSON.stringify(diagnostic)}`);
 if(result.error)process.exit(result.error.code==='ETIMEDOUT'?124:70);
 if(result.status!==0)process.exit(typeof result.status==='number'?result.status:70);
}catch(error){process.exit(typeof error.status==='number'?error.status:70);}
