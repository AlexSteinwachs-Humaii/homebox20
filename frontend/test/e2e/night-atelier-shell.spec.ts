import { expect, test } from "@playwright/test";

test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

// Uses the existing demo account, like login.browser.spec.ts.
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.fill("input[type='text']", "demo@example.com");
  await page.fill("input[type='password']", "demodemo");
  await page.click("button[type='submit']");
  await expect(page).toHaveURL("/home");
});

test("rail, profile chip, and administration preserve the existing routes", async ({ page }) => {
  const rail = page.locator('[data-sidebar="sidebar"]');
  await expect(rail.getByText("HomeBox", { exact: true })).toBeVisible();
  await expect(rail.getByText("Tonight", { exact: true })).toBeVisible();
  await expect(rail.getByText("Organize", { exact: true })).toBeVisible();
  for (const [label, route] of [
    ["Today", "/home"],
    ["Places", "/locations"],
    ["Things", "/items"],
    ["Care", "/maintenance"],
    ["Tags", "/tags"],
    ["Templates", "/templates"],
  ]) {
    const link = rail.getByRole("link", { name: label, exact: true });
    await expect(link).toHaveAttribute("href", route!);
    await expect(link.locator("svg")).toHaveCount(1);
  }
  const profile = rail.locator('a[href="/profile"]');
  await expect(profile).toContainText("Demo");
  await expect(profile).toContainText("collection");
  await expect(rail.getByTestId("logout-button")).toHaveCount(0);
  await rail.getByRole("button", { name: "Collection", exact: true }).click();
  for (const route of ["members", "invites", "notifiers", "settings", "entity-types", "tools"]) {
    await expect(page.locator(`[role='menuitem'][href='/collection/${route}']`)).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await profile.click();
  await expect(page).toHaveURL("/profile");
});

test("one search and icon-labelled commands ignore the legacy header preference", async ({ page, context }) => {
  await page.evaluate(() => {
    const key = "homebox/preferences/location";
    const prefs = JSON.parse(localStorage.getItem(key) || "{}");
    localStorage.setItem(key, JSON.stringify({ ...prefs, displayLegacyHeader: true }));
  });
  await page.reload();
  const search = page.getByPlaceholder("Search items, places, tags", { exact: true });
  await expect(search).toHaveCount(1);
  for (const label of ["Menu", "Scanner", "Create"]) {
    const button = page.getByRole("button", { name: label, exact: true });
    await expect(button).toBeVisible();
    await expect(button.locator("svg")).toHaveCount(1);
  }
  await page.getByRole("button", { name: "Create", exact: true }).click();
  for (const name of ["Item / Asset", "Location", "Tag"]) {
    await expect(page.getByRole("menuitem", { name, exact: true })).toBeVisible();
  }
  await page.getByRole("menuitem", { name: "Tag", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await search.fill("drill & bits");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/items\?q=drill/);
  await context.grantPermissions(["camera"]);
  await page.getByRole("button", { name: "Scanner", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
