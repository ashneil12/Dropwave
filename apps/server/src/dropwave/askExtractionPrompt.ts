// Model prompt for splitting one owner message into tracked asks. The reply is validated by
// parseVerifiedModelAsks: every quote must appear word for word in the message.

export const DROPWAVE_ASK_EXTRACTION_PROMPT = `You split one message from a busy founder into the separate things they asked for, so none get lost. They often write fast, in one run-on paragraph, jumping between topics with "oh and", "also", "while you're in there", "random idea".

Return ONLY a JSON array. Each item:
{"quote": "<exact words copied from the message, at least 4 words, covering just this one ask>", "summary": "<under 15 words, plain English, what they want>", "kind": "do" | "answer" | "decide" | "rule" | "idea"}

Kinds:
- "do": they want something changed, built, fixed, written, checked, or sent.
- "answer": they asked a question and want an answer, not work.
- "decide": they want a recommendation or a choice made.
- "rule": a standing instruction for the future ("from now on", "always", "never", "in this repo we...").
- "idea": something for later that they said not to do now, or only floated.

Rules:
- One item per distinct ask. Two fixes in one sentence are two items. A fix and a question in one sentence are two items.
- Details of one ask are not separate asks. Instructions about how to do it, what to use, where to put it, what it should look like, or which file or tool to write it with all belong to the ask they describe, even when they are separate sentences. "Build a hub for X. Write it as one HTML file in .dropwave/hubs with dark glass styling." is one ask.
- "Tell me when it's done", "let me know when it's ready", "show me when you've finished", "report back" are part of the ask they refer to, never a separate item.
- Test: if doing ask A completely would also finish candidate B, then B is part of A, not its own item.
- The quote must be copied exactly from the message, including their typos and lowercase. Do not fix, reword, or join words from different places.
- Include the words that say what the ask is about (for example "the annual price is wrong" plus "fix that" belong to one ask; quote the part that names the thing).
- Skip greetings, apologies, thanks, and filler ("sorry this is all over the place").
- Skip pure context that asks for nothing.
- If the message asks for nothing, return [].

Message:
"""
{{MESSAGE}}
"""`;
