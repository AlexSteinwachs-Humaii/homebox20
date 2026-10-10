import { inflateRawSync } from "node:zlib";
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
  for (const type of ["photo", "receipt", "manual"]) {
    const upload = await request.post(`/api/v1/entities/${root.id}/attachments`, {
      multipart: {
        name: `${type}.txt`,
        type,
        primary: type === "photo" ? "true" : "false",
        file: { name: `${type}.txt`, mimeType: "text/plain", buffer: Buffer.from(`retained-${type}`) },
      },
    });
    expect(upload.ok()).toBe(true);
  }
  await page.goto("/");
  await page.locator("input[type=text]").first().fill(member);
  await page.locator("input[type=password]").fill(password);
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 30000 });
  return { root, child, leaf, create };
}

// Decode the central directory of the real backend ZIP (no test-only API).
function zipEntries(data: Buffer): Record<string, Buffer> {
  const end = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThanOrEqual(0);
  let offset = data.readUInt32LE(end + 16);
  const entries: Record<string, Buffer> = {};
  for (let n = 0; n < data.readUInt16LE(end + 10); n++) {
    expect(data.readUInt32LE(offset)).toBe(0x02014b50);
    const method = data.readUInt16LE(offset + 10);
    const size = data.readUInt32LE(offset + 20);
    const nameLen = data.readUInt16LE(offset + 28);
    const local = data.readUInt32LE(offset + 42);
    const name = data.subarray(offset + 46, offset + 46 + nameLen).toString();
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    const content = data.subarray(start, start + size);
    entries[name] = method === 8 ? inflateRawSync(content) : content;
    offset += 46 + nameLen + data.readUInt16LE(offset + 30) + data.readUInt16LE(offset + 32);
  }
  return entries;
}

function requiredEntry(entries: Record<string, Buffer>, name: string): Buffer {
  const entry = entries[name];
  if (!entry) throw new Error(`Missing ZIP entry: ${name}`);
  return entry;
}

async function completedJob(request: APIRequestContext, id: string) {
  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/v1/group/exports/${id}`);
        expect(response.ok()).toBe(true);
        return (await response.json()).status;
      },
      { timeout: 30000 }
    )
    .toBe("completed");
}

async function exportZIP(request: APIRequestContext) {
  const response = await request.post("/api/v1/group/exports");
  expect(response.status()).toBe(202);
  const job = await response.json();
  await completedJob(request, job.id);
  const download = await request.get(`/api/v1/group/exports/${job.id}/download`);
  expect(download.ok()).toBe(true);
  return { id: job.id, data: await download.body() };
}

async function validateHistoryRestore(request: APIRequestContext, disposition: string, notes: string) {
  const source = await exportZIP(request);
  const entries = zipEntries(source.data);
  const records = JSON.parse(requiredEntry(entries, "dispositions.json").toString());
  expect(records).toHaveLength(3);
  for (const row of records) expect(row).toMatchObject({ disposition, notes, recorder_name: "Member", quantity: 2.5 });
  expect(records.some((row: { is_location: boolean | number }) => !!row.is_location)).toBe(true);
  expect(
    JSON.parse(requiredEntry(entries, "entities.json").toString()).some(
      (row: { name: string }) => row.name === "Nested item"
    )
  ).toBe(false);
  const retained = JSON.parse(requiredEntry(entries, "disposition_attachments.json").toString());
  expect(retained).toHaveLength(2);
  for (const file of retained) {
    expect(requiredEntry(entries, `disposition_attachments/${file.id}`).toString()).toBe(`retained-${file.type}`);
  }
  const email = `restore-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = "Offboarding-restore-test-42!";
  expect((await request.post("/api/v1/users/register", { data: { email, name: "Importer", password } })).status()).toBe(
    204
  );
  expect((await request.post("/api/v1/users/login", { data: { username: email, password } })).ok()).toBe(true);
  // A different collection cannot see the source job or its retained bytes.
  expect((await request.get(`/api/v1/group/exports/${source.id}/download`)).status()).toBe(404);
  const imported = await request.post("/api/v1/group/import", {
    multipart: {
      file: { name: "history.zip", mimeType: "application/zip", buffer: source.data },
    },
  });
  expect(imported.status()).toBe(202);
  await completedJob(request, (await imported.json()).id);
  const restored = zipEntries((await exportZIP(request)).data);
  const restoredRecords = JSON.parse(requiredEntry(restored, "dispositions.json").toString());
  expect(restoredRecords).toHaveLength(3);
  for (const row of records) {
    const got = restoredRecords.find((candidate: { name: string }) => candidate.name === row.name);
    expect(got.id).not.toBe(row.id);
    expect(got.group_id).not.toBe(row.group_id);
    for (const key of Object.keys(row).filter(key => !["id", "group_id"].includes(key)))
      expect(got[key]).toEqual(row[key]);
  }
  expect(
    JSON.parse(requiredEntry(restored, "entities.json").toString())
      .map((row: { name: string }) => row.name)
      .sort()
  ).toEqual(
    JSON.parse(requiredEntry(entries, "entities.json").toString())
      .map((row: { name: string }) => row.name)
      .sort()
  );
  const restoredFiles = JSON.parse(requiredEntry(restored, "disposition_attachments.json").toString());
  expect(restoredFiles).toHaveLength(2);
  for (const file of restoredFiles)
    expect(requiredEntry(restored, `disposition_attachments/${file.id}`).toString()).toBe(`retained-${file.type}`);
  // History alone prevents a second destructive restore.
  expect(
    (
      await request.post("/api/v1/group/import", {
        multipart: {
          file: { name: "history.zip", mimeType: "application/zip", buffer: source.data },
        },
      })
    ).status()
  ).toBe(409);
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
    if (["donated", "destroyed"].includes(outcome))
      await validateHistoryRestore(request, outcome, "Leaving the collection");
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
  await validateHistoryRestore(request, "sold", "Hidden legacy notes");
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

for (const width of [1280, 390]) {
  test(`long notes wrap and survive removal/restore at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 844 });
    const { root } = await setup(page, request);
    await openRemoval(page, root);
    const notes = "N".repeat(10000);
    await page.getByLabel("Notes (optional)").fill(notes);
    await page.getByRole("button", { name: "Review removal" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Remove from collection" })).toBeVisible();
    expect(
      await dialog.evaluate(element => {
        const box = element.getBoundingClientRect();
        return element.scrollWidth <= element.clientWidth + 1 && box.left >= 0 && box.right <= innerWidth;
      })
    ).toBe(true);
    await expect(
      dialog.getByText(`Remove “${root.name}” and 2 descendants`, {
        exact: false,
      })
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Confirm removal" }).click();
    await expect(page).toHaveURL(/\/home$/);
    expect((await request.get(`/api/v1/entities/${root.id}`)).status()).toBe(404);
    await validateHistoryRestore(request, "destroyed", notes);
  });
}
