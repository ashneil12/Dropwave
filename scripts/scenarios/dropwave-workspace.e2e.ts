import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test(
  "Dropwave spatial cockpit runs Preview showcase and Live backend end-to-end",
  WEB,
  async ({ t3, screen }) => {
    await t3.project("Dropwave fixture", { "README.md": "# Disposable fixture" });
    await t3.open();

    // No T3 chrome or filler labels.
    await expect(screen.getByRole("button", "All threads")).toHaveCount(0);
    await expect(screen.getByText("Active Target:")).toHaveCount(0);
    await expect(screen.getByText("Solo Founder")).toHaveCount(0);

    // Useful widgets visible in Preview showcase.
    await expect(screen.getByText("Core Loop & Asks")).toBeVisible();
    await expect(screen.getByText("Team & Agents")).toBeVisible();
    await expect(screen.getByText("Pending Reviews")).toBeVisible();
    await expect(screen.getByText("Running Sessions")).toBeVisible();

    // 1-click agent switching inside Team & Agents.
    await screen.getByRole("button", /Hivra QA idle/).tap();
    await expect(screen.getByRole("heading", "Hivra QA")).toBeVisible();
    await screen.getByRole("button", /Chief of Staff Lead/).tap();
    await expect(screen.getByRole("heading", "Chief of Staff")).toBeVisible();

    // Custom Model Picker inside revamped composer pill.
    await screen.getByRole("button", "Select model").tap();
    await screen.getByRole("option", /GPT-5\.4 Codex/).tap();

    // Decision Queue Focus Modal (1 of N) + Always do this.
    await screen.getByRole("button", "Review & decide").first().tap();
    await expect(screen.getByText("Decision Queue")).toBeVisible();
    await screen.getByRole("button", "Always do this").last().tap();
    await screen.getByRole("button", "Close decisions").tap();

    // Switch to Live mode and run real Conversational Setup against backend orchestration-v2 + dropwave.sqlite!
    await screen.getByRole("button", "Live").tap();
    await screen.getByRole("button", "Tested live with screenshots and checks green").tap();
    await screen.getByRole("button", "Launch Chief of Staff").tap();

    // Verify real Lead & QA agent created and visible in Live Team & Agents + seeded .dropwave/docs/core-loop.md in real Docs!
    await expect(screen.getByRole("heading", "Chief of Staff").first()).toBeVisible();
    await expect(screen.getByRole("button", /Dropwave fixture QA/)).toBeVisible();

    await screen.getByRole("button", "Docs").tap();
    await expect(screen.getByText("Dropwave fixture Core Loop")).toBeVisible();
    await screen.getByRole("button", "Back to chat").tap();

    // Track a real ask directly into dropwave.sqlite via Asks drawer.
    await screen.getByRole("button", /Asks/).tap();
    await screen.getByRole("textbox").fill("Verify Canary pricing before launch");
    await screen.getByRole("button", "Add ask").tap();
    await expect(screen.getByText("Verify Canary pricing before launch")).toBeVisible();
    await screen.getByRole("button", "Close").tap();

    // Dropwave-first Settings dialog with separated Engine / T3 Backend section.
    await screen.getByRole("button", "Settings").tap();
    await expect(screen.getByText("Dropwave Settings")).toBeVisible();
    await screen.getByRole("button", "T3 Engine & Providers").tap();
    await expect(screen.getByText("Underlying T3 Engine Settings")).toBeVisible();
    await screen.getByRole("button", "Close settings").tap();
  },
);
