import { createHash } from "node:crypto";
import { EngineeringInputError, type Plan } from "./policy";
import { assertScope } from "./worker-policy";

export type AnchorSnapshot = { revision: string; changedFiles: string[]; files: Record<string, string> };
export type IssuedAnchor = { id: string; path: string; revision: string; contentSha256: string; content: string };
export type AnchorReplacement = { anchor: IssuedAnchor; replacement: string };
export type ResolvedProposal = AnchorReplacement[];
export type ProposalShapeCategory = "top_level_not_object" | "missing_replacements" | "replacements_not_array" | "replacement_not_object" | "missing_replacement_text" | "unexpected_field" | "wrong_field_type" | "empty_replacements" | "excessive_replacements" | "other_schema_mismatch";
export type AnchorFailureCode = "proposal_invalid_json" | "proposal_invalid_shape" | "proposal_invalid_content" | "replacement_scope_rejected" | "replacement_revision_mismatch" | "replacement_target_missing" | "replacement_target_ambiguous";

export class AnchorProtocolError extends EngineeringInputError {
  constructor(readonly code: AnchorFailureCode, readonly shapeCategory?: ProposalShapeCategory) {
    super("Bounded replacement proposal rejected.");
  }
}

export const anchorLimits = Object.freeze({
  minBytes: 96,
  maxBytes: 480,
  minWords: 8,
  maxLines: 8,
  maxCandidatesCheckedPerFile: 96,
  maxCandidatesPerBlock: 16,
  maxContextBlocksPerFile: 12,
  maxAnchorsPerFile: 8,
  maxAnchors: 24,
  maxCatalogBytes: 6000,
  maxContextBytes: 24000,
  sourceContextBytes: 12000,
});

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function issuedAnchorId(path: string, revision: string, contentSha256: string) {
  return sha256(`medimori-engineering-anchor-v1\0${path}\0${revision}\0${contentSha256}`);
}

export function verifyAnchorIdentity(anchor: IssuedAnchor, expectedRevision: string) {
  if (anchor.revision !== expectedRevision) throw new AnchorProtocolError("replacement_revision_mismatch");
  try { assertScope({ files: [anchor.path] } as Plan, [anchor.path]); }
  catch { throw new AnchorProtocolError("replacement_scope_rejected"); }
  if (!/^[a-f0-9]{64}$/.test(anchor.contentSha256) || sha256(anchor.content) !== anchor.contentSha256 || issuedAnchorId(anchor.path, anchor.revision, anchor.contentSha256) !== anchor.id) {
    throw new AnchorProtocolError("proposal_invalid_content");
  }
}

function wordCount(value: string) {
  return value.match(/[a-z0-9]{2,}/gi)?.length ?? 0;
}

/** Count only as far as needed to prove uniqueness; source text is never returned in diagnostics. */
export function literalMatchCountUpToTwo(source: string, literal: string): 0 | 1 | 2 {
  const first = source.indexOf(literal);
  if (first < 0) return 0;
  return source.indexOf(literal, first + 1) < 0 ? 1 : 2;
}

type Block = { start: number; text: string; score: number; sectionStart: number };
type ModelAnchor = { id: string; path: string; text: string };
export type BoundedReplacementContext = { text: string; anchors: IssuedAnchor[] };

function distributedBlocks(blocks: Block[], totalLines: number): Block[] {
  void totalLines;
  const sections = new Map<number, Block[]>();
  for (const block of blocks) {
    const list = sections.get(block.sectionStart) ?? [];
    list.push(block);
    sections.set(block.sectionStart, list);
  }
  // Give each Markdown section one representative excerpt, then rank those
  // representatives by task relevance. This avoids adjacent paragraphs from
  // crowding out a relevant later section while keeping context bounded.
  const representatives = [...sections.values()]
    .map(list => list.sort((a, b) => b.score - a.score || a.start - b.start)[0])
    .sort((a, b) => b.score - a.score || a.start - b.start)
    .slice(0, anchorLimits.maxContextBlocksPerFile);
  const chosenStarts = new Set(representatives.map(block => block.start));
  const remaining = blocks.filter(block => !chosenStarts.has(block.start)).sort((a, b) => b.score - a.score || a.start - b.start);
  return [...representatives, ...remaining].slice(0, anchorLimits.maxContextBlocksPerFile);
}

function boundedWindows(text: string): string[] {
  const words = [...text.matchAll(/\S+/g)];
  if (!words.length) return [];
  const possible: string[] = [];
  for (let start = 0; start < words.length; start++) {
    const startAt = words[start].index!;
    let end = start;
    while (end < words.length) {
      const endAt = words[end].index! + words[end][0].length;
      const bytes = Buffer.byteLength(text.slice(startAt, endAt));
      if (bytes > anchorLimits.maxBytes) break;
      if (bytes >= anchorLimits.minBytes && wordCount(text.slice(startAt, endAt)) >= anchorLimits.minWords) {
        possible.push(text.slice(startAt, endAt));
        break;
      }
      end++;
    }
  }
  if (possible.length <= anchorLimits.maxCandidatesPerBlock) return possible;
  const sampled: string[] = [];
  for (let i = 0; i < anchorLimits.maxCandidatesPerBlock; i++) {
    const at = Math.floor(i * (possible.length - 1) / (anchorLimits.maxCandidatesPerBlock - 1));
    sampled.push(possible[at]);
  }
  return [...new Set(sampled)];
}

/** Selects bounded approved-source excerpts first, then issues unique anchors only from those exact excerpts. */
export function buildBoundedReplacementContext(plan: Plan, snapshot: AnchorSnapshot, includeAnchors = true): BoundedReplacementContext {
  if (!/^[a-f0-9]{40}$/.test(snapshot.revision)) throw new EngineeringInputError("Untrusted revision.");
  assertScope(plan, snapshot.changedFiles);
  assertScope(plan, Object.keys(snapshot.files));
  const terms = new Set(plan.summary.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
  const excerpts: Record<string, string> = {};
  const selectedByPath: Array<{ path: string; content: string; blocks: Block[] }> = [];
  let sourceBudget = anchorLimits.sourceContextBytes;
  for (const [path, content] of Object.entries(snapshot.files).sort(([a], [b]) => a.localeCompare(b))) {
    const lines = content.split("\n");
    const blocks: Block[] = [];
    let sectionStart = 0;
    for (let i = 0; i < lines.length;) {
      while (i < lines.length && !lines[i].trim()) i++;
      if (i >= lines.length) break;
      const start = i;
      let end = start + 1;
      while (end < lines.length && lines[end].trim()) end++;
      const text = lines.slice(start, end).join("\n");
      const headingOffset = lines.slice(start, end).findIndex(line => /^#{1,6}\s/.test(line));
      if (headingOffset >= 0) sectionStart = start + headingOffset;
      const words = text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
      blocks.push({ start, text, score: words.reduce((n, word) => n + Number(terms.has(word)), 0), sectionStart });
      i = end;
    }
    const perFileLimit = Math.min(6000, Math.floor(sourceBudget / Math.max(1, Object.keys(snapshot.files).length)));
    const chosen = distributedBlocks(blocks, lines.length);
    const selected: string[] = [];
    const included: Block[] = [];
    let used = 0;
    for (const block of chosen) {
      const cost = Buffer.byteLength(block.text) + 32;
      if (used + cost > perFileLimit) continue;
      selected.push(`[lines ${block.start + 1}-${block.start + block.text.split("\n").length}]\n${block.text}`);
      included.push(block);
      used += cost;
    }
    excerpts[path] = selected.join("\n…\n");
    selectedByPath.push({ path, content, blocks: included });
    sourceBudget -= used;
  }

  const anchors: IssuedAnchor[] = [];
  let catalogBytes = 0;
  if (includeAnchors) {
    for (const { path, content, blocks } of selectedByPath) {
      let checked = 0;
      let issuedForPath = 0;
      const seen = new Set<string>();
      const candidates: Array<{ text: string; score: number; blockStart: number; lineStart: number; lineCount: number }> = [];
      for (const block of blocks) {
        const blockLines = block.text.split("\n");
        let generatedForBlock = 0;
        for (const text of boundedWindows(block.text)) {
          candidates.push({ text, score: block.score, blockStart: block.start, lineStart: 0, lineCount: blockLines.length });
          if (++generatedForBlock >= anchorLimits.maxCandidatesPerBlock) break;
        }
        for (let lineCount = Math.min(anchorLimits.maxLines, blockLines.length); lineCount >= 1; lineCount--) {
          for (let offset = 0; offset + lineCount <= blockLines.length; offset++) {
            const text = blockLines.slice(offset, offset + lineCount).join("\n");
            const bytes = Buffer.byteLength(text);
            if (bytes < anchorLimits.minBytes || bytes > anchorLimits.maxBytes || wordCount(text) < anchorLimits.minWords) continue;
            candidates.push({ text, score: block.score, blockStart: block.start, lineStart: offset, lineCount });
            if (++generatedForBlock >= anchorLimits.maxCandidatesPerBlock) break;
          }
          if (generatedForBlock >= anchorLimits.maxCandidatesPerBlock) break;
        }
      }
      candidates.sort((a, b) => b.score - a.score || a.blockStart - b.blockStart || a.lineStart - b.lineStart || b.lineCount - a.lineCount || Buffer.byteLength(b.text) - Buffer.byteLength(a.text));
      const distributedCandidates: typeof candidates = [];
      const candidateBlocks = [...new Set(candidates.map(candidate => candidate.blockStart))];
      for (const blockStart of candidateBlocks) {
        const candidate = candidates.find(item => item.blockStart === blockStart);
        if (candidate) distributedCandidates.push(candidate);
      }
      const firstPass = new Set(distributedCandidates.map(candidate => candidate.text));
      distributedCandidates.push(...candidates.filter(candidate => !firstPass.has(candidate.text)));
      for (const candidate of distributedCandidates) {
        if (checked >= anchorLimits.maxCandidatesCheckedPerFile || issuedForPath >= anchorLimits.maxAnchorsPerFile || anchors.length >= anchorLimits.maxAnchors) break;
        checked++;
        if (!excerpts[path].includes(candidate.text)) continue;
        const contentSha256 = sha256(candidate.text);
        const id = issuedAnchorId(path, snapshot.revision, contentSha256);
        if (seen.has(id) || literalMatchCountUpToTwo(content, candidate.text) !== 1) continue;
        const modelAnchor: ModelAnchor = { id, path, text: candidate.text };
        const bytes = Buffer.byteLength(JSON.stringify(modelAnchor)) + 1;
        if (catalogBytes + bytes > anchorLimits.maxCatalogBytes) continue;
        seen.add(id);
        anchors.push({ id, path, revision: snapshot.revision, contentSha256, content: candidate.text });
        issuedForPath++;
        catalogBytes += bytes;
      }
    }
  }
  const modelAnchors: ModelAnchor[] = anchors.map(({ id, path, content }) => ({ id, path, text: content }));
  const text = JSON.stringify({ files: excerpts, ...(includeAnchors ? { replacementAnchors: modelAnchors } : {}) });
  if (Buffer.byteLength(text) > anchorLimits.maxContextBytes) throw new EngineeringInputError("Engineering context byte limit.");
  return { text, anchors };
}

export const replacementProposalSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    replacements: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          anchorId: { type: "string", minLength: 64, maxLength: 64 },
          replacementText: { type: "string", maxLength: 8000 },
        },
        required: ["anchorId", "replacementText"],
      },
    },
  },
  required: ["replacements"],
} as const;

export function replacementProposalFormat(anchors: readonly IssuedAnchor[]) {
  if (!anchors.length) throw new AnchorProtocolError("proposal_invalid_content");
  const allowed = [...new Set(anchors.map(anchor => anchor.id))];
  return {
    type: "json_schema",
    name: "bounded_replacement_proposal",
    strict: true,
    schema: {
      ...replacementProposalSchema,
      properties: {
        replacements: {
          ...replacementProposalSchema.properties.replacements,
          items: {
            ...replacementProposalSchema.properties.replacements.items,
            properties: {
              ...replacementProposalSchema.properties.replacements.items.properties,
              anchorId: { ...replacementProposalSchema.properties.replacements.items.properties.anchorId, enum: allowed },
            },
          },
        },
      },
    },
  } as const;
}

export function resolveReplacementProposal(plan: Plan, text: string, anchors: readonly IssuedAnchor[], expectedRevision: string): ResolvedProposal {
  const invalidShape = (shapeCategory: ProposalShapeCategory): never => { throw new AnchorProtocolError("proposal_invalid_shape", shapeCategory); };
  if (Buffer.byteLength(text) > 24000) invalidShape("other_schema_mismatch");
  let result: unknown;
  try { result = JSON.parse(text); } catch { throw new AnchorProtocolError("proposal_invalid_json"); }
  if (!result || typeof result !== "object" || Array.isArray(result)) invalidShape("top_level_not_object");
  const proposal = result as Record<string, unknown>;
  if (Object.keys(proposal).some(key => key !== "replacements")) invalidShape("unexpected_field");
  if (!("replacements" in proposal)) invalidShape("missing_replacements");
  if (!Array.isArray(proposal.replacements)) invalidShape("replacements_not_array");
  const rows = proposal.replacements as unknown[];
  if (!rows.length) invalidShape("empty_replacements");
  if (rows.length > 8) invalidShape("excessive_replacements");
  const issued = new Map(anchors.map(anchor => [anchor.id, anchor]));
  const used = new Set<string>();
  const resolved: ResolvedProposal = [];
  for (const item of rows) {
    if (!item || typeof item !== "object" || Array.isArray(item)) invalidShape("replacement_not_object");
    const row = item as Record<string, unknown>;
    if (!("anchorId" in row)) invalidShape("other_schema_mismatch");
    if (!("replacementText" in row)) invalidShape("missing_replacement_text");
    if (Object.keys(row).some(key => !["anchorId", "replacementText"].includes(key))) invalidShape("unexpected_field");
    if (typeof row.anchorId !== "string" || typeof row.replacementText !== "string") invalidShape("wrong_field_type");
    const anchorId = row.anchorId as string;
    const replacementText = row.replacementText as string;
    const anchor = issued.get(anchorId);
    if (!anchor) throw new AnchorProtocolError("proposal_invalid_content");
    if (used.has(anchor.id)) throw new AnchorProtocolError("proposal_invalid_content");
    used.add(anchor.id);
    try { assertScope(plan, [anchor.path]); } catch { throw new AnchorProtocolError("replacement_scope_rejected"); }
    verifyAnchorIdentity(anchor, expectedRevision);
    if (Buffer.byteLength(anchor.content) < anchorLimits.minBytes || Buffer.byteLength(anchor.content) > anchorLimits.maxBytes || wordCount(anchor.content) < anchorLimits.minWords || Buffer.byteLength(replacementText) > 8000) {
      throw new AnchorProtocolError("proposal_invalid_content");
    }
    resolved.push({ anchor, replacement: replacementText });
  }
  return resolved;
}
