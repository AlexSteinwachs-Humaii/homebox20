import { expect, test } from "@playwright/test";
import { EntityPathType, type CareQueue, type CareRow } from "../../lib/api/types/data-contracts";

const row = (kind: CareRow["kind"], name: string): CareRow => ({
  kind,
  name,
  itemName: name,
  itemId: `item-${kind}`,
  maintenanceId: kind === "overdue" ? "task-overdue" : null,
  daysLate: 6,
  daysRemaining: 12,
  description: "Replace every 90 days",
  locationPath: [{ id: "garage", name: "Garage", type: EntityPathType.EntityPathTypeLocation }],
  purchasePrice: "189",
  scheduledDate: "2020-01-01",
  warrantyExpires: "2099-10-21",
});

// Deterministic API fixtures exercise the built SPA without a demo database.
test("Today uses the Care records/actions and linked solid counts", async ({ page, context }) => {
  const queue: CareQueue = {
    count: 4,
    needsYou: [
      row("overdue", "Furnace filter"),
      row("warranty", "Drill"),
      row("missing_photo", "Skillet"),
      row("missing_photo", "Bicycle"),
    ],
    comingUp: [],
  };
  let update: Record<string, unknown> | undefined;
  await context.addCookies([{ name: "hb.auth.session", value: "true", url: test.info().project.use.baseURL! }]);
  await page.routeWebSocket("**/api/v1/ws/events*", () => {});
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let json: unknown = [];
    if (path.endsWith("/users/self")) json = { item: { id: "ada", name: "Ada", defaultGroupId: "house" } };
    else if (path === "/api/v1/groups/all") json = [{ id: "house", name: "House" }];
    else if (path === "/api/v1/groups") json = { id: "house", name: "House", currency: "USD" };
    else if (path === "/api/v1/groups/statistics")
      json = { totalItemPrice: 12480, totalItems: 186, totalLocations: 14, totalTags: 99 };
    else if (path === "/api/v1/care") json = queue;
    else if (path === "/api/v1/entities" && url.searchParams.has("orderBy"))
      json = { items: [{ updatedAt: new Date().toISOString() }], total: 186 };
    else if (path === "/api/v1/entities" && url.searchParams.has("onlyWithoutPhoto")) json = { items: [], total: 22 };
    else if (path === "/api/v1/entities/item-overdue/maintenance")
      json = [
        {
          id: "task-overdue",
          name: "Furnace filter",
          description: "Replace every 90 days",
          cost: "42.50",
          scheduledDate: "2020-01-01",
          completedDate: "",
        },
      ];
    else if (path === "/api/v1/maintenance/task-overdue") {
      expect(route.request().method()).toBe("PUT");
      update = route.request().postDataJSON();
      queue.needsYou.shift();
      queue.count--;
      json = { ...update, id: "task-overdue" };
    } else if (path.includes("status"))
      json = {
        telemetry: { enabled: false },
        build: { version: "v1.0.0", commit: "test" },
        latest: { version: "v1.0.0" },
      };
    await route.fulfill({ json });
  });
  page.on("pageerror", error => console.error(error.message));
  page.on("console", message => {
    if (message.type() === "error") console.error(message.text());
  });
  await page.goto("/home");
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "House", exact: true })).toBeVisible();
  await expect(main.getByText(/^Updated /)).toBeVisible();
  const needLink = main.getByRole("link", { name: "4 things need you" });
  await expect(needLink).toHaveAttribute("href", "/maintenance");
  await expect(needLink).toHaveCSS("color", "rgb(241, 189, 85)");
  const rows = main.locator("[data-care-kind]");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).getByRole("heading")).toHaveText("Furnace filter");
  await expect(rows.nth(1).getByRole("link", { name: "See the item" })).toHaveAttribute("href", "/item/item-warranty");
  await expect(rows.nth(2).getByRole("link", { name: "Add a photo" })).toHaveAttribute(
    "href",
    "/item/item-missing_photo/edit"
  );
  for (const action of [
    rows.nth(0).getByRole("button"),
    rows.nth(1).getByRole("link"),
    rows.nth(2).getByRole("link"),
  ]) {
    await expect(action.locator("svg")).toHaveCount(1);
  }
  const counts = main.getByRole("region", { name: "Collection at a glance" });
  await expect(counts.getByRole("link")).toHaveCount(4);
  for (const [label, href] of [
    ["Total Value", "/items"],
    ["Items", "/items"],
    ["Places", "/locations"],
    ["Need a photo", "/items?onlyWithoutPhoto=true"],
  ]) {
    const link = counts.getByRole("link", { name: new RegExp(label!) });
    await expect(link).toHaveAttribute("href", href!);
    await expect(link).toHaveCSS("backdrop-filter", "none");
  }
  await expect(counts.getByRole("button")).toHaveCount(0);
  await expect(counts).toContainText("22");
  await expect(main.getByText("Quick Statistics")).toHaveCount(0);
  await expect(main.getByText("Recently Added")).toHaveCount(0);
  await expect(main.getByText("Total Tags")).toHaveCount(0);
  await expect(main.locator("table")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("today.png"), fullPage: true });
  await rows.nth(0).getByRole("button", { name: "Mark done" }).click();
  await expect(main.getByRole("link", { name: "3 things need you" })).toBeVisible();
  await expect(page.getByTestId("care-count")).toHaveText("3");
  expect(update).toMatchObject({ cost: "42.50", scheduledDate: "2020-01-01" });
  expect(update?.completedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await main.getByRole("link", { name: "3 things need you" }).click();
  await expect(page).toHaveURL("/maintenance");
  await expect(page.locator("[data-care-kind] h3")).toHaveText(["Drill", "Skillet", "Bicycle"]);
});
