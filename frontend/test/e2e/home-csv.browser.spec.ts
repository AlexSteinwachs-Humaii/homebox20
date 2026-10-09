import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

async function downloadInventory(page: Page) {
  const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Quick Statistics" }) });
  const button = section.getByRole("button", { name: "Download CSV", exact: true });
  await expect(button).toBeVisible();
  // The control belongs beside the subtitle, not in a stat card or the recent-items table.
  await expect(button.locator("..").getByRole("heading", { name: "Quick Statistics" })).toBeVisible();

  const requestPromise = page.context().waitForEvent("request", {
    predicate: request => new URL(request.url()).pathname === "/api/v1/entities/export",
  });
  const downloadPromise = page.waitForEvent("download");
  await button.click();
  const request = await requestPromise;
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^homebox-entities_.*\.csv$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  return { url: new URL(request.url()), csv: await readFile(path!, "utf8") };
}

test("Home downloads the full standard inventory CSV, including an empty collection", async ({ page }) => {
  const email = `home-csv-${randomUUID()}@example.com`;
  const password = "StrongHomeCSVPassword123!";
  const registration = await page.request.post("/api/v1/users/register", {
    data: { email, password, name: "Home CSV Test", token: "" },
  });
  expect(registration.status()).toBe(204);

  await page.goto("/");
  await page.locator("input[type='text']").fill(email);
  await page.locator("input[type='password']").fill(password);
  await page.locator("button[type='submit']").click();
  await expect(page).toHaveURL("/home");

  try {
    await expect
      .poll(() =>
        page.evaluate(() => JSON.parse(localStorage.getItem("homebox/preferences/location") || "{}").collectionId)
      )
      .toBeTruthy();
    const collectionId = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem("homebox/preferences/location") || "{}").collectionId as string;
    });
    expect(collectionId).toBeTruthy();

    // Registration seeds default locations, which are also part of the standard inventory export.
    const locationsResponse = await page.request.get(`/api/v1/entities?tenant=${collectionId}&isLocation=true`);
    expect(locationsResponse.ok()).toBeTruthy();
    const { items: locations } = await locationsResponse.json();
    for (const location of locations) {
      const deleted = await page.request.delete(`/api/v1/entities/${location.id}?tenant=${collectionId}`);
      expect(deleted.ok()).toBeTruthy();
    }
    await page.reload();

    const empty = await downloadInventory(page);
    expect(empty.url.searchParams.get("tenant")).toBe(collectionId);
    const exportResponse = await page.request.get(empty.url.toString());
    expect(exportResponse.headers()["content-type"]).toContain("text/csv");
    const header = empty.csv.trim().split(/\r?\n/);
    expect(header).toHaveLength(1);
    for (const column of ["HB.name", "HB.quantity", "HB.purchase_price", "HB.location", "HB.tags", "HB.asset_id"]) {
      expect(header[0]!.split(",")).toContain(column);
    }

    const typesResponse = await page.request.get(`/api/v1/entity-types?tenant=${collectionId}`);
    expect(typesResponse.ok()).toBeTruthy();
    const types = await typesResponse.json();
    const itemType = types.find((type: { isLocation: boolean }) => !type.isLocation);
    expect(itemType).toBeTruthy();
    for (let i = 0; i < 6; i++) {
      const created = await page.request.post(`/api/v1/entities?tenant=${collectionId}`, {
        data: { name: `CSV item ${i}`, description: "", entityTypeId: itemType.id, quantity: 1, tagIds: [] },
      });
      expect(created.ok()).toBeTruthy();
    }

    await page.reload();
    const full = await downloadInventory(page);
    expect(full.url.searchParams.get("tenant")).toBe(collectionId);
    expect(full.csv.trim().split(/\r?\n/)).toHaveLength(7);
    expect(full.csv.trim().split(/\r?\n/)[0]).toBe(header[0]);
    for (let i = 0; i < 6; i++) {
      expect(full.csv).toContain(`CSV item ${i}`);
    }

    await page.goto("/collection/tools");
    const inventoryDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export Inventory", exact: true }).click();
    const inventoryPath = await (await inventoryDownload).path();
    expect(await readFile(inventoryPath!, "utf8")).toBe(full.csv);
    const bomDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Generate BOM", exact: true }).click();
    expect((await bomDownload).suggestedFilename()).toMatch(/\.csv$/);

    const forbidden = await page.request.get(`/api/v1/entities/export?tenant=${randomUUID()}`);
    expect(forbidden.status()).toBe(403);
  } finally {
    await page.request.delete("/api/v1/users/self");
  }
});
