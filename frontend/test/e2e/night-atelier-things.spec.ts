import { expect, test } from "@playwright/test";

// Exercise the real search page and paging controls with deterministic API records.
test("Things renders photo-first rows, keeps archived matches, and pages the collection", async ({ page, context }) => {
  await context.addCookies([
    { name: "hb.auth.session", value: "true", url: test.info().project.use.baseURL! },
    { name: "hb.auth.attachment_token", value: "test-attachments", url: test.info().project.use.baseURL! },
  ]);
  await page.routeWebSocket("**/api/v1/ws/events*", () => {});
  const requests: URL[] = [];
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let json: unknown = [];
    if (path.endsWith("/users/self")) json = { item: { id: "ada", name: "Ada", defaultGroupId: "house" } };
    else if (path === "/api/v1/groups/all") json = [{ id: "house", name: "House" }];
    else if (path === "/api/v1/groups") json = { id: "house", name: "House", currency: "USD" };
    else if (path === "/api/v1/groups/statistics") json = { totalItems: 186 };
    else if (path === "/api/v1/care") json = { count: 0, needsYou: [], comingUp: [] };
    else if (path === "/api/v1/entities/tree")
      json = [{ id: "garage", name: "Garage", children: [{ id: "cabinet", name: "Tool cabinet", children: [] }] }];
    else if (path === "/api/v1/entities" && url.searchParams.get("isLocation") === "true")
      json = { items: [{ id: "cabinet", name: "Tool cabinet" }], total: 1 };
    else if (path === "/api/v1/entities") {
      requests.push(url);
      const size = Number(url.searchParams.get("pageSize"));
      const pageNumber = Number(url.searchParams.get("page"));
      const start = (pageNumber - 1) * size;
      const total = url.searchParams.get("q") === "nothing" ? 0 : size + 2;
      const items = Array.from({ length: Math.max(0, Math.min(size, total - start)) }, (_, i) => ({
        id: `drill-${start + i}`,
        name: `Drill ${start + i}`,
        assetId: `HB-${1042 + start + i}`,
        archived: start + i === 1,
        parent: { id: "cabinet", name: "Tool cabinet" },
        quantity: 2,
        purchasePrice: 189,
        tags: [{ id: "tools", name: "Tools" }],
        imageId: start + i === 0 ? "photo" : start + i === 2 ? "broken" : null,
      }));
      json = { items, total, page: pageNumber, pageSize: size };
    } else if (path.endsWith("/attachments/broken")) {
      await route.fulfill({ status: 404, body: "Photo unavailable" });
      return;
    } else if (path.endsWith("/attachments/photo")) {
      await route.fulfill({
        contentType: "image/svg+xml",
        body: "<svg xmlns='http://www.w3.org/2000/svg' width='220' height='170'><rect width='220' height='170' fill='#637f71'/></svg>",
      });
      return;
    } else if (path.includes("status"))
      json = { telemetry: { enabled: false }, build: { version: "v1.0.0" }, latest: { version: "v1.0.0" } };
    await route.fulfill({ json });
  });

  await page.goto("/items?q=drill");
  const main = page.locator("main");
  const rows = main.locator("[data-thing-row]");
  await expect(rows.first().getByRole("heading")).toHaveText("Drill 0");
  const size = Number(requests.at(-1)!.searchParams.get("pageSize"));
  expect(size).toBeGreaterThan(3);
  await expect(rows).toHaveCount(size);
  expect(requests.at(-1)!.searchParams.get("includeArchived")).toBe("true");
  await expect(main.locator("table")).toHaveCount(0);
  const live = rows.first();
  await expect(live.getByRole("img")).toBeVisible();
  await expect(live).toContainText("Garage > Tool cabinet");
  const photoBounds = await live.getByRole("img").boundingBox();
  const nameBounds = await live.getByRole("heading").boundingBox();
  expect(photoBounds!.x + photoBounds!.width).toBeLessThanOrEqual(nameBounds!.x);
  await expect(live).toContainText("Quantity: 2");
  await expect(live).toContainText("HB-1042");
  await expect(live).toContainText("Tools");
  await expect(live).toContainText("$189");
  await expect(live.getByRole("link", { name: "Open Drill 0" })).toHaveAttribute("href", "/item/drill-0");
  await expect(rows.nth(1)).toHaveAttribute("data-archived", "true");
  await expect(rows.nth(1)).toContainText("Archived");
  expect(await rows.nth(1).evaluate(el => getComputedStyle(el).color)).not.toBe(
    await live.evaluate(el => getComputedStyle(el).color)
  );
  await expect(rows.nth(2).getByRole("heading")).toHaveText("Drill 2");
  // Both a failed photo and a missing photo leave a usable record.
  await expect(rows.nth(2).getByRole("img")).toHaveCount(0);
  await expect(rows.nth(3).getByRole("img")).toHaveCount(0);
  await expect(rows.nth(3).getByRole("heading")).toHaveText("Drill 3");
  expect(await rows.nth(2).evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  await expect(main.getByText(`Showing ${size} of 186 in House.`)).toBeVisible();
  await expect(main.getByText(/Archived stays visible/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("things-desktop.png"), fullPage: true });

  await main
    .getByRole("navigation", { name: "Results pages" })
    .getByRole("button", { name: "Page 2", exact: true })
    .click();
  await expect(rows).toHaveCount(2);
  await expect(page).toHaveURL(/page=2/);
  await expect(rows.first().getByRole("heading")).toHaveText(`Drill ${size}`);
  await expect(main.getByText("Showing 2 of 186 in House.")).toBeVisible();
  expect(requests.at(-1)!.searchParams.get("page")).toBe("2");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(rows.first().getByRole("link")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath("things-mobile.png"), fullPage: true });

  await page.goto("/items?q=drill&archived=false");
  await expect(rows.first().getByRole("heading")).toHaveText("Drill 0");
  expect(requests.at(-1)!.searchParams.get("includeArchived")).toBe("false");
  await expect(main.getByText(/Archived is hidden/)).toBeVisible();
  await page.goto("/items?q=nothing");
  await expect(main.getByText("No things match this search.")).toBeVisible();
  await expect(main.getByText("Showing 0 of 186 in House.")).toBeVisible();
  await page.goto("/items");
  await expect(rows).toHaveCount(size);
  expect(requests.at(-1)!.searchParams.get("q") || "").toBe("");
});
