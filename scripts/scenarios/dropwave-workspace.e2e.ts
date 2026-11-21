import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test(
  "Dropwave 2-pane Atelier cockpit runs bot-face sidebar, first-run LLM onboarding, Docs, Asks, and Settings",
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

    // Set up the Chief of Staff: first run wires a persistent "Atlas" persona and
    // lands on its chat showing the client-rendered opening line in normal agent styling.
    await screen.getByRole("button", "Set up Chief of Staff").tap();
    await expect(
      screen.getByText(/I just came online\. I'll be running point on your projects/),
    ).toBeVisible();
    await expect(screen.getByRole("button", /Atlas/)).toBeVisible();

    // Verify Docs & Asks tabs in the main canvas header.
    await screen.getByRole("tab", "Docs").tap();
    await expect(screen.getByRole("tab", /Asks/)).toBeVisible();

    await screen.getByRole("tab", /Asks/).tap();
    await screen.getByRole("textbox").fill("Verify Canary pricing before launch");
    await screen.getByRole("button", "Add ask").tap();
    await expect(screen.getByText("Verify Canary pricing before launch").first()).toBeVisible();
    await screen.getByRole("tab", "Chat").tap();

    // Verify Dropwave-first Settings (Crew + embedded Providers & Models + T3 Engine & Advanced).
    await screen.getByRole("button", "Settings").tap();
    await expect(screen.getByText("Dropwave Settings")).toBeVisible();
    await screen.getByRole("button", "Crew").tap();
    await expect(screen.getByText(/Your crew follows you into every project/)).toBeVisible();
    await screen.getByRole("button", "Providers & Models").tap();
    await screen.getByRole("button", "T3 Engine & Advanced").tap();
    await expect(screen.getByText("Underlying T3 Engine Settings")).toBeVisible();
    await screen.getByRole("button", "Close settings").tap();
  },
);
