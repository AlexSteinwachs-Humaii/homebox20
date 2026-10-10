import { expect, test } from "@playwright/test";

test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

test("Continue, rooms, solid photo fallbacks and the three existing dialogs", async ({ page, context }) => {
  await context.addCookies([
    { name: "hb.auth.session", value: "true", url: test.info().project.use.baseURL! },
    { name: "hb.auth.attachment_token", value: "fixture-token", url: test.info().project.use.baseURL! },
  ]);
  await page.routeWebSocket("**/api/v1/ws/events*", () => {});
  const queries: URL[] = [];
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let json: unknown = [];
    if (path.endsWith("/users/self")) json = { item: { id: "ada", name: "Ada", defaultGroupId: "house" } };
    else if (path === "/api/v1/groups/all") json = [{ id: "house", name: "House" }];
    else if (path === "/api/v1/groups") json = { id: "house", name: "House", currency: "USD" };
    else if (path === "/api/v1/groups/statistics") json = { totalItemPrice: 2140, totalItems: 24, totalLocations: 2 };
    else if (path === "/api/v1/groups/statistics/locations") json = [{ id: "garage", total: 2140 }];
    else if (path === "/api/v1/entity-types")
      json = [
        { id: "item-type", name: "Item", isLocation: false },
        { id: "location-type", name: "Location", isLocation: true },
      ];
    else if (path === "/api/v1/care") json = { count: 0, needsYou: [], comingUp: [] };
    else if (path === "/api/v1/entities") {
      queries.push(url);
      if (url.searchParams.get("isLocation") === "true")
        json = {
          items: [
            { id: "garage", name: "Garage", itemCount: 24, imageId: "room-photo" },
            { id: "hall", name: "Hall", itemCount: 0 },
          ],
          total: 2,
        };
      else if (url.searchParams.get("pageSize") === "4")
        json = {
          items: [
            {
              id: "drill",
              name: "Makita drill",
              imageId: "original",
              thumbnailId: "thumb",
              purchasePrice: 189,
              parent: { name: "Garage" },
            },
            { id: "skillet", name: "Cast iron skillet", purchasePrice: 45, parent: { name: "Kitchen" } },
            { id: "kit", name: "First aid kit", imageId: "broken", purchasePrice: 32, parent: { name: "Hall" } },
          ],
          total: 3,
        };
      else json = { items: [{ updatedAt: new Date().toISOString() }], total: 3 };
    } else if (path.endsWith("/attachments/broken")) {
      await route.fulfill({ status: 404 });
      return;
    } else if (path.includes("/attachments/")) {
      await route.fulfill({
        contentType: "image/svg+xml",
        body: "<svg xmlns='http://www.w3.org/2000/svg' width='300' height='120'><rect width='300' height='120' fill='#556b62'/></svg>",
      });
      return;
    } else if (path.includes("status"))
      json = {
        telemetry: { enabled: false },
        build: { version: "v1.0.0", commit: "test" },
        latest: { version: "v1.0.0" },
      };
    await route.fulfill({ json });
  });
  await page.goto("/home");
  const main = page.locator("main");
  const recent = main.getByRole("region", { name: "Continue" });
  const rooms = main.getByRole("region", { name: "Places", exact: true });
  await expect(recent.getByRole("heading", { level: 3 })).toHaveText([
    "Makita drill",
    "Cast iron skillet",
    "First aid kit",
  ]);
  const drill = recent.getByRole("link", { name: /Makita drill/ });
  await expect(drill).toHaveAttribute("href", "/item/drill");
  await expect(drill).toContainText("Garage");
  await expect(drill).toContainText("$189");
  await expect(drill.locator("img")).toHaveAttribute("src", /attachments\/thumb/);
  await expect(rooms.getByRole("link", { name: /Garage/ })).toContainText("24 things · $2,140");
  await expect(rooms.getByRole("link", { name: /Hall/ })).toContainText("0 things · $0");
  await expect(rooms.getByRole("link", { name: /Garage/ })).toHaveAttribute("href", "/location/garage");
  for (const card of [
    recent.getByRole("link", { name: /Cast iron skillet/ }),
    recent.getByRole("link", { name: /First aid kit/ }),
    rooms.getByRole("link", { name: /Hall/ }),
  ]) {
    await expect(card.locator("img")).toHaveCount(0);
    await expect(card).toHaveCSS("backdrop-filter", "none");
    await expect(card).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  }
  expect(
    queries.some(url => url.searchParams.get("orderBy") === "updatedAt" && url.searchParams.get("pageSize") === "4")
  ).toBe(true);
  expect(queries.some(url => url.searchParams.get("filterChildren") === "true")).toBe(true);
  await expect(recent.getByRole("link", { name: "All things" })).toHaveAttribute("href", "/items");
  await expect(rooms.getByRole("link", { name: "All places" })).toHaveAttribute("href", "/locations");
  await page.screenshot({ path: test.info().outputPath("today-activity.png"), fullPage: true });
  const commands = main.getByRole("region", { name: "Capture commands" });
  for (const name of ["Add item", "Scan a code", "Add a place"]) {
    await expect(commands.getByRole("button", { name, exact: true }).locator("svg")).toHaveCount(1);
  }
  await commands.getByRole("button", { name: "Add item", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText(/Create\s*Item/);
  await page.keyboard.press("Escape");
  await commands.getByRole("button", { name: "Add a place", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(/Create\s*Location/);
  await page.keyboard.press("Escape");
  await commands.getByRole("button", { name: "Scan a code", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Scanner");
  await page.keyboard.press("Escape");
  await recent.getByRole("link", { name: "All things" }).click();
  await expect(page).toHaveURL("/items");
  await page.goto("/home");
  await rooms.getByRole("link", { name: "All places" }).click();
  await expect(page).toHaveURL("/locations");
});
