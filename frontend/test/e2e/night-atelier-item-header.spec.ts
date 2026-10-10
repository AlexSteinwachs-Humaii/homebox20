import { expect, test, type Page, type BrowserContext } from "@playwright/test";

async function mockRecord(
  page: Page,
  context: BrowserContext,
  withPhoto: boolean,
  title = "Two batteries",
  overrides: Record<string, unknown> = {}
) {
  await context.addCookies([
    { name: "hb.auth.session", value: "true", url: test.info().project.use.baseURL! },
    { name: "hb.auth.attachment_token", value: "test", url: test.info().project.use.baseURL! },
  ]);
  await page.routeWebSocket("**/api/v1/ws/events*", () => {});
  const actions: string[] = [];
  const item = {
    id: "drill",
    name: "Makita cordless drill",
    assetId: "HB-1042",
    description: "Bits in the same drawer",
    quantity: 1,
    insured: true,
    serialNumber: "MKT-18V-4421",
    notes: "Keep the receipt in the case",
    purchaseFrom: "Home Depot",
    fields: [],
    tags: [{ id: "tools", name: "Tools" }],
    imageId: withPhoto ? "cover" : null,
    attachments: withPhoto
      ? [
          { id: "other", type: "photo", title: "Other photo", path: "other.svg", mimeType: "image/svg+xml" },
          { id: "cover", type: "photo", title, path: "cover.svg", mimeType: "image/svg+xml" },
        ]
      : [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    purchasePrice: 189,
    soldPrice: 0,
    purchaseDate: "0001-01-01T00:00:00Z",
    soldDate: "0001-01-01T00:00:00Z",
    warrantyExpires: "0001-01-01T00:00:00Z",
    ...overrides,
  };
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = [];
    if (path.endsWith("/users/self")) json = { item: { id: "ada", name: "Ada", defaultGroupId: "house" } };
    else if (path.endsWith("/groups/all")) json = [{ id: "house", name: "House" }];
    else if (path.endsWith("/groups")) json = { id: "house", name: "House", currency: "USD" };
    else if (path.endsWith("/care")) json = { count: 0, needsYou: [], comingUp: [] };
    else if (path.endsWith("/tags")) json = item.tags;
    else if (path.endsWith("/entities/drill/path"))
      json = [
        { id: "garage", name: "Garage", type: "location" },
        { id: "cabinet", name: "Tool cabinet", type: "location" },
        { id: "drill", name: item.name, type: "item" },
      ];
    else if (path.endsWith("/entities/drill/duplicate")) {
      actions.push("duplicate");
      json = { ...item, id: "copy" };
    } else if (path.endsWith("/entities/drill") && route.request().method() === "DELETE") {
      actions.push("delete");
      json = {};
    } else if (path.endsWith("/entities/drill") && route.request().method() === "PATCH") {
      Object.assign(item, route.request().postDataJSON());
      actions.push("quantity");
      json = item;
    } else if (path.endsWith("/entities/drill") || path.endsWith("/entities/copy")) json = item;
    else if (path.endsWith("/entities/drill/maintenance")) {
      actions.push("item-care");
      json = [
        {
          id: "drill-care",
          name: "Check drill batteries",
          cost: "0",
          description: "This drill only",
          scheduledDate: "2026-10-10",
          completedDate: "0001-01-01T00:00:00Z",
        },
      ];
    } else if (path.endsWith("/entities")) json = { items: [], total: 0 };
    else if (path.includes("/attachments/") || path.includes("/labelmaker/")) {
      await route.fulfill({
        contentType: "image/svg+xml",
        body: "<svg xmlns='http://www.w3.org/2000/svg' width='220' height='170'><rect width='220' height='170' fill='#637f71'/></svg>",
      });
      return;
    } else if (path.includes("status"))
      json = { telemetry: { enabled: false }, build: { version: "v1.0.0" }, latest: { version: "v1.0.0" } };
    await route.fulfill({ json });
  });
  return actions;
}

for (const withPhoto of [true, false]) {
  test(`Item header remains usable ${withPhoto ? "with" : "without"} a photo`, async ({ page, context }) => {
    await mockRecord(page, context, withPhoto);
    await page.goto("/item/drill");
    const header = page.getByTestId("item-record-header");
    await expect(header.getByRole("heading", { name: "Makita cordless drill" })).toBeVisible();
    await expect(header).toContainText("Tools");
    await expect(header.getByRole("link", { name: "House", exact: true })).toHaveAttribute("href", "/home");
    for (const [name, id] of [
      ["Garage", "garage"],
      ["Tool cabinet", "cabinet"],
    ]) {
      await expect(header.getByRole("link", { name, exact: true })).toHaveAttribute("href", `/location/${id}`);
    }
    const asset = page.getByTestId(withPhoto ? "item-photo-asset-id" : "item-record-asset-id");
    await expect(asset).toContainText("HB-1042");
    if (withPhoto) {
      await expect(header.locator("img")).toHaveAttribute("src", /attachments\/cover/);
      await expect(page.getByTestId("item-record-photo")).toContainText("Two batteries");
      const photo = await header.locator("img").boundingBox();
      const name = await header.getByRole("heading").boundingBox();
      expect(photo!.x + photo!.width).toBeLessThanOrEqual(name!.x);
      await header.getByRole("button", { name: "Photo", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
    } else await expect(header.locator("img")).toHaveCount(0);
    await expect(header.getByRole("link", { name: "Edit", exact: true })).toHaveAttribute("href", "/item/drill/edit");
    await expect(header.getByRole("link", { name: "Edit", exact: true }).locator("svg")).toBeVisible();
    await expect(header.getByRole("button", { name: "Create subitem" }).locator("svg")).toBeVisible();
    await header.getByRole("button", { name: "Create subitem" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await header.getByRole("button", { name: /[Mm]ore.actions/ }).click();
    await expect(page.getByRole("menuitem", { name: "Duplicate", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Delete", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    // Keep LabelMaker's existing print dialog and download actions, not a new pipeline.
    const print = header.locator('button:has(svg[name="mdi-printer-pos"])');
    await expect(print.locator("svg")).toBeVisible();
    await print.click();
    await expect(page.getByRole("dialog").locator("img")).toHaveAttribute("src", /labelmaker\/asset\/HB-1042/);
    await page.keyboard.press("Escape");
    const download = page.waitForEvent("download");
    await header.locator('button:has(svg[name="mdi-file-download"])').click();
    expect((await download).suggestedFilename()).toBe("label-HB-1042.png");
    await page.screenshot({
      path: test.info().outputPath(`item-${withPhoto ? "photo" : "empty"}.png`),
      fullPage: true,
    });
  });
}

test("Caption falls back to the item description and duplicate still works", async ({ page, context }) => {
  const actions = await mockRecord(page, context, true, "");
  await page.goto("/item/drill");
  await expect(page.getByTestId("item-record-photo")).toContainText("Bits in the same drawer");
  await page
    .getByTestId("item-record-header")
    .getByRole("button", { name: /[Mm]ore.actions/ })
    .click();
  await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
  await expect(page).toHaveURL(/\/item\/copy$/);
  expect(actions).toContain("duplicate");
});

test("Delete still requires confirmation and uses the existing API", async ({ page, context }) => {
  const actions = await mockRecord(page, context, false);
  await page.goto("/item/drill");
  await page
    .getByTestId("item-record-header")
    .getByRole("button", { name: /[Mm]ore.actions/ })
    .click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  expect(actions).not.toContain("delete");
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect.poll(() => actions).toContain("delete");
  await expect(page).toHaveURL(/\/home$/);
});

for (const [days, lifetime, visible] of [
  [1, false, true],
  [12, false, true],
  [30, false, true],
  [31, false, false],
  [0, false, false],
  [-1, false, false],
  [12, true, false],
] as const) {
  test(`Warranty ${days} days away, lifetime=${lifetime}`, async ({ page, context }) => {
    await page.clock.setFixedTime(new Date("2026-10-09T12:00:00"));
    const end = new Date(2026, 9, 9 + days);
    const date = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
    await mockRecord(page, context, false, "", { warrantyExpires: date, lifetimeWarranty: lifetime });
    await page.goto("/item/drill");
    await expect(page.getByRole("heading", { name: "Makita cordless drill" })).toBeVisible();
    const warning = page.getByTestId("item-warranty-warning");
    if (visible) {
      await expect(warning).toContainText(`Warranty ends in ${days} days`);
      await expect(warning).toContainText(String(end.getFullYear()));
      await expect(warning).toHaveClass(/text-warning/);
      expect(await warning.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
    } else await expect(warning).toHaveCount(0);
    if (days === 12 && !lifetime)
      await page.screenshot({ path: test.info().outputPath("warranty-gold.png"), fullPage: true });
  });
}

test("Solid details, quantity, notes, and item-specific section tabs", async ({ page, context }) => {
  const actions = await mockRecord(page, context, true, "Two batteries", { purchaseDate: "2024-11-04" });
  await page.goto("/item/drill");
  const details = page.getByTestId("item-details");
  for (const fact of ["Quantity", "189.00", "Insured", "Yes", "MKT-18V-4421", "2024", "Home Depot"]) {
    await expect(details).toContainText(fact);
  }
  expect(await details.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  await details.getByRole("button", { name: "Increase quantity" }).click();
  await expect.poll(() => actions.filter(a => a === "quantity").length).toBe(1);
  await expect(details.locator("dd").first()).toContainText("2");
  await details.getByRole("button", { name: "Decrease quantity" }).click();
  await expect(details.locator("dd").first()).toContainText("1");
  const notes = page.getByTestId("item-notes");
  await expect(notes).toContainText("Keep the receipt in the case");
  expect((await notes.boundingBox())!.y).toBeGreaterThan((await details.locator("dl").boundingBox())!.y);
  const sections = page.getByRole("group", { name: "Item sections" });
  for (const name of ["Details", "Care", "Attachments", "Label"]) {
    await expect(sections.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expect(sections.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  await sections.getByRole("link", { name: "Care", exact: true }).click();
  await expect(page.getByTestId("item-care")).toBeVisible();
  await expect.poll(() => actions.includes("item-care")).toBe(true);
  await expect(page.getByTestId("item-care")).toContainText("Check drill batteries");
  await expect(page.getByTestId("item-care")).toContainText("This drill only");
  await sections.getByRole("link", { name: "Attachments", exact: true }).click();
  await expect(page.getByTestId("item-attachments")).toContainText("Two batteries");
  await sections.getByRole("link", { name: "Label", exact: true }).click();
  await page.getByTestId("item-label").locator('button:has(svg[name="mdi-printer-pos"])').click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("dialog").locator("img")).toHaveAttribute("src", /labelmaker\/asset\/HB-1042/);
  await page.keyboard.press("Escape");
});
