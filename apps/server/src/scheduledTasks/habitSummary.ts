// One-line summaries for scheduled habits, shown on the Habits view cards.
// The model pass uses the owner-specified prompt verbatim; everything else is
// deterministic fallback/normalisation so a card always has a line.

export const habitSummaryPrompt = (name: string, prompt: string): string =>
  `Summarise what this scheduled job does in one plain-English line of at most 12 words, starting with a verb. No quotes, no trailing period.\n\nJob name: ${name}\nInstructions:\n"""\n${prompt}\n"""`;

const MAX_SUMMARY_WORDS = 12;

const clipToWords = (text: string): string =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_SUMMARY_WORDS)
    .join(" ")
    .replace(/[.!?,;:]+$/, "")
    .trim();

/** First sentence of the prompt, cut to 12 words — used when the model pass fails. */
export const habitSummaryFallback = (prompt: string): string => {
  const flat = prompt.replace(/\s+/g, " ").trim();
  const sentence = /^.*?[.!?](?=\s|$)/.exec(flat)?.[0] ?? flat;
  return clipToWords(sentence);
};

/** Normalise a model reply into a stored summary; undefined when there is nothing usable. */
export const cleanHabitSummary = (raw: string): string | undefined => {
  const line = raw
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  if (line === undefined) return undefined;
  const cleaned = clipToWords(line.replace(/^["'“”‘’]+|["'“”‘’.,;:!?]+$/g, ""));
  return cleaned.length > 0 ? cleaned : undefined;
};
