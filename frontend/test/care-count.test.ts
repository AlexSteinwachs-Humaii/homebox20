import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ref, reactive } from "vue";
import { readFileSync } from "node:fs";
import { useCareCount } from "../composables/use-care-count";
import { MaintenanceAPI } from "../lib/api/classes/maintenance";
import type { CareQueue } from "../lib/api/types/data-contracts";
import type { Requests } from "../lib/requests";

const mocks = vi.hoisted(() => ({
  prefs: { value: { collectionId: "house" } },
  auth: { user: { id: "ada", defaultGroupId: "house" } },
  getCare: vi.fn(),
  listeners: new Map<string, () => void>(),
  clients: vi.fn(),
}));
vi.mock("../composables/use-api", () => ({
  useUserApi: () => {
    mocks.clients(mocks.prefs.value.collectionId);
    return { maintenance: { getCare: mocks.getCare } };
  },
}));
vi.mock("../composables/use-preferences", () => ({ useViewPreferences: () => mocks.prefs }));
vi.mock("../composables/use-auth-context", () => ({ useAuthContext: () => mocks.auth }));
vi.mock("../composables/use-server-events", () => ({
  ServerEvent: { EntityMutation: "entity.mutation", ImportMutation: "import.mutation" },
  onServerEvent: (event: string, fn: () => void) => mocks.listeners.set(event, fn),
}));

describe("shared Care query", () => {
  const data = ref<{ groupId: string; queue: CareQueue } | null>(null);
  const pending = ref(false);
  const error = ref<Error | null>(null);
  let load: () => Promise<{ groupId: string; queue: CareQueue }>;
  const refresh = vi.fn(async () => {
    data.value = await load();
  });
  const asyncData = vi.fn((key: () => string, fetcher: typeof load) => {
    load = fetcher;
    return { data, refresh, pending, error };
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prefs = reactive({ value: { collectionId: "house" } });
    mocks.listeners.clear();
    data.value = null;
    vi.stubGlobal("useAsyncData", asyncData);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads the server count, not distinct items or coming-up rows", async () => {
    const queue = { count: 3, needsYou: [], comingUp: [] } as CareQueue;
    mocks.getCare.mockResolvedValue({ data: queue, error: false });
    const care = useCareCount();
    expect(care.count.value).toBe(0);
    await care.refresh();
    expect(care.count.value).toBe(3); // deliberately differs from either list length
    expect(care.queue.value).toEqual(queue);
    expect(care.pending).toBe(pending);
    expect(care.error).toBe(error);
  });

  it("isolates collection keys and builds a fresh tenant client on each refresh", async () => {
    mocks.getCare.mockResolvedValue({ data: { count: 2, needsYou: [], comingUp: [] }, error: false });
    const care = useCareCount();
    await care.refresh();
    const key = asyncData.mock.calls[0]![0];
    expect(key()).toBe("care:ada:house");
    mocks.prefs.value.collectionId = "studio";
    expect(key()).toBe("care:ada:studio");
    expect(care.count.value).toBe(0);
    const studio = useCareCount();
    expect(asyncData.mock.calls[1]![0]()).toBe("care:ada:studio");
    expect(studio.count.value).toBe(0);
    mocks.getCare.mockResolvedValue({ data: { count: 0, needsYou: [], comingUp: [] }, error: false });
    await studio.refresh();
    expect(studio.count.value).toBe(0);
    expect(mocks.clients).toHaveBeenLastCalledWith("studio");
  });

  it("refreshes for entity mutations and imports, and surfaces failed queries", async () => {
    mocks.getCare.mockResolvedValue({ data: { count: 1, needsYou: [], comingUp: [] }, error: false });
    useCareCount();
    mocks.listeners.get("entity.mutation")!();
    await vi.waitFor(() => expect(data.value?.queue.count).toBe(1));
    mocks.listeners.get("import.mutation")!();
    expect(refresh).toHaveBeenCalledTimes(2);
    mocks.getCare.mockResolvedValue({ error: true });
    await expect(load()).rejects.toThrow("Could not load Care queue");
  });

  it("calls the canonical Care endpoint and renders a gold non-button badge only above zero", async () => {
    const get = vi.fn().mockResolvedValue({ data: { count: 0 } });
    await new MaintenanceAPI({ get } as unknown as Requests).getCare();
    expect(get).toHaveBeenCalledWith({ url: "/api/v1/care" });
    const layout = readFileSync(new URL("../layouts/default.vue", import.meta.url), "utf8");
    expect(layout).toContain("const { count: careCount } = useCareCount()");
    expect(layout).toContain("n.to === '/maintenance' && careCount > 0");
    expect(layout).toMatch(/<span\s+v-if="n.to === '\/maintenance' && careCount > 0"/);
    expect(layout).toContain("bg-warning");
    expect(layout).toContain("text-warning-foreground");
  });
});
