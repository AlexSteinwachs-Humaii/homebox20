import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive, ref } from "vue";
import { readFileSync } from "node:fs";
import { useTodaySummary } from "../composables/use-today-summary";

const mocks = vi.hoisted(() => ({
  prefs: { value: { collectionId: "house" } },
  auth: { user: { id: "ada", defaultGroupId: "house" } },
  stats: vi.fn(),
  items: vi.fn(),
  clients: vi.fn(),
  listeners: new Map<string, () => void>(),
}));
vi.mock("../composables/use-api", () => ({
  useUserApi: () => {
    mocks.clients(mocks.prefs.value.collectionId);
    return { stats: { group: mocks.stats }, items: { getAll: mocks.items } };
  },
}));
vi.mock("../composables/use-auth-context", () => ({ useAuthContext: () => mocks.auth }));
vi.mock("../composables/use-preferences", () => ({ useViewPreferences: () => mocks.prefs }));
vi.mock("../composables/use-server-events", () => ({
  ServerEvent: { EntityMutation: "entity.mutation", ImportMutation: "import.mutation" },
  onServerEvent: (event: string, fn: () => void) => mocks.listeners.set(event, fn),
}));

describe("Today summary", () => {
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
    mocks.stats.mockResolvedValue({ error: false, data: { totalItemPrice: 120, totalItems: 6, totalLocations: 2 } });
    mocks.items.mockImplementation(async query => ({
      error: false,
      data: {
        items: query.onlyWithoutPhoto ? [] : [{ updatedAt: "2026-10-09T08:00:00Z" }],
        total: query.onlyWithoutPhoto ? 4 : 6,
      },
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads newest item timestamp and full no-photo total, not the three-card Care preview", async () => {
    const today = useTodaySummary();
    await today.refresh();
    expect(today.summary.value?.updatedAt).toBe("2026-10-09T08:00:00Z");
    expect(today.summary.value?.withoutPhoto).toBe(4);
    expect(today.summary.value?.statistics.totalItems).toBe(6);
    expect(mocks.items).toHaveBeenCalledWith({ orderBy: "updatedAt", page: 1, pageSize: 1 });
    expect(mocks.items).toHaveBeenCalledWith({ onlyWithoutPhoto: true, page: 1, pageSize: 1 });
  });

  it("hides stale collection data and rebuilds the tenant client after switching", async () => {
    const today = useTodaySummary();
    await today.refresh();
    expect(key()).toBe("today:ada:house");
    mocks.prefs.value.collectionId = "studio";
    expect(key()).toBe("today:ada:studio");
    expect(today.summary.value).toBeNull();
    await today.refresh();
    expect(today.summary.value?.groupId).toBe("studio");
    expect(mocks.clients).toHaveBeenLastCalledWith("studio");
  });

  it("refreshes mutations/imports, omits dates for empty collections and rejects failed requests", async () => {
    const today = useTodaySummary();
    mocks.items.mockResolvedValue({ error: false, data: { items: [], total: 0 } });
    mocks.listeners.get("entity.mutation")!();
    await vi.waitFor(() => expect(today.summary.value?.withoutPhoto).toBe(0));
    expect(today.summary.value?.updatedAt).toBeUndefined();
    mocks.listeners.get("import.mutation")!();
    expect(refresh).toHaveBeenCalledTimes(2);
    mocks.stats.mockResolvedValue({ error: true });
    await expect(load()).rejects.toThrow("Could not load Today summary");
  });

  it("renders canonical Care rows and four ordinary solid links without the legacy dashboard", () => {
    const home = readFileSync(new URL("../pages/home/index.vue", import.meta.url), "utf8");
    expect(home).toContain("useCareCount()");
    expect(home).toContain("needsYou.slice(0, 3)");
    expect(home).toContain('@updated="refreshCare()"');
    expect(home).toContain(':date="summary.updatedAt"');
    for (const legacy of ["StatCard", "TagChip", "<Table", "totalTags", "quick_statistics", "recently_added"]) {
      expect(home).not.toContain(legacy);
    }
    expect(home.match(/<NuxtLink to="\/items" class="rounded-xl border bg-card/g)).toHaveLength(2);
    expect(home).toContain('to="/locations" class="rounded-xl border bg-card');
    expect(home).toContain('to="/items?onlyWithoutPhoto=true" class="rounded-xl border bg-card');
  });
});
