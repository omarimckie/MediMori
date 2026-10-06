import { EngineeringInputError, classifyRisk, parsePlan, type Plan } from "./policy";

// Bounded exact-text replacement proposals keep small edits compact. The
// 8,192-token ceiling remains a hard maximum; all reservation and run limits
// remain enforced independently of proposal size.
export const workerLimits = Object.freeze({ softUsd: .25, stopUsd: .75, contextBytes: 24000, contextTokens: 26000, outputTokens: 8192, leaseSeconds: 90 });
export const approvedModels = ["gpt-6-luna", "gpt-6.1-sol"] as const;
export type Model = typeof approvedModels[number];
export type Rates = { input: number; output: number; cacheWrite: number; usageInput: number; usageOutput: number; usageCacheWrite: number; tier: "default"; endpoint: "https://api.openai.com/v1/responses"; regime: "worst-case-long-context" };
// Upper envelope: long context + Fast premium + 10% endpoint uplift, even
// though this executor permits only the global Standard endpoint, no paid tools.
export const defaultRates: Record<Model, Rates> = {
  "gpt-6-luna": { input: .55, output: 1.65, cacheWrite: .6875, usageInput: .1, usageOutput: .5, usageCacheWrite: .125, tier: "default", endpoint: "https://api.openai.com/v1/responses", regime: "worst-case-long-context" },
  "gpt-6.1-sol": { input: 11, output: 33, cacheWrite: 13.75, usageInput: 2, usageOutput: 10, usageCacheWrite: 2.5, tier: "default", endpoint: "https://api.openai.com/v1/responses", regime: "worst-case-long-context" },
};
export function pricing(model: Model, configured = defaultRates): Rates {
  if (!(approvedModels as readonly string[]).includes(model)) throw new EngineeringInputError("Unapproved model.");
  const r = configured[model];
  if (!r || r.endpoint !== defaultRates[model].endpoint || r.tier !== "default" || r.regime !== "worst-case-long-context" || ["input", "output", "cacheWrite", "usageInput", "usageOutput", "usageCacheWrite"].some(k => !Number.isFinite(r[k as "input"]) || r[k as "input"] < defaultRates[model][k as "input"])) throw new EngineeringInputError("Unsafe rate configuration.");
  return { input: r.input, output: r.output, cacheWrite: r.cacheWrite, usageInput: r.usageInput, usageOutput: r.usageOutput, usageCacheWrite: r.usageCacheWrite, tier: r.tier, endpoint: r.endpoint, regime: r.regime };
}
export function quote(input: number, output: number, rate: Rates) {
  if (![input, output].every(n => Number.isSafeInteger(n) && n >= 0)) throw new EngineeringInputError("Invalid token bound.");
  return Math.ceil(input * Math.max(rate.input, rate.cacheWrite) + output * rate.output); // integer microdollars, rounded upward
}
export function protectedPath(path: string) {
  return /(^|\/)(\.env[^/]*|\.git[^/]*|node_modules|sql|scripts|engineering|admin|api|db|auth|security)(\/|$)|(^|\/)db\.|auth|security|stripe|payment|checkout|publish|vercel|middleware|migration|\.sql$|(^|\/)(package[^/]*\.json|.*lock.*|.*config.*|next-env\.d\.ts)$/i.test(path);
}
export function assertScope(plan: Plan, files: string[]) {
  for (const path of files) {
    if (!/^[\w/-]+\.[\w.-]+$/.test(path) || path.includes("..") || path.startsWith("/") || !plan.files.includes(path) || protectedPath(path)) throw new EngineeringInputError("File outside executable scope.");
  }
}
export function requiredValidations(plan: Plan) {
  return [...new Set(["lint", "typecheck", "security:check", ...plan.validations, ...(classifyRisk(plan) === "low" && plan.files.every(f => f.endsWith(".md")) ? [] : ["test", "test:engineering", "build"])])];
}
export function executablePlan(value: unknown) {
  const plan = parsePlan(value);
  if (plan.operations.length) throw new EngineeringInputError("Protected operation requires a separate human executor.");
  assertScope(plan, plan.files);
  if (requiredValidations(plan).some(c => !plan.validations.includes(c))) throw new EngineeringInputError("Plan omits mandatory validation.");
  return plan;
}
export function commandArgs(command: string) {
  if (!["test", "lint", "typecheck", "build", "security:check", "test:engineering"].includes(command)) throw new EngineeringInputError("Command denied.");
  return ["npm", "run", command] as const;
}
