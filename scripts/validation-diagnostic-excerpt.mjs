/** Shared sandbox/host validation diagnostic extraction (keep runner and host aligned). */
const signals = new Set(['SIGABRT', 'SIGBUS', 'SIGFPE', 'SIGILL', 'SIGKILL', 'SIGSEGV', 'SIGTERM']);
const testName = /^\s*(?:not ok\s+\d+\s+-\s+|failed test:\s*)(.{1,200})\s*$/;
const secretPatterns = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g,
  /\b(?:postgres(?:ql)?:\/\/)[^\s]+/gi,
  /\b(?:password|token|secret|authorization)\s*[:=]\s*[^\s,;]+/gi,
];
const buildActionableLine =
  /^(?:Failed to compile\.?|Type error:|Module not found:|Syntax error:|Error:|×\s|\.\/[^\s]+:\d+:\d+|>\s+\d+\s+\|)/i;

export function sanitizeValidationLabel(value) {
  let label = value.replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ').replace(/["'`]/g, '').trim();
  for (const pattern of secretPatterns) label = label.replace(pattern, '[redacted]');
  label = label.replace(/\/workspace\//g, '');
  label = label.replace(/[A-Za-z]:[/\\][^\s]+/g, '[path]');
  label = label.replace(/(?:^|\s)\/(?:tmp|home|Users|var|etc|root|private)[^\s]*/gi, ' [path]');
  label = label.replace(/(?:^|\s)\/(?!src\/)[^\s]+/g, ' [path]');
  return label.slice(0, 200);
}

export function boundedValidationExcerpt(command, output) {
  const lines = output.split(/\r?\n/);
  const failureBlocks = [];
  for (let index = 0; index < lines.length; index++) {
    const match = testName.exec(lines[index]);
    if (!match) continue;
    let end = index + 1;
    while (end < lines.length && end < index + 24 && !/^\s*not ok\s+\d+\s+-/.test(lines[end])) end++;
    failureBlocks.push({ name: sanitizeValidationLabel(match[1]), block: lines.slice(index + 1, end).join('\n') });
  }
  const names = [...new Set(failureBlocks.map(item => item.name))].slice(0, 8);
  const files = [...new Set(failureBlocks.flatMap(item => {
    const match = /\/workspace\/(src\/lib\/engineering\/[A-Za-z0-9_.-]+\.test\.tsx?):\d+(?::\d+)?/.exec(item.block)
      ?? /^((?:src\/lib\/engineering\/[A-Za-z0-9_.-]+\.test\.tsx?)):\d+/m.exec(item.block);
    return match && !match[1].includes('..') ? [match[1]] : [];
  }))].slice(0, 8);
  const markers = [];
  if (/next build/i.test(output)) markers.push('Next.js build command started');
  const nextVersion = /Next\.js\s+v?(\d+\.\d+\.\d+)/i.exec(output)?.[1];
  if (nextVersion) markers.push(`Next.js ${nextVersion}`);
  const phase = /(?:Creating an optimized production build|Compiling|Collecting page data|Generating static pages|Finalizing page optimization)/i.exec(output)?.[0];
  if (phase) markers.push(sanitizeValidationLabel(phase));
  const buildErrors = [];
  if (/build/i.test(command)) {
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length > 400) continue;
      if (buildActionableLine.test(trimmed) || (/^./.test(trimmed) && /:\d+:\d+/.test(trimmed))) {
        buildErrors.push(sanitizeValidationLabel(trimmed));
      }
    }
  }
  const excerpt = [...new Set([
    ...markers,
    ...buildErrors,
    ...names.map(name => `failed test: ${name}`),
  ])].slice(0, 8).map(s => s.slice(0, 240));
  return { excerpt, failedTests: names, failedTestFiles: files };
}

export function buildSandboxValidationPayload(command, stdout, stderr, spawnResult) {
  const output = `${stdout ?? ''}\n${stderr ?? ''}`;
  const parsed = boundedValidationExcerpt(command, output.slice(0, 1024 * 1024));
  const safeOutput = [...new Set(parsed.excerpt)].slice(0, 8).join('\n');
  return {
    exitCode: Number.isInteger(spawnResult.status) ? spawnResult.status : null,
    signal: signals.has(spawnResult.signal) ? spawnResult.signal : null,
    timedOut: spawnResult.error?.code === 'ETIMEDOUT',
    output: safeOutput,
    failedTests: parsed.failedTests,
    failedTestFiles: parsed.failedTestFiles,
  };
}
