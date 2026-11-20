import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test(
  "Dropwave runs 100% live spatial cockpit with Bot Soul, Docs, Asks, and Dropwave Settings",
  WEB,
  async ({ t3, screen }) => {
    await t3.project("Dropwave fixture", { "README.md": "# Disposable fixture" });
    await t3.open();

    // No T3 chrome, no filler labels, no Preview mode toggle.
    await expect(screen.getByRole("button", "All threads")).toHaveCount(0);
    await expect(screen.getByRole("button", "Preview")).toHaveCount(0);
    await expect(screen.getByText("Active Target:")).toHaveCount(0);

    // Live widgets visible immediately.
    await expect(screen.getByText("Core Loop & Asks")).toBeVisible();
    await expect(screen.getByText("Team & Agents")).toBeVisible();
    await expect(screen.getByText("Pending Reviews")).toBeVisible();
    await expect(screen.getByText("Running Sessions")).toBeVisible();

    // Start conversational setup with Soul presets.
    await screen.getByRole("button", "Start conversational setup").tap();
    await screen.getByRole("button", "Tested live with screenshots and checks green").tap();
    await expect(screen.getByText("Bot identity & soul")).toBeVisible();
    await screen.getByRole("button", "Launch Chief of Staff").tap();

    // Verify real Lead ("Atlas") & QA agent created and 1-click switchable in Team & Agents.
    await expect(screen.getByRole("heading", "Atlas").first()).toBeVisible();
    await expect(screen.getByRole("button", /Dropwave fixture QA/)).toBeVisible();
    await screen.getByRole("button", /Dropwave fixture QA/).tap();
    await expect(screen.getByRole("heading", "Dropwave fixture QA").first()).toBeVisible();
    await screen.getByRole("button", /Atlas Lead/).tap();

    // Verify seeded core-loop.md and soul.md appear in real live Docs.
    await screen.getByRole("button", "Docs").tap();
    await expect(screen.getByText("Dropwave fixture Core Loop")).toBeVisible();
    await expect(screen.getByRole("button", /Atlas Soul/)).toBeVisible();
    await screen.getByRole("button", "Back to chat").tap();

    // Track a real ask directly into dropwave.sqlite via Asks drawer.
    await screen.getByRole("button", /Asks/).tap();
    await screen.getByRole("textbox").fill("Verify Canary pricing before launch");
    await screen.getByRole("button", "Add ask").tap();
    await expect(screen.getByText("Verify Canary pricing before launch").first()).toBeVisible();
    await screen.getByRole("button", "Close").tap();

    // Dropwave-first Settings dialog with separated Engine / T3 Backend section.
    await screen.getByRole("button", "Settings").tap();
    await expect(screen.getByText("Dropwave Settings")).toBeVisible();
    await screen.getByRole("button", "T3 Engine & Providers").tap();
    await expect(screen.getByText("Underlying T3 Engine Settings")).toBeVisible();
    await screen.getByRole("button", "Close settings").tap();
  },
);
