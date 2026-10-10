import { expect, test } from "@playwright/test";
import type { CareQueue, CareRow } from "../../lib/api/types/data-contracts";

const row = (kind: CareRow["kind"], name: string): CareRow => ({
  kind,
  name,
  itemName: name,
  itemId: `item-${kind}`,
  maintenanceId: kind === "overdue" || kind === "coming_up" ? `task-${kind}` : null,
  daysLate: 6,
  daysRemaining: 12,
  description: "Replace every 90 days",
  locationPath: [],
  purchasePrice: "189",
  scheduledDate: "2026-11-01",
  warrantyExpires: "2026-10-21",
});
const queue: CareQueue = {
  count: 3,
  needsYou: [row("overdue", "Furnace filter"), row("warranty", "Drill"), row("missing_photo", "Skillet")],
  comingUp: [row("coming_up", "Camping stove")],
};

async function login(page: import("@playwright/test").Page) {
  await page.routeWebSocket("**/api/v1/ws/events*", () => {});
  await page.goto("/");
  await page.fill("input[type='text']", "demo@example.com");
  await page.fill("input[type='password']", "demodemo");
  await page.click("button[type='submit']");
  await expect(page).toHaveURL("/home");
}

test("Care renders the shared queue, one action per row and no second maintenance query", async ({ page }) => {
  const maintenanceRequests: string[] = [];
  page.on("request", request => {
    if (request.url().includes("/api/v1/maintenance")) maintenanceRequests.push(request.url());
  });
  await page.route("**/api/v1/care", route => route.fulfill({ json: queue }));
  await login(page);
  await page.locator('[data-sidebar="sidebar"] a[href="/maintenance"]').click();
  await expect(page.getByRole("heading", { name: "Care", exact: true })).toBeVisible();
  await expect(page.getByText("What the house needs, not a calendar", { exact: true })).toBeVisible();
  await expect(page.getByTestId("care-page-count")).toHaveText("3 things need you");
  await expect(page.getByTestId("care-count")).toHaveText("3");
  const rows = page.locator("[data-care-kind]");
  await expect(rows).toHaveCount(4);
  expect(await rows.evaluateAll(elements => elements.map(el => el.getAttribute("data-care-kind")))).toEqual([
    "overdue",
    "warranty",
    "missing_photo",
    "coming_up",
  ]);
  await expect(rows.nth(0).getByRole("button", { name: "Mark done" })).toBeVisible();
  await expect(rows.nth(0).getByRole("button", { name: "Snooze" })).toHaveCount(0);
  await expect(rows.nth(1).getByRole("link", { name: "See the item" })).toHaveAttribute("href", "/item/item-warranty");
  await expect(rows.nth(2).getByRole("link", { name: "Add a photo" })).toHaveAttribute(
    "href",
    "/item/item-missing_photo/edit"
  );
  await expect(rows.nth(3).getByRole("button", { name: "Snooze" })).toBeVisible();
  await expect(page.getByRole("grid")).toHaveCount(0);
  expect(maintenanceRequests).toEqual([]);
  // Responsive list must not overflow a phone viewport.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(rows.nth(2).getByRole("link")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("an empty needs-you list hides gold count but retains Coming up", async ({ page }) => {
  await page.route("**/api/v1/care", route => route.fulfill({ json: { ...queue, count: 0, needsYou: [] } }));
  await login(page);
  await page.locator('[data-sidebar="sidebar"] a[href="/maintenance"]').click();
  await expect(page.getByText("Nothing needs you right now.")).toBeVisible();
  await expect(page.getByTestId("care-page-count")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Coming up" })).toBeVisible();
  await expect(page.locator("[data-care-kind]")).toHaveCount(1);
});

test("done and snooze update existing entries and refresh the shared count", async ({ page }) => {
  const current = structuredClone(queue);
  const updates: Record<string, unknown>[] = [];
  await page.route("**/api/v1/care", route => route.fulfill({ json: current }));
  const entry = (id: string, scheduledDate: string) => ({
    id,
    scheduledDate,
    completedDate: "",
    name: "Filter",
    description: "Replace every 90 days",
    cost: "42.50",
  });
  await page.route("**/api/v1/entities/*/maintenance?status=both", route => {
    const future = route.request().url().includes("item-coming_up");
    return route.fulfill({
      json: [entry(future ? "task-coming_up" : "task-overdue", future ? "2099-12-29" : "2020-01-01")],
    });
  });
  await page.route("**/api/v1/maintenance/*", async route => {
    expect(route.request().method()).toBe("PUT");
    const body = route.request().postDataJSON();
    updates.push(body);
    if (route.request().url().endsWith("task-overdue")) {
      current.needsYou.shift();
      current.count--;
    } else {
      current.comingUp[0]!.scheduledDate = body.scheduledDate;
    }
    await route.fulfill({ json: { ...body, id: "task" } });
  });
  await login(page);
  await page.locator('[data-sidebar="sidebar"] a[href="/maintenance"]').click();
  await page.getByRole("button", { name: "Mark done" }).click();
  await expect(page.locator('[data-care-kind="overdue"]')).toHaveCount(0);
  await expect(page.getByTestId("care-page-count")).toHaveText("2 things need you");
  await expect(page.getByTestId("care-count")).toHaveText("2");
  const localToday = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  expect(updates[0]).toEqual({
    name: "Filter",
    description: "Replace every 90 days",
    cost: "42.50",
    scheduledDate: "2020-01-01",
    completedDate: localToday,
  });
  await page.getByRole("button", { name: "Snooze" }).click();
  await expect.poll(() => updates.length).toBe(2);
  expect(updates[1]).toEqual({
    name: "Filter",
    description: "Replace every 90 days",
    cost: "42.50",
    scheduledDate: "2100-01-05",
    completedDate: "",
  });
  await expect(page.getByTestId("care-page-count")).toHaveText("2 things need you");
  await expect(page.getByTestId("care-count")).toHaveText("2");
  await page.reload();
  await expect(page.locator('[data-care-kind="overdue"]')).toHaveCount(0);
  await expect(page.getByTestId("care-page-count")).toHaveText("2 things need you");
});
