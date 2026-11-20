import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test("Dropwave creates and reopens a project team", WEB, async ({ t3, screen }) => {
  await t3.project("Dropwave fixture", { "README.md": "# Disposable fixture" });
  await t3.open();
  await screen.getByRole("button", "Dropwave fixture").tap();
  await screen.getByRole("button", "Create a lead").tap();
  await screen.getByRole("textbox", "Project brief").fill("Coordinate the review of this fixture.");
  await screen.getByRole("button", "Create lead").tap();
  await screen.getByRole("heading", "Chief of Staff").waitFor();

  await screen.getByRole("button", "Team").tap();
  await screen.getByRole("button", "Add teammate").tap();
  await screen.getByRole("textbox", "Name").fill("Release QA");
  await screen.getByRole("textbox", "Responsibility").fill("Verify the release checks.");
  await screen.getByRole("button", "Add teammate").tap();
  await screen.getByRole("button", "Thread actions for Release QA").waitFor();
  await screen.getByRole("button", "Work").tap();
  await expect(screen.getByText("This bot hasn’t started any sessions yet.")).toBeVisible();
  await screen.getByRole("button", "Close").tap();

  await screen.getByRole("button", "Dropwave fixture").tap();
  await screen.getByRole("button", "Thread actions for Chief of Staff").waitFor();
  await screen.getByRole("link", "Settings").tap();
  await expect(screen.getByRole("dialog", "Settings")).toBeVisible();
});
