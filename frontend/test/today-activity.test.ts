import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive, ref } from "vue";
import { useTodayActivity } from "../composables/use-today-activity";

const mocks = vi.hoisted(() => ({
  prefs: { value: { collectionId: "house" } },
  auth: { user: { id: "ada", defaultGroupId: "house" } },
  items: vi.fn(),
  rooms: vi.fn(),
  values: vi.fn(),
  clients: vi.fn(),
  listeners: new Map<string, () => void>(),
}));
vi.mock("../composables/use-api", () => ({
  useUserApi: () => {
    mocks.clients(mocks.prefs.value.collectionId);
    return { items: { getAll: mocks.items, getLocations: mocks.rooms }, stats: { locations: mocks.values } };
  },
}));
vi.mock("../composables/use-auth-context", () => ({ useAuthContext: () => mocks.auth }));
vi.mock("../composables/use-preferences", () => ({ useViewPreferences: () => mocks.prefs }));
vi.mock("../composables/use-server-events", () => ({
  ServerEvent: { EntityMutation: "entity", ImportMutation: "import" },
  onServerEvent: (event: string, fn: () => void) => mocks.listeners.set(event, fn),
}));

describe("Today activity", () => {
  const data = ref<unknown>(null);
  let load: () => Promise<unknown>;
  let key: () => string;
  const refresh = vi.fn(async () => {
    data.value = await load();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prefs = reactive({ value: { collectionId: "house" } });
    mocks.listeners.clear();
    data.value = null;
    vi.stubGlobal("useAsyncData", (queryKey: typeof key, fetcher: typeof load) => {
      key = queryKey;
      load = fetcher;
      return { data, refresh, pending: ref(false), error: ref(null) };
    });
    mocks.items.mockResolvedValue({
      data: { items: [{ id: "drill", parent: { name: "Garage" }, purchasePrice: 189 }] },
    });
    mocks.rooms.mockResolvedValue({
      data: [
        { id: "garage", itemCount: 24 },
        { id: "hall", itemCount: 0 },
      ],
    });
    mocks.values.mockResolvedValue({ data: [{ id: "garage", total: 2140 }] });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("requests last touched items and top-level places, joins direct totals by id with a zero fallback", async () => {
    const today = useTodayActivity();
    await today.refresh();
    expect(mocks.items).toHaveBeenCalledWith({ orderBy: "updatedAt", page: 1, pageSize: 4 });
    expect(mocks.rooms).toHaveBeenCalledWith({ filterChildren: true });
    expect(today.activity.value?.recent[0]).toMatchObject({ parent: { name: "Garage" }, purchasePrice: 189 });
    expect(today.activity.value?.places).toEqual([
      { id: "garage", itemCount: 24, value: 2140 },
      { id: "hall", itemCount: 0, value: 0 },
    ]);
  });
  it("hides stale collection data and constructs a fresh tenant client", async () => {
    const today = useTodayActivity();
    await today.refresh();
    mocks.prefs.value.collectionId = "studio";
    expect(key()).toBe("today-activity:ada:studio");
    expect(today.activity.value).toBeNull();
    await today.refresh();
    expect(mocks.clients).toHaveBeenLastCalledWith("studio");
    expect(today.activity.value?.groupId).toBe("studio");
  });
  it("refreshes on mutations/imports and rejects failures instead of showing misleading zeros", async () => {
    const today = useTodayActivity();
    mocks.listeners.get("entity")!();
    await vi.waitFor(() => expect(today.activity.value).not.toBeNull());
    mocks.listeners.get("import")!();
    expect(refresh).toHaveBeenCalledTimes(2);
    mocks.values.mockResolvedValue({ error: true });
    await expect(load()).rejects.toThrow("Could not load Today activity");
  });
});
