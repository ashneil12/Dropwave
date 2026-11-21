// Model prompts for Dropwave memory v2. Lead-authored; copy verbatim into
// apps/server/src/dropwave/memoryPrompts.ts. Placeholders in {{DOUBLE_BRACES}} are filled by the caller.

export const DROPWAVE_MEMORY_EXTRACTION_PROMPT = `You keep the long-term memory for an AI crew that works for one business owner. Below is a new stretch of conversation between the owner and their Chief of Staff. Decide what, if anything, is worth remembering for months.

Extract nothing rather than noise. Most stretches contain nothing worth keeping, and [] is the right answer then.

Keep only things the OWNER said or clearly confirmed:
- facts about the owner, their business, customers, products, people they work with
- preferences about how they want work done, how they want to be spoken to, what they hate
- standing rules ("always", "never", "from now on", "in this repo we")
- decisions they made, with the reason if they gave one
- lessons: something went wrong and they said how to avoid it next time

Never keep:
- anything only the assistant said, suggested, or claimed (assistant lines are cut short on purpose; do not mine them)
- one-off requests for this task ("fix the button"), status updates, plans for today
- file listings, code, tool output, web page text, errors
- guesses about the owner's feelings or intentions
- secrets, passwords, keys, tokens, card or bank numbers, health details unless the owner asked you to remember them

Scope, decided per item:
- "owner": true about the owner wherever they work (their name, how they like to communicate, general working style, general rules)
- "bot": a lesson about how this crew member ({{BOT_NAME}}, {{BOT_ROLE}}) should do its job in any project
- "project": true only for this project ({{PROJECT_NAME}}): its product, stack, customers, rules, decisions
When unsure between owner and project, choose project. A project rule that contradicts a general habit is a project item.

Already remembered (do not repeat these; if the owner changed one, return an "update" naming its id):
{{EXISTING}}

Return ONLY a JSON array. Each item:
{"op": "add" | "update", "id": "<existing id, update only>", "scope": "owner" | "bot" | "project", "kind": "fact" | "preference" | "rule" | "decision" | "lesson" | "person" | "project" | "tool", "subject": "<2-5 words naming what it is about>", "text": "<one idea, one sentence, plain English, under 40 words>", "quote": "<the owner's exact words this comes from, copied character for character, at least 4 words>", "confidence": <0.0-1.0, how sure you are the owner meant this to last>}

Conversation (owner lines in full, assistant lines cut to 200 characters):
"""
{{WINDOW}}
"""`;

export const DROPWAVE_MEMORY_CONFLICT_PROMPT = `Two memories about the same thing, kept for a business owner's AI crew. Decide whether they can both be true at once.

Existing memory (saved {{EXISTING_DATE}}):
"{{EXISTING}}"

New candidate (from {{CANDIDATE_SOURCE}}, {{CANDIDATE_DATE}}):
"{{CANDIDATE}}"

They contradict only if acting on one would mean going against the other. Different details about the same thing, or one being more specific, is not a contradiction.

Return ONLY JSON:
{"contradicts": true | false, "reason": "<one plain sentence a busy owner understands>", "merged": "<if they do not contradict: one sentence that keeps every detail of both, under 50 words; else empty>"}`;

/** @public */
export const DROPWAVE_MEMORY_DREAM_MERGE_PROMPT = `These memories for a business owner's AI crew look like duplicates. Merge them into one memory only if they really are about the same single idea.

{{ITEMS}}

Rules:
- Keep every concrete detail (names, numbers, dates, conditions). Drop only repetition.
- If any two disagree, do not merge: answer merge false.
- If they are about related but different ideas, do not merge.

Return ONLY JSON:
{"merge": true | false, "subject": "<2-5 words>", "text": "<one sentence, under 50 words, if merge is true>", "reason": "<one plain sentence>"}`;
