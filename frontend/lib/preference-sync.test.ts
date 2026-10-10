import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { PreferenceSync } from "./preference-sync";
import { DEFAULT_PREFERENCES } from "./preferences";
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
};
function fixture(server: Record<string, unknown> = { theme: "claude" }) {
  let local = copy(DEFAULT_PREFERENCES);
  local.theme = "night";
  const fetch = vi.fn(async () => copy(server));
  const save = vi.fn(async (settings: Record<string, unknown>) => { server = copy(settings); });
  const sync = new PreferenceSync({
    read: () => local,
    apply: value => { local = value; sync.changed(); },
    config: () => ({ itemDisplayView: false, shownMultiTabWarning: false }), fetch, save,
  });
  return { sync, fetch, save, local: () => local,
    choose: (theme: "night" | "claude" | "dracula") => { local.theme = theme; sync.changed(); } };
}
afterEach(() => vi.useRealTimers());
describe("account preference synchronization", () => {
  it.each(["claude", "dracula"])("server %s wins over stale browser theme without a PUT", async theme => {
    const f = fixture({ theme, language: "fr" });
    f.sync.setAccount("a"); await settle();
    expect(f.local().theme).toBe(theme); expect(f.local().language).toBe("fr");
    expect(f.save).not.toHaveBeenCalled(); f.sync.dispose();
  });
  it("preserves unrelated legacy local settings absent from the server", async () => {
    const f = fixture(); f.local().showDetails = false;
    f.local().duplicateSettings.copyMaintenance = true;
    f.sync.setAccount("a"); await settle();
    expect(f.local().theme).toBe("claude"); expect(f.local().showDetails).toBe(false);
    expect(f.local().duplicateSettings.copyMaintenance).toBe(true);
    expect(f.save).not.toHaveBeenCalled(); f.sync.dispose();
  });
  it("preserves genuine edits during delayed hydration and unknown server keys", async () => {
    const f = fixture(); const gate = deferred<Record<string, unknown>>();
    f.fetch.mockImplementationOnce(() => gate.promise);
    f.sync.setAccount("a"); f.choose("dracula");
    expect(f.save).not.toHaveBeenCalled();
    gate.resolve({ theme: "claude", unknown: 42, duplicateSettings: { copyMaintenance: true } }); await settle();
    expect(f.local().theme).toBe("dracula"); expect(f.local().duplicateSettings.copyMaintenance).toBe(true);
    expect(f.save).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "dracula", unknown: 42 }));
    f.sync.dispose();
  });
  it("never saves after failed hydration until a successful fetch; retries local edits", async () => {
    vi.useFakeTimers(); const f = fixture({ theme: "claude", language: "de" });
    f.fetch.mockRejectedValueOnce(new Error("offline"));
    f.sync.setAccount("a"); await settle(); f.choose("night");
    expect(f.local().theme).toBe("night"); expect(f.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.save).toHaveBeenCalledWith(expect.objectContaining({ theme: "night", language: "de" }));
    f.sync.dispose();
  });
  it("retries a failed save without losing the choice or other server fields", async () => {
    vi.useFakeTimers(); const f = fixture({ theme: "claude", unknown: "keep" });
    f.sync.setAccount("a"); await settle(); f.save.mockRejectedValueOnce(new Error("offline"));
    f.choose("dracula"); await vi.advanceTimersByTimeAsync(400);
    expect(f.local().theme).toBe("dracula"); await vi.advanceTimersByTimeAsync(1000);
    expect(f.save).toHaveBeenCalledTimes(2);
    expect(f.save).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "dracula", unknown: "keep" }));
    f.sync.dispose();
  });
  it("keeps saved choices after mutation refresh, login and in another browser", async () => {
    vi.useFakeTimers(); const f = fixture(); f.sync.setAccount("a"); await settle();
    f.choose("night"); await vi.advanceTimersByTimeAsync(400);
    f.sync.refresh(); await settle(); expect(f.local().theme).toBe("night");
    f.sync.setAccount(null); f.sync.setAccount("a"); await settle(); expect(f.local().theme).toBe("night");
    const other = fixture(f.save.mock.calls[0]![0]); other.sync.setAccount("a"); await settle();
    expect(other.local().theme).toBe("night"); expect(other.save).not.toHaveBeenCalled();
    f.sync.dispose(); other.sync.dispose();
  });
  it("discards old account responses, edits and retries on identity change", async () => {
    vi.useFakeTimers(); const f = fixture({ theme: "dracula" });
    const old = deferred<Record<string, unknown>>(); f.fetch.mockImplementationOnce(() => old.promise);
    f.sync.setAccount("a"); f.choose("night"); f.sync.setAccount("b"); await settle();
    old.resolve({ theme: "night", language: "fr" }); await settle(); await vi.advanceTimersByTimeAsync(2000);
    expect(f.local().theme).toBe("dracula"); expect(f.local().language).toBeNull();
    expect(f.save).not.toHaveBeenCalled(); f.sync.dispose();
  });
});
const script = readFileSync(new URL("../public/set-theme.js", import.meta.url), "utf8");
function startup(raw: string | null, marker: string | null = null) {
  const storage = new Map<string, string>();
  if (raw !== null) storage.set("homebox/preferences/location", raw);
  if (marker) storage.set("homebox/preferences/theme-rollout", marker);
  let theme = ""; const classes = new Set<string>(["theme-night", "keep"]);
  runInNewContext(script, {
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    document: { documentElement: {
      classList: { [Symbol.iterator]: () => classes.values(), add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) },
      setAttribute: (_key: string, value: string) => { theme = value; },
    } },
  });
  return { theme, storage, classes };
}
it.each([null, "{bad", "null", "[]"])("pre-hydration startup uses Claude with %s", raw => {
  expect(startup(raw).theme).toBe("claude");
});
it("migrates explicit legacy local themes once and retains unrelated data", () => {
  const first = startup(JSON.stringify({ theme: "night", showDetails: false, unknown: { a: 1 } }));
  expect(first.theme).toBe("claude");
  expect(JSON.parse(first.storage.get("homebox/preferences/location")!)).toEqual({ theme: "claude", showDetails: false, unknown: { a: 1 } });
  const later = startup(JSON.stringify({ theme: "night", showDetails: false }), "claude-v1");
  expect(later.theme).toBe("night"); expect([...later.classes]).toEqual(["keep", "theme-night"]);
});
