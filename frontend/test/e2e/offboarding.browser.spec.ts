import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { EntityOut, EntityTypeSummary } from "../../lib/api/types/data-contracts";

test.setTimeout(90000);
// Keep error injection deterministic: PWA service-worker fetches bypass page.route.
test.use({ serviceWorkers: "block" });

// Each test uses an isolated collection and an invited ordinary member, against the real backend.
async function setup(page: Page, request: APIRequestContext, place = false) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const password = "Offboarding-browser-test-42!";
  const owner = `owner-${suffix}@example.com`;
  const member = `member-${suffix}@example.com`;
  expect(
    (await request.post("/api/v1/users/register", { data: { email: owner, name: "Owner", password } })).status()
  ).toBe(204);
  expect((await request.post("/api/v1/users/login", { data: { username: owner, password } })).ok()).toBe(true);
  const invitation = await request.post("/api/v1/groups/invitations", {
    data: { uses: 1, expiresAt: new Date(Date.now() + 86400000).toISOString() },
  });
  expect(invitation.ok()).toBe(true);
  expect(
    (
      await request.post("/api/v1/users/register", {
        data: { email: member, name: "Member", password, token: (await invitation.json()).token },
      })
    ).status()
  ).toBe(204);
  const types: EntityTypeSummary[] = await (await request.get("/api/v1/entity-types")).json();
  const itemType = types.find(type => !type.isLocation)!;
  const placeType = types.find(type => type.isLocation)!;
  async function create(name: string, isPlace: boolean, parentId?: string): Promise<EntityOut> {
    const result = await request.post("/api/v1/entities", {
      data: {
        name,
        entityTypeId: (isPlace ? placeType : itemType).id,
        description: "",
        quantity: 2.5,
        tagIds: [],
        parentId,
      },
    });
    expect(result.status()).toBe(201);
    return result.json();
  }
  const root = await create(`Offboarding ${suffix}`, place);
  const child = await create("Nested place", true, root.id);
  const leaf = await create("Nested item", false, child.id);
  await page.goto("/");
  await page.locator("input[type=text]").first().fill(member);
  await page.locator("input[type=password]").fill(password);
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 30000 });
  return { root, child, leaf, create };
}

async function openRemoval(page: Page, root: EntityOut, place = false) {
  await page.goto(`/${place ? "location" : "item"}/${root.id}`);
  if (!place) await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole(place ? "button" : "menuitem", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText(`Remove “${root.name}” and 2 descendants`, { exact: false })).toBeVisible();
}

for (const outcome of ["sold", "destroyed", "given_away", "donated", "lost_or_stolen"]) {
  test(`member offboards complete tree: ${outcome}`, async ({ page, request }) => {
    const place = outcome === "destroyed";
    const { root, child, leaf } = await setup(page, request, place);
    const before = await (await request.get("/api/v1/groups/statistics")).json();
    await openRemoval(page, root, place);
    await page.getByLabel("What happened?").selectOption(outcome);
    const requiresRecipient = ["sold", "given_away", "donated"].includes(outcome);
    if (requiresRecipient) {
      await page.getByLabel("Recipient (required)").fill("Household recipient");
    } else {
      await expect(page.getByLabel("Recipient (required)")).toHaveCount(0);
    }
    await page.getByLabel("Date", { exact: true }).fill("2026-10-09");
    await page.getByLabel("Notes (optional)").fill("Leaving the collection");
    if (outcome === "sold") await page.getByLabel("Value (optional)").fill("0");
    await page.getByRole("button", { name: "Review removal" }).click();
    const submission = page.waitForRequest(
      req => req.method() === "POST" && req.url().endsWith(`/entities/${root.id}/offboarding`)
    );
    await page.getByRole("button", { name: "Confirm removal" }).click();
    const body = (await submission).postDataJSON();
    expect(body.disposition).toBe(outcome);
    expect(body.notes).toBe("Leaving the collection");
    expect(body.date).toBe("2026-10-09");
    if (outcome === "sold") expect(body.value).toBe(0);
    else expect(body).not.toHaveProperty("value");
    await expect(page).toHaveURL(place ? /\/locations$/ : /\/home$/);
    await expect(page.getByText("3 records retained.", { exact: false })).toBeVisible();
    for (const entity of [root, child, leaf])
      expect((await request.get(`/api/v1/entities/${entity.id}`)).status()).toBe(404);
    const search = await (await request.get(`/api/v1/entities?q=${encodeURIComponent(root.name)}`)).json();
    expect(search.items).toHaveLength(0);
    const after = await (await request.get("/api/v1/groups/statistics")).json();
    expect(after.totalItems).toBe(before.totalItems - (place ? 1 : 2));
    expect(after.totalLocations).toBe(before.totalLocations - (place ? 2 : 1));
  });
}

test("sale action replaces editable fields and prefills hidden notes", async ({ page, request }) => {
  const { root } = await setup(page, request);
  expect(
    (
      await request.put(`/api/v1/entities/${root.id}`, {
        data: {
          ...root,
          entityTypeId: root.entityType!.id,
          soldTo: "Legacy buyer",
          soldPrice: 45.5,
          soldDate: "2025-03-09",
          soldNotes: "Hidden legacy notes",
        },
      })
    ).ok()
  ).toBe(true);
  await page.goto(`/item/${root.id}/edit`);
  await expect(page.getByLabel("Sold To", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Record sale and remove" }).click();
  await expect(page.getByLabel("Recipient (required)")).toHaveValue("Legacy buyer");
  await expect(page.getByLabel("Value (optional)")).toHaveValue("45.5");
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue("2025-03-09");
  await expect(page.getByLabel("Notes (optional)")).toHaveValue("Hidden legacy notes");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const kept = await (await request.get(`/api/v1/entities/${root.id}`)).json();
  expect(kept.soldNotes).toBe("Hidden legacy notes");
  await page.getByRole("button", { name: "Record sale and remove" }).click();
  await page.getByRole("button", { name: "Review removal" }).click();
  const submission = page.waitForRequest(
    req => req.method() === "POST" && req.url().endsWith(`/entities/${root.id}/offboarding`)
  );
  await page.getByRole("button", { name: "Confirm removal" }).click();
  expect((await submission).postDataJSON()).toMatchObject({
    disposition: "sold",
    recipient: "Legacy buyer",
    value: 45.5,
    date: "2025-03-09",
    notes: "Hidden legacy notes",
  });
  await expect(page).toHaveURL(/\/home$/);
  expect((await request.get(`/api/v1/entities/${root.id}`)).status()).toBe(404);
});

test("changed tree requires a new review and keeps entries", async ({ page, request }) => {
  const { root, create } = await setup(page, request);
  await openRemoval(page, root);
  await page.getByLabel("Notes (optional)").fill("Keep these notes");
  await page.getByRole("button", { name: "Review removal" }).click();
  await create("New descendant", false, root.id);
  await page.getByRole("button", { name: "Confirm removal" }).click();
  await expect(page.getByRole("alert")).toContainText("inventory tree changed");
  await expect(page.getByText(`Remove “${root.name}” and 3 descendants`, { exact: false })).toBeVisible();
  await expect(page.getByLabel("Notes (optional)")).toHaveValue("Keep these notes");
  await expect(page.getByRole("button", { name: "Confirm removal" })).toHaveCount(0);
  expect((await request.get(`/api/v1/entities/${root.id}`)).status()).toBe(200);
});

test("mobile keyboard controls, validation, failure preservation and repeat guard", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { root } = await setup(page, request, true);
  await openRemoval(page, root, true);
  await page.getByLabel("What happened?").selectOption("donated");
  await page.getByRole("button", { name: "Review removal" }).click();
  await expect(page.getByLabel("Recipient (required)")).toBeFocused();
  await page.getByLabel("Recipient (required)").fill("Museum");
  await page.getByLabel("Notes (optional)").fill("Preserve on failure");
  await page.getByRole("button", { name: "Review removal" }).focus();
  await page.keyboard.press("Enter");
  let count = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route(`**/entities/${root.id}/offboarding`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    count++;
    await pending;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "retained file copy failed" }),
    });
  });
  await page.getByRole("button", { name: "Confirm removal" }).click();
  await expect(page.getByRole("button", { name: "Removing…" })).toBeDisabled();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  release();
  await expect(page.getByRole("alert")).toContainText("entries are preserved");
  expect(count).toBe(1);
  await page.getByRole("button", { name: "Edit details" }).click();
  await expect(page.getByLabel("Recipient (required)")).toHaveValue("Museum");
  await expect(page.getByLabel("Notes (optional)")).toHaveValue("Preserve on failure");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await request.get(`/api/v1/entities/${root.id}`)).status()).toBe(200);
});
