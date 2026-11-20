import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test(
  "Dropwave 2-pane Atelier cockpit runs bot-face sidebar, T3 provider selectors, Soul setup, Docs, Asks, and Settings",
  WEB,
  async ({ t3, screen }) => {
    await t3.project("Dropwave fixture", { "README.md": "# Disposable fixture" });
    await t3.open();

    // No T3 sidebar chrome, no old 4-card dashboard filler.
    await expect(screen.getByRole("button", "All threads")).toHaveCount(0);
    await expect(screen.getByText("Mission Control")).toHaveCount(0);
    await expect(screen.getByRole("button", "Preview")).toHaveCount(0);

    // Left bot-face sidebar + auto-collapsing Projects drawer with Pin button.
    await expect(screen.getByRole("button", /Projects/)).toBeVisible();
    await screen.getByRole("button", /Projects/).tap();
    await expect(screen.getByRole("button", "Pin project to top")).toBeVisible();
    await screen.getByRole("button", "Pin project to top").tap();
    await screen.getByRole("button", /Projects/).tap();

    // Start conversational setup with Bot Soul + QA teammate.
    await screen.getByRole("button", "Start conversational setup").tap();
    await screen.getByRole("button", "Tested live with screenshots and checks green").tap();
    await expect(screen.getByText("Bot identity & soul")).toBeVisible();
    await screen.getByRole("button", "Launch Chief of Staff").tap();

    // Verify real Lead ("Atlas") & QA bot appear in Team list with 1-click switching.
    await expect(screen.getByRole("button", /Atlas Lead/)).toBeVisible();
    await expect(screen.getByRole("button", /Dropwave fixture QA/)).toBeVisible();
    await screen.getByRole("button", /Dropwave fixture QA/).tap();
    await screen.getByRole("button", /Atlas Lead/).tap();

    // Verify Docs & Asks tabs in the main canvas header.
    await screen.getByRole("tab", "Docs").tap();
    await expect(screen.getByText("Dropwave fixture Core Loop")).toBeVisible();
    await expect(screen.getByRole("button", /Atlas Soul/)).toBeVisible();

    await screen.getByRole("tab", /Asks/).tap();
    await screen.getByRole("textbox").fill("Verify Canary pricing before launch");
    await screen.getByRole("button", "Add ask").tap();
    await expect(screen.getByText("Verify Canary pricing before launch")).toBeVisible();
    await screen.getByRole("tab", "Chat").tap();

    // Verify Dropwave-first Settings (with embedded Providers & Models + separated T3 Engine & Advanced).
    await screen.getByRole("button", "Settings").tap();
    await expect(screen.getByText("Dropwave Settings")).toBeVisible();
    await screen.getByRole("button", "Providers & Models").tap();
    await screen.getByRole("button", "T3 Engine & Advanced").tap();
    await expect(screen.getByText("Underlying T3 Engine Settings")).toBeVisible();
    await screen.getByRole("button", "Close settings").tap();
  },
);
