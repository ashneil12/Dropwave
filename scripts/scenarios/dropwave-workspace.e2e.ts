import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test("Dropwave runs unified project workspace without T3 chrome", WEB, async ({ t3, screen }) => {
  await t3.project("Dropwave fixture", { "README.md": "# Disposable fixture" });
  await t3.open();
  await expect(screen.getByRole("button", "All threads")).toHaveCount(0);

  await screen.getByRole("button", "Dropwave fixture").tap();
  await screen.getByRole("button", "Set up Chief of Staff").tap();
  await screen.getByRole("textbox", "Project brief").fill("Coordinate the review of this fixture.");
  await screen.getByRole("button", "Create Chief of Staff").tap();
  await screen.getByRole("heading", "Chief of Staff").waitFor();

  await screen.getByRole("button", "Team").tap();
  await screen.getByRole("button", "Add helper").tap();
  await screen.getByRole("textbox", "Name").fill("Release QA");
  await screen.getByRole("textbox", "Responsibility").fill("Verify the release checks.");
  await screen.getByRole("button", "Add helper").tap();
  await screen.getByRole("button", "Thread actions for Release QA").waitFor();

  await screen.getByRole("button", "Bot and core loop settings").tap();
  await expect(screen.getByRole("dialog", "Bot & core loop")).toBeVisible();
  await screen.getByRole("button", "Cancel").tap();

  await screen.getByRole("button", "Tracked asks").tap();
  await expect(screen.getByText("No tracked asks here yet.")).toBeVisible();
  await screen.getByRole("button", "Close").tap();

  await screen.getByRole("button", "Project docs and memory").tap();
  await expect(screen.getByRole("button", "Back to chat")).toBeVisible();
  await screen.getByRole("button", "Back to chat").tap();

  await screen.getByRole("button", "Dropwave fixture").tap();
  await screen.getByRole("button", "Thread actions for Chief of Staff").waitFor();
  const activity = screen.getByRole("button", "Activity");
  await activity.tap();
  await expect(activity).toHaveAttribute("aria-pressed", "true");
  await screen.getByRole("button", "Close activity").tap();

  await screen.getByRole("button", "Wallpaper and glass").tap();
  const ocean = screen.getByRole("button", "Ocean");
  await ocean.tap();
  await expect(ocean).toHaveAttribute("aria-pressed", "true");
  await ocean.press("Escape");

  await screen.getByRole("link", "Settings").tap();
  await expect(screen.getByRole("dialog", "Settings")).toBeVisible();
});
