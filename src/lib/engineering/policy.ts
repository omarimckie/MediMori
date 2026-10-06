export class EngineeringInputError extends Error {}
export const statuses = ["intake", "analyzing", "planned", "awaiting_approval", "implementing", "blocked", "cancelled", "escalated"] as const;
export type Status = typeof statuses[number];
export const protectedOperations = ["merge_main", "production_deploy", "production_secrets", "destructive_database", "auth_security", "external_publish", "payments", "production_infrastructure"] as const;
export type ProtectedOperation = typeof protectedOperations[number];
export type Plan = { summary: string; files: string[]; validations: string[]; operations: ProtectedOperation[] };
export const limits = Object.freeze({ contextFiles: 20 });
export const validationCommands = ["test", "lint", "typecheck", "build", "security:check", "test:engineering"] as const;

export function parsePlan(value: unknown): Plan {
  if (!value || typeof value !== "object") throw new EngineeringInputError("Plan is required.");
  const p = value as Record<string, unknown>;
  if (typeof p.summary !== "string" || !p.summary.trim() || p.summary.length > 4000) throw new EngineeringInputError("Invalid plan summary.");
  if (!Array.isArray(p.files) || !p.files.length || p.files.length > limits.contextFiles || p.files.some(f => typeof f !== "string" || f.length > 240 || !/^[\w./-]+$/.test(f) || f.startsWith("/") || f.split("/").includes(".."))) throw new EngineeringInputError("Invalid bounded file scope.");
  if (!Array.isArray(p.validations) || !p.validations.length || p.validations.some(v => !validationCommands.includes(v))) throw new EngineeringInputError("Select allowlisted validations.");
  if (!Array.isArray(p.operations) || p.operations.some(o => !protectedOperations.includes(o))) throw new EngineeringInputError("Invalid protected operations.");
  return { summary: p.summary.trim(), files: [...new Set(p.files as string[])], validations: [...new Set(p.validations as string[])], operations: [...new Set(p.operations as ProtectedOperation[])] };
}

export function classifyRisk(plan: Plan): "low" | "medium" | "high" {
  if (plan.operations.length || plan.files.some(f => /(^|\/)(schema|\.github)(\/|\.)|migration|\.sql$|(^|\/)db\.|auth|security|stripe|payment|checkout|publish|vercel|middleware|\.env/i.test(f))) return "high";
  if (plan.files.some(f => /(^|\/)(api|lib)\//.test(f))) return "medium";
  return "low";
}

const transitions: Partial<Record<Status, Status[]>> = {
  intake: ["analyzing"], analyzing: ["planned"], planned: ["awaiting_approval"],
  awaiting_approval: ["implementing"],
};
export function assertTransition(from: Status, to: Status) {
  if (["cancelled", "blocked", "escalated"].includes(from)) throw new EngineeringInputError("Task is stopped; create a new task to revise scope.");
  if (!["blocked", "cancelled", "escalated"].includes(to) && !transitions[from]?.includes(to)) throw new EngineeringInputError("Invalid lifecycle transition.");
}
