import { expect, test } from "vitest";
import { factories } from "../factories";
import { Requests } from "../../../requests";
import { route } from "../../base";
import type { CareQueue } from "../../types/data-contracts";

// Exercises the route/middleware/client contract; date-boundary and photo
// predicate fixtures are covered in repo_care_test.go.
test("Care is authenticated, group-scoped, and counts rows rather than items", async () => {
  const { client } = await factories.client.singleUse();
  const { client: other } = await factories.client.singleUse();
  const types = await client.entityTypes.getAll();
  const itemType = types.data.find(type => !type.isLocation)!;
  const item = await client.items.create({
    name: "Care fixture",
    description: "",
    entityTypeId: itemType.id,
    parentId: null,
    quantity: 1,
    tagIds: [],
  });
  expect(item.status).toBe(201);
  try {
    // Use dates safely away from today's boundary.
    const overdue = await client.items.maintenance.create(item.data.id, {
      name: "Overdue",
      description: "replace every 90 days",
      completedDate: "",
      scheduledDate: "2020-01-01",
      cost: "0",
    });
    expect(overdue.status).toBe(201);
    const upcoming = await client.items.maintenance.create(item.data.id, {
      name: "Upcoming",
      description: "",
      completedDate: "",
      scheduledDate: "2099-01-01",
      cost: "0",
    });
    expect(upcoming.status).toBe(201);
    const queue = await client.maintenance.getCare();
    expect(queue.status).toBe(200);
    expect(queue.data.count).toBe(2); // overdue + missing photo on the same item
    expect(queue.data.needsYou.map(row => row.kind)).toEqual(["overdue", "missing_photo"]);
    expect(queue.data.comingUp).toHaveLength(1);
    expect(queue.data.needsYou.every(row => row.itemId === item.data.id)).toBe(true);
    const foreign = await other.maintenance.getCare();
    expect(foreign.status).toBe(200);
    expect(foreign.data).toEqual({ count: 0, needsYou: [], comingUp: [] });
    const anonymous = await new Requests("").get<CareQueue>({ url: route("/care") });
    expect(anonymous.status).toBe(401);
  } finally {
    expect((await client.items.delete(item.data.id)).status).toBe(204);
  }
});
