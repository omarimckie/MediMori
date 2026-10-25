// Preserve the prior import surface while routing target checks through the
// fixed target resolver and its isolated Git object graph.
export { verifyWorkerTargetAncestry as verifyTargetAncestry, TargetAncestryError } from "./merge-target";
