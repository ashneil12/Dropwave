import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test(
  "Dropwave spatial cockpit runs Core Loop & Asks, Team switching, Decision Queue modal, Editorial Docs, and Dropwave Settings",
  WEB,
  async ({ t3, screen }) => {
    await t3.project("Dropwave fixture", { "README.md": "# Disposable fixture" });
    await t3.open();

    // No T3 chrome or filler labels.
    await expect(screen.getByRole("button", "All threads")).toHaveCount(0);
    await expect(screen.getByText("Active Target:")).toHaveCount(0);
    await expect(screen.getByText("Solo Founder")).toHaveCount(0);

    // Useful renamed widgets visible.
    await expect(screen.getByText("Core Loop & Asks")).toBeVisible();
    await expect(screen.getByText("Team & Agents")).toBeVisible();
    await expect(screen.getByText("Pending Reviews")).toBeVisible();
    await expect(screen.getByText("Running Sessions")).toBeVisible();

    // 1-click switching between Chief of Staff and specialist agent inside Team & Agents.
    await screen.getByRole("button", /Hivra QA idle/).tap();
    await expect(screen.getByRole("heading", "Hivra QA")).toBeVisible();
    await screen.getByRole("button", /Chief of Staff Lead/).tap();
    await expect(screen.getByRole("heading", "Chief of Staff")).toBeVisible();

    // Custom Model Picker inside the revamped composer pill.
    await screen.getByRole("button", "Select model").tap();
    await screen.getByRole("option", /GPT-5\.4 Codex/).tap();

    // Decision Queue Focus Modal with full context (1 of N) + Always do this.
    await screen.getByRole("button", "Review & decide").first().tap();
    await expect(screen.getByText("Decision Queue")).toBeVisible();
    await screen.getByRole("button", "Always do this").last().tap();
    await screen.getByRole("button", "Close decisions").tap();

    // Editorial Docs editor.
    await screen.getByRole("button", "Docs").tap();
    await screen.getByRole("button", "Edit").tap();
    await expect(screen.getByRole("textbox", "Document title")).toBeVisible();
    await screen.getByRole("button", "Cancel").tap();
    await screen.getByRole("button", "Back to chat").tap();

    // Searchable All Projects switcher on Dropwave brand.
    await screen.getByRole("button", "All projects").tap();
    await expect(screen.getByRole("textbox", "Switch project")).toBeVisible();
    await screen.getByRole("button", "All projects").tap();

    // Dropwave-first Settings dialog with separated Engine / T3 Backend section.
    await screen.getByRole("button", "Settings").tap();
    await expect(screen.getByText("Dropwave Settings")).toBeVisible();
    await screen.getByRole("button", "T3 Engine & Providers").tap();
    await expect(screen.getByText("Underlying T3 Engine Settings")).toBeVisible();
    await screen.getByRole("button", "Close settings").tap();
  },
);
