import { expect, test } from "@playwright/test";
import { themes } from "../../lib/data/themes";

test.use({ serviceWorkers: "block" });

test("Claude preview and live shared components update without stale theme classes", async ({ page, request }) => {
  const email = `claude-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = "Claude-theme-test-42!";
  expect(
    (await request.post("/api/v1/users/register", { data: { email, name: "Theme tester", password } })).status()
  ).toBe(204);
  await page.goto("/");
  await page.locator("input[type='text']").fill(email);
  await page.locator("input[type='password']").fill(password);
  await page.locator("button[type='submit']").click();
  await expect(page).toHaveURL("/home");
  await page.goto("/profile");

  const root = page.locator("html");
  const picker = (value: string) => page.locator(`[data-set-theme='${value}']`);
  for (const theme of themes) {
    await expect(picker(theme.value)).toHaveText(new RegExp(theme.label));
  }
  // The preview carries its own tokens before the theme is applied globally.
  await expect(picker("claude").locator(".bg-primary")).toHaveCSS("background-color", "rgb(145, 81, 59)");
  await picker("claude").click();
  await expect(root).toHaveAttribute("data-theme", "claude");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(248, 246, 241)");
  await expect(page.locator(".bg-card").first()).toHaveCSS("background-color", "rgb(252, 250, 248)");
  await expect(page.locator("input").first()).toHaveCSS("border-color", "rgb(140, 128, 115)");
  await page.locator("input").first().focus();
  await expect(page.locator("input").first()).toHaveCSS("--tw-ring-color", "hsl(15 42% 40%)");

  // Seed legacy/stale classes and a non-theme class to exercise cleanup.
  await root.evaluate(el => el.classList.add("theme-cyberpunk", "dark", "keep-me"));
  await picker("night").click();
  await expect(root).toHaveAttribute("data-theme", "night");
  await expect(root).toHaveClass("keep-me theme-night");
  await expect(page.locator("body")).not.toHaveCSS("background-color", "rgb(248, 246, 241)");
  await picker("claude").click();
  await expect(root).toHaveClass("keep-me theme-claude");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(248, 246, 241)");

  // Theme selection survives SPA navigation, including narrow-screen layout.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/home");
  await expect(root).toHaveAttribute("data-theme", "claude");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(248, 246, 241)");
});
