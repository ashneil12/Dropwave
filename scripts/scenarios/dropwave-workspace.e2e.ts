import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test(
  "Dropwave runs standalone spatial cockpit with customizable panels and conversational setup",
  WEB,
  async ({ t3, screen }) => {
    await t3.project("Dropwave fixture", { "README.md": "# Disposable fixture" });
    await t3.open();

    // No T3 chrome anywhere.
    await expect(screen.getByRole("button", "All threads")).toHaveCount(0);

    // Preview showcase loads cleanly with Hivra spatial cockpit.
    await expect(screen.getByRole("heading", "Chief of Staff")).toBeVisible();
    await expect(screen.getByText("Mission Control")).toBeVisible();
    await expect(screen.getByText("Helper Bots")).toBeVisible();
    await expect(screen.getByText("Pending Reviews")).toBeVisible();
    await expect(screen.getByText("Running Sessions")).toBeVisible();

    // Resolve an inline Needs-You card with "Always do this".
    await screen.getByRole("button", "Always do this").tap();
    await expect(
      screen.getByText("Saved rule & chose: $39, matches live experiment"),
    ).toBeVisible();

    // Swap a side widget panel screen.
    await screen.getByRole("button", "Switch panel screen").first().tap();
    await screen.getByRole("button", "Docs & Briefs").tap();
    await expect(screen.getByText("Shared with bots")).toBeVisible();

    // Open in-pillar Docs view and return to chat.
    await screen.getByRole("button", "Docs").tap();
    await expect(screen.getByRole("button", "Back to chat")).toBeVisible();
    await screen.getByRole("button", "Back to chat").tap();

    // Conversational new-project setup (no modal form box).
    await screen.getByRole("button", "New project setup").tap();
    await screen.getByRole("textbox").fill("Pocket CRM");
    await screen.getByRole("button", "Send").tap();
    await screen.getByRole("button", "Tested live with screenshots and checks green").tap();
    await screen.getByRole("button", "Launch Chief of Staff").tap();
    await expect(screen.getByText("Pocket CRM")).toBeVisible();

    // Switch to Live mode and verify Settings opens in unified dark theme.
    await screen.getByRole("button", "Live").tap();
    await screen.getByRole("link", "Settings").tap();
    await expect(screen.getByRole("dialog", "Settings")).toBeVisible();
  },
);
