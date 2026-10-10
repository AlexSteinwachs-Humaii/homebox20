import { expect, test } from "@playwright/test";

test("A place lists child rooms before its direct things, with direct counts and values", async ({ page, context }) => {
  await context.addCookies([
    {
      name: "hb.auth.session",
      value: "true",
      url: test.info().project.use.baseURL!,
    },
    {
      name: "hb.auth.attachment_token",
      value: "test-attachments",
      url: test.info().project.use.baseURL!,
    },
  ]);
  await page.routeWebSocket("**/api/v1/ws/events*", () => {});
  const queries: URL[] = [];
  const creates: { parentId: string; entityTypeId: string; name: string }[] = [];
  const places = [
    { id: "garage", name: "Garage", itemCount: 2 },
    { id: "cabinet", name: "Tool cabinet", itemCount: 11 },
    // Real summaries omit a zero itemCount. The room must still say 0 things.
    { id: "shelf", name: "Shelf" },
  ];
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let json: unknown = [];
    if (path === "/api/v1/entities" && route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      creates.push(body);
      json = { ...body, id: `created-${creates.length}`, attachments: [] };
    } else if (path === "/api/v1/entity-types")
      json = [
        { id: "item-type", name: "global.item", isLocation: false },
        { id: "place-type", name: "global.location", isLocation: true },
      ];
    else if (path.endsWith("/users/self")) json = { item: { id: "ada", name: "Ada", defaultGroupId: "house" } };
    else if (path === "/api/v1/groups/all") json = [{ id: "house", name: "House" }];
    else if (path === "/api/v1/groups") json = { id: "house", name: "House", currency: "USD" };
    else if (path === "/api/v1/care") json = { count: 0, needsYou: [], comingUp: [] };
    else if (path === "/api/v1/groups/statistics/locations")
      json = [
        { id: "garage", total: 64 },
        { id: "cabinet", total: 640 },
      ];
    else if (path === "/api/v1/entities/tree") json = [];
    else if (path === "/api/v1/entities" && url.searchParams.get("isLocation") === "true")
      json = { items: places, total: places.length };
    else if (path === "/api/v1/entities/garage")
      json = {
        id: "garage",
        name: "Garage",
        description: "The room, then the cabinets inside it.",
        children: places.slice(1),
        attachments: [],
        tags: [],
        fields: [],
      };
    else if (path === "/api/v1/entities/cabinet")
      json = {
        id: "cabinet",
        name: "Tool cabinet",
        description: "Tools live here.",
        parent: places[0],
        children: [],
        attachments: [],
        tags: [],
        fields: [],
      };
    else if (path === "/api/v1/entities/shelf")
      json = {
        id: "shelf",
        name: "Shelf",
        description: "Empty shelf.",
        parent: places[0],
        children: [],
        attachments: [],
        tags: [],
        fields: [],
      };
    else if (path === "/api/v1/entities") {
      queries.push(url);
      json = {
        items: url.searchParams.getAll("parentIds").includes("garage")
          ? [
              {
                id: "stove",
                name: "Camping stove",
                parent: places[0],
                purchasePrice: 64,
                quantity: 2,
                imageId: "photo",
                tags: [],
              },
            ]
          : [],
        total: 1,
      };
    } else if (path.endsWith("/attachments/photo")) {
      await route.fulfill({
        contentType: "image/svg+xml",
        body: "<svg xmlns='http://www.w3.org/2000/svg' width='220' height='170'><rect width='220' height='170' fill='#637f71'/></svg>",
      });
      return;
    } else if (path.includes("status"))
      json = {
        telemetry: { enabled: false },
        build: { version: "v1.0.0" },
        latest: { version: "v1.0.0" },
      };
    await route.fulfill({ json });
  });

  await page.goto("/location/garage");
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "Garage", exact: true })).toBeVisible();
  await expect(main.locator("[data-place-visit]")).toHaveCount(0);
  await expect(main.getByText("The room, then the cabinets inside it.")).toBeVisible();
  await expect(main.locator("[data-place-totals]")).toContainText("2 things");
  await expect(main.locator("[data-place-totals]")).toContainText("$64");
  const children = main.locator("[data-child-places]");
  const cabinet = children.getByRole("link", { name: /Tool cabinet/ });
  await expect(cabinet).toContainText("11 things");
  await expect(cabinet).toContainText("$640");
  await expect(cabinet).toHaveAttribute("href", "/location/cabinet");
  await expect(children.getByRole("link", { name: /Shelf/ })).toContainText("$0");
  const things = main.locator("[data-place-things]");
  await expect(things.locator("[data-thing-row]")).toHaveCount(1);
  await expect(things.getByRole("img", { name: "Camping stove" })).toBeVisible();
  await expect(things).toContainText("$64");
  expect(queries.at(-1)!.searchParams.getAll("parentIds")).toEqual(["garage"]);
  expect((await children.boundingBox())!.y).toBeLessThan((await things.boundingBox())!.y);
  await expect(main.getByRole("link", { name: "All places", exact: true })).toHaveAttribute("href", "/locations");
  await expect(main.getByRole("link", { name: "All things", exact: true })).toHaveAttribute(
    "href",
    "/items?loc=garage"
  );
  await expect(main.getByRole("link", { name: "House", exact: true })).toHaveAttribute("href", "/home");
  await page.screenshot({
    path: test.info().outputPath("place-desktop.png"),
    fullPage: true,
  });
  await cabinet.click();
  await expect(main.getByRole("heading", { name: "Tool cabinet", exact: true })).toBeVisible();
  await expect(main.locator("[data-place-totals]")).toContainText("11 things");
  await expect(main.locator("[data-place-totals]")).toContainText("$640");
  await page.goto("/location/shelf");
  await expect(main.getByRole("heading", { name: "Shelf", exact: true })).toBeVisible();
  await expect(main.locator("[data-place-totals]")).toContainText("0 things");
  await expect(main.locator("[data-place-totals]")).toContainText("$0");
  await page.goto("/location/cabinet");
  await expect(main.getByText("No child places yet.")).toBeVisible();
  await expect(main.getByText("No things live directly in this place yet.")).toBeVisible();
  await main.getByRole("link", { name: "Garage", exact: true }).click();
  await expect(main.getByRole("heading", { name: "Garage", exact: true })).toBeVisible();
  await expect(cabinet.locator("[data-place-visit]")).toHaveText("You were here");
  await expect(main.locator("[data-place-visit]")).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath("place-visit.png"), fullPage: true });
  await page.reload();
  await expect(main.getByRole("heading", { name: "Garage", exact: true })).toBeVisible();
  await expect(main.locator("[data-place-visit]")).toHaveCount(0);

  for (const [buttonName, name, entityTypeId] of [
    ["Add item here", "New drill", "item-type"],
    ["Add a place", "New cabinet", "place-type"],
  ] as const) {
    const button = main.getByRole("button", { name: buttonName, exact: true });
    await expect(button.locator("svg")).toBeVisible();
    await button.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("combobox", { name: "Parent Location" })).toContainText("Garage");
    await dialog.getByRole("textbox", { name: /Name/ }).fill(name);
    await dialog.getByRole("button", { name: "Create and Add Another", exact: true }).click();
    await expect.poll(() => creates.at(-1)?.name).toBe(name);
    expect(creates.at(-1)).toMatchObject({ parentId: "garage", entityTypeId });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }

  await main.getByRole("link", { name: "All things", exact: true }).click();
  await expect(page).toHaveURL(/\/items\?loc=garage/);
  await expect.poll(() => queries.at(-1)?.searchParams.getAll("parentIds")).toEqual(["garage"]);
});
