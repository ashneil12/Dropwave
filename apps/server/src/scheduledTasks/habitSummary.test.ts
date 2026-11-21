import { describe, it } from "@effect/vitest";
import { assert } from "@effect/vitest";

import { cleanHabitSummary, habitSummaryFallback, habitSummaryPrompt } from "./habitSummary.ts";

describe("habitSummaryPrompt", () => {
  it("uses the owner-specified prompt verbatim", () => {
    const prompt = habitSummaryPrompt("Morning check", "Check deploys and report failures.");
    assert.include(
      prompt,
      "Summarise what this scheduled job does in one plain-English line of at most 12 words, starting with a verb. No quotes, no trailing period.",
    );
    assert.include(prompt, "Job name: Morning check");
    assert.include(prompt, '"""\nCheck deploys and report failures.\n"""');
  });
});

describe("habitSummaryFallback", () => {
  it("takes the first sentence of the prompt", () => {
    assert.strictEqual(
      habitSummaryFallback("Check the deploy status. Then report back to the team."),
      "Check the deploy status",
    );
  });

  it("clips to twelve words and strips trailing punctuation", () => {
    const result = habitSummaryFallback(
      "Review every open pull request for the billing service every single morning before standup and flag anything risky",
    );
    const words = result.split(" ").filter(Boolean);
    assert.isAtMost(words.length, 12);
    assert.notMatch(result, /[.!?,;:]+$/);
  });

  it("uses the whole prompt when there is no sentence end", () => {
    assert.strictEqual(habitSummaryFallback("water the plants"), "water the plants");
  });
});

describe("cleanHabitSummary", () => {
  it("keeps the first non-empty line and strips quotes and trailing punctuation", () => {
    assert.strictEqual(
      cleanHabitSummary('\n  "Checks deploy health daily."\nsecond line'),
      "Checks deploy health daily",
    );
    assert.strictEqual(
      cleanHabitSummary("Reports failed invoices every Monday"),
      "Reports failed invoices every Monday",
    );
  });

  it("clips to twelve words", () => {
    const result = cleanHabitSummary(
      "one two three four five six seven eight nine ten eleven twelve thirteen fourteen",
    );
    assert.strictEqual(result, "one two three four five six seven eight nine ten eleven twelve");
  });

  it("returns undefined for empty or punctuation-only replies", () => {
    assert.isUndefined(cleanHabitSummary(""));
    assert.isUndefined(cleanHabitSummary("   \n  \n"));
    assert.isUndefined(cleanHabitSummary('"""'));
  });
});
