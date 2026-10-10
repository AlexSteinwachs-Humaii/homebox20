import { expect, test, type Page, type BrowserContext } from "@playwright/test";

async function mockRecord(page: Page, context: BrowserContext, withPhoto: boolean, title = "Two batteries") {
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
    fields: [],
    tags: [{ id: "tools", name: "Tools" }],
    imageId: withPhoto ? "cover" : null,
    attachments: withPhoto
      ? [
          { id: "other", type: "photo", title: "Other photo", mimeType: "image/svg+xml" },
          { id: "cover", type: "photo", title, mimeType: "image/svg+xml" },
        ]
      : [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    purchasePrice: 189,
    soldPrice: 0,
    purchaseDate: "0001-01-01T00:00:00Z",
    soldDate: "0001-01-01T00:00:00Z",
    warrantyExpires: "0001-01-01T00:00:00Z",
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
    } else if (path.endsWith("/entities/drill") || path.endsWith("/entities/copy")) json = item;
    else if (path.endsWith("/entities")) json = { items: [], total: 0 };
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
