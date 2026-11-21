import type { DropwaveAskKind, DropwaveMemoryKind } from "@t3tools/contracts";

const QUOTE_MAX = 500;
const SUMMARY_MAX = 160;
const ASKS_PER_MESSAGE = 24;

export interface ExtractedAsk {
  readonly quote: string;
  readonly summary: string;
  readonly kind: DropwaveAskKind;
  readonly maybe?: boolean | undefined;
}

export interface ExtractedMemory {
  readonly kind: DropwaveMemoryKind;
  readonly text: string;
  readonly quote: string;
}

export function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function clipQuote(value: string): string {
  const line = oneLine(value);
  return line.length > QUOTE_MAX ? `${line.slice(0, QUOTE_MAX - 1).trimEnd()}…` : line;
}

export function clipSummary(value: string): string {
  const line = oneLine(value).replace(/^[-*\d.)\s]+/, "");
  return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX - 1).trimEnd()}…` : line;
}

function normalizedForQuoteCheck(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Verifies a quote appears verbatim in the owner's message so models cannot invent asks or poison memory. */
export function quoteInMessage(quote: string, message: string): boolean {
  const q = normalizedForQuoteCheck(quote).replace(/[.!?,;:…]+$/, "");
  if (q.length < 6 || !q.includes(" ")) return false;
  return normalizedForQuoteCheck(message).includes(q);
}

const ACK_ONLY =
  /^(?:ok(?:ay)?|k|kk|yes|yep|yeah|ya|no|nope|nah|sure|thanks?|thank you|thx|ty|cool|nice|great|good|perfect|lol|haha+|hm+|got it|sounds good|go ahead|do it|go|continue|carry on|proceed|agreed?|right|fine|done|wow|love it)[\s.!]*$/i;

const INTERNAL_NOTE_PREFIX = /^\s*\[(?:Dropwave|T3 Code|MonoCode)\b/i;

function nothingToHear(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length < 8) return true;
  if (INTERNAL_NOTE_PREFIX.test(trimmed) || trimmed.startsWith("/")) return true;
  return ACK_ONLY.test(trimmed);
}

function splitSentences(message: string): Array<string> {
  return message
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.replace(/^\s*[-*•]\s+/, "").trim())
    .filter((part) => part.length > 0);
}

const ASK_SIGNAL =
  /\b(?:can|could|would|will) (?:you|u|we)\b|\bplease\b|\bpls\b|\bmake sure\b|\bi (?:want|need|would like|'d like|wanna)\b|\bwe (?:should|need to|have to|must)\b|\b(?:you|u) (?:should|need to|have to|must)\b|\blet'?s\b|\bbring (?:it |that |this )?back\b|\bdon'?t forget\b|\bremember to\b|\b(?:also|and) (?:add|fix|make|change|remove|check|look|build|update|use|set|move|rename|test|write|show|give|send|put|sync|wire|drop|create|ship|deploy|merge|clean|port|connect|replace|strip|hide|open|run|start|stop|keep|tackle)\b|^(?:add|fix|make|change|remove|check|look|build|update|use|set|move|rename|test|write|show|give|send|put|find|create|stop|start|run|try|keep|turn|switch|merge|ship|deploy|delete|clean|research|investigate|figure out|decide|ensure|go|sync|tackle|drop|wire|build|port|connect|replace|strip|hide)\b/i;

const RULE_SIGNAL = /\b(?:always|never|from now on|make it a rule|standing rule|remember that)\b/i;

const QUESTION_OPEN = /^(?:who|whom|whose|what|which|when|where|why|how)\b(?!\s+(?:a|an)\b)/i;
const QUESTION_AUX =
  /^(?:can|could|would|will|should|shall|may|might|do|does|did|is|are|was|were|am|has|have|had)\s+(?:you|u|i|we|they|he|she|it|there|this|that|the)\b/i;

function isQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return trimmed.includes("?") || QUESTION_OPEN.test(trimmed) || QUESTION_AUX.test(trimmed);
}

const REPORT_BACK =
  /\b(?:tell|let|notify|ping|message|text|email|call|update|show|remind)\s+(?:me|us)\s+(?:when|once|after|that|if|whether)\b|\blet me know\b|\breport back\b|\bget back to me\b|\bkeep me (?:posted|updated|in the loop|informed)\b|\bcircle back\b/i;

/** "Tell me when it's done" style sentences ask for a notification, not for work. */
function isReportBackSentence(sentence: string): boolean {
  return REPORT_BACK.test(sentence);
}

const DETAIL_HARD_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:using|via|through)\s+[a-zA-Z][\w.@-]*/i,
  /[\w~-][\w./~-]*\.[a-zA-Z]{1,6}(?:\/[\w./~-]*)?/,
  /\.[a-zA-Z][\w-]*\/[\w./~-]+/,
  /\b[a-zA-Z][\w-]*\s*:\s*["'“”]?\w/,
  /<[a-zA-Z][^<>\s]{0,30}>/,
];

const DETAIL_SOFT_PATTERNS: ReadonlyArray<RegExp> = [
  /\bwith\s+(?:a|an|the|its|our|your)\b/i,
  /\([^)]{8,}\)/,
  /\b(?:styl\w*|themed?|formatted?|palette|typography|layout|designed?|glass|crisp|polished|minimal|sleek)\b/i,
];

function specSignalCount(sentence: string): { hard: number; soft: number } {
  let hard = 0;
  let soft = 0;
  for (const pattern of DETAIL_HARD_PATTERNS) {
    if (pattern.test(sentence)) hard += 1;
  }
  for (const pattern of DETAIL_SOFT_PATTERNS) {
    if (pattern.test(sentence)) soft += 1;
  }
  return { hard, soft };
}

/**
 * A sentence that only specifies how, where, or with what the previous
 * imperative is done (paths, tools, params, styling) is part of that ask,
 * not a new one.
 */
function isDetailOfPreviousAsk(sentence: string, previous: ReadonlyArray<ExtractedAsk>): boolean {
  if (isQuestion(sentence)) return false;
  const last = previous.at(-1);
  if (!last || last.kind === "answer") return false;
  const { hard, soft } = specSignalCount(sentence);
  return hard >= 2 || (hard >= 1 && soft >= 1) || soft >= 3;
}

function looksLikeAsk(sentence: string): boolean {
  const trimmed = sentence.trim();
  if (trimmed.length < 12 || trimmed.split(/\s+/).length < 3) return false;
  if (ACK_ONLY.test(trimmed)) return false;
  if (isReportBackSentence(trimmed)) return false;
  return isQuestion(trimmed) || ASK_SIGNAL.test(trimmed);
}

function inferKind(sentence: string): DropwaveAskKind {
  if (isQuestion(sentence)) return "answer";
  if (RULE_SIGNAL.test(sentence)) return "rule";
  return "do";
}

/** Deterministic zero-latency extraction from an owner message, preserving exact words. */
export function extractRuleAsks(message: string): Array<ExtractedAsk> {
  if (nothingToHear(message)) return [];
  const parts = splitSentences(message);
  const matching = parts.filter(looksLikeAsk);
  if (matching.length === 0) {
    if (parts.length <= 2 && message.trim().length <= 280) {
      const single = oneLine(message);
      if (looksLikeAsk(single)) {
        return [
          { quote: clipQuote(single), summary: clipSummary(single), kind: inferKind(single) },
        ];
      }
    }
    return [];
  }
  if (matching.length === 1 && parts.length <= 2 && message.trim().length <= 280) {
    const single = oneLine(message);
    return [{ quote: clipQuote(single), summary: clipSummary(single), kind: inferKind(single) }];
  }
  const seen = new Set<string>();
  const results: Array<ExtractedAsk> = [];
  for (const part of matching) {
    if (isDetailOfPreviousAsk(part, results)) continue;
    const key = normalizedForQuoteCheck(part);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      quote: clipQuote(part),
      summary: clipSummary(part),
      kind: inferKind(part),
    });
    if (results.length >= ASKS_PER_MESSAGE) break;
  }
  return results;
}

function wordSet(value: string): Set<string> {
  return new Set(
    normalizedForQuoteCheck(value)
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2),
  );
}

export function coversSentence(quote: string, sentence: string): boolean {
  const sentenceWords = wordSet(sentence);
  if (sentenceWords.size === 0) return false;
  const quoteWords = wordSet(quote);
  let shared = 0;
  for (const word of sentenceWords) {
    if (quoteWords.has(word)) shared += 1;
  }
  return shared / sentenceWords.size >= 0.6;
}

const VALID_ASK_KINDS = new Set<string>(["do", "answer", "decide", "rule", "idea"]);
const VALID_MEMORY_KINDS = new Set<string>(["fact", "preference", "decision", "rule", "lesson"]);

function parseFirstJsonArray(raw: string): Array<unknown> | undefined {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Validates a model-extracted ask list word-for-word against the owner's message and appends safety-net `maybe` items. */
export function parseVerifiedModelAsks(
  rawReply: string,
  originalMessage: string,
): Array<ExtractedAsk> | undefined {
  const items = parseFirstJsonArray(rawReply);
  if (!items) return undefined;
  const kept: Array<ExtractedAsk> = [];
  for (const entry of items) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const rawQuote = typeof record.quote === "string" ? record.quote : "";
    if (!quoteInMessage(rawQuote, originalMessage)) continue;
    if (isReportBackSentence(rawQuote)) continue;
    const rawKind = typeof record.kind === "string" ? record.kind : "do";
    let kind: DropwaveAskKind = VALID_ASK_KINDS.has(rawKind) ? (rawKind as DropwaveAskKind) : "do";
    if (kind === "answer" && !isQuestion(rawQuote)) kind = "do";
    const summary =
      typeof record.summary === "string" && record.summary.trim().length > 0
        ? clipSummary(record.summary)
        : clipSummary(rawQuote);
    kept.push({ quote: clipQuote(rawQuote), summary, kind });
    if (kept.length >= ASKS_PER_MESSAGE) break;
  }
  // Safety net: any sentence our rules read as an ask that the model missed becomes a `maybe`.
  const ruleCandidates = extractRuleAsks(originalMessage);
  let safetyAdded = 0;
  for (const candidate of ruleCandidates) {
    if (safetyAdded >= 6 || kept.length >= ASKS_PER_MESSAGE) break;
    if (isReportBackSentence(candidate.quote)) continue;
    if (kept.some((existing) => coversSentence(existing.quote, candidate.quote))) continue;
    kept.push({ ...candidate, maybe: true });
    safetyAdded += 1;
  }
  return kept;
}

/** Parses and quote-verifies durable memory items extracted from an owner message (anti-poisoning). */
export function parseVerifiedMemories(
  rawReply: string,
  originalMessage: string,
): Array<ExtractedMemory> {
  const items = parseFirstJsonArray(rawReply);
  if (!items) return [];
  const results: Array<ExtractedMemory> = [];
  for (const entry of items) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const quote = typeof record.quote === "string" ? record.quote : "";
    const text = typeof record.text === "string" ? oneLine(record.text).slice(0, 600) : "";
    const rawKind = typeof record.kind === "string" ? record.kind : "fact";
    if (!text || !quoteInMessage(quote, originalMessage)) continue;
    const kind: DropwaveMemoryKind = VALID_MEMORY_KINDS.has(rawKind)
      ? (rawKind as DropwaveMemoryKind)
      : "fact";
    results.push({ kind, text, quote: clipQuote(quote) });
    if (results.length >= 10) break;
  }
  return results;
}

/** Fast deterministic 1-line summary fallback for UniiChat tree compression when no LLM is invoked. */
export function compactTurnSummary(role: "owner" | "bot", text: string): string {
  const clean = oneLine(text);
  const prefix = role === "owner" ? "Owner" : "Bot";
  if (clean.length <= 180) return `${prefix}: ${clean}`;
  const firstSentence = splitSentences(text)[0] ?? clean.slice(0, 160);
  const clipped =
    firstSentence.length > 160 ? `${firstSentence.slice(0, 159).trimEnd()}…` : firstSentence;
  return `${prefix}: ${clipped}`;
}

export function mergeSummaryPair(left: string, right: string): string {
  const combined = `${oneLine(left)} | ${oneLine(right)}`;
  return combined.length <= 240 ? combined : `${combined.slice(0, 239).trimEnd()}…`;
}
