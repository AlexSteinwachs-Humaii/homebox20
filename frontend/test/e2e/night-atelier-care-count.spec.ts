import { expect, test } from "@playwright/test";

// The demo login is the existing browser-test fixture. The Care response is
// deterministic here; repository tests cover the real query and date windows.
test("Care badge uses the shared query and disappears after a mutation clears it", async ({ page }) => {
  let count = 3;
  let sendMutation: (() => void) | undefined;
  await page.route("**/api/v1/care", async route => {
    await route.fulfill({ json: { count, needsYou: [], comingUp: [] } });
  });
  await page.routeWebSocket("**/api/v1/ws/events*", socket => {
    sendMutation = () => socket.send(JSON.stringify({ event: "entity.mutation" }));
  });
  await page.goto("/");
  await page.fill("input[type='text']", "demo@example.com");
  await page.fill("input[type='password']", "demodemo");
  await page.click("button[type='submit']");
  await expect(page).toHaveURL("/home");
  const care = page.locator('[data-sidebar="sidebar"] a[href="/maintenance"]');
  const badge = care.getByTestId("care-count");
  await expect(badge).toHaveText("3");
  await expect(badge).toHaveCSS("background-color", "rgb(241, 189, 85)");
  expect(await badge.evaluate(el => el.tagName)).toBe("SPAN");
  await expect(care.locator("button")).toHaveCount(0);
  count = 0;
  await expect.poll(() => Boolean(sendMutation)).toBe(true);
  sendMutation!();
  await expect(badge).toHaveCount(0);
});
