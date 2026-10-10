import type { Ref } from "vue";
import { DEFAULT_PREFERENCES } from "~/lib/preferences";
import { PreferenceSync } from "~/lib/preference-sync";
import type { LocationViewPreferences, PreferenceSyncConfig } from "~/lib/preferences";
export type { ViewType, DuplicateSettings, LocationViewPreferences, PreferenceSyncConfig } from "~/lib/preferences";

let syncConfig: PreferenceSyncConfig = { itemDisplayView: false, shownMultiTabWarning: false };
let syncInitialized = false;
const results = useLocalStorage("homebox/preferences/location", structuredClone(DEFAULT_PREFERENCES), { mergeDefaults: true });

// Also handle startup without the early script (blocked script or old cached HTML).
if (import.meta.client) {
  try {
    if (localStorage.getItem("homebox/preferences/theme-rollout") !== "claude-v1") {
      results.value = { ...results.value, theme: "claude" };
      localStorage.setItem("homebox/preferences/location", JSON.stringify(results.value));
      localStorage.setItem("homebox/preferences/theme-rollout", "claude-v1");
    }
  } catch {
    results.value = { ...results.value, theme: "claude" };
  }
}

export function configureViewPreferenceSync(config: PreferenceSyncConfig) {
  syncConfig = { ...syncConfig, ...config };
}

export function useViewPreferencesSync() {
  if (syncInitialized || !import.meta.client) return;
  syncInitialized = true;
  const auth = useAuthContext();
  const sync = new PreferenceSync({
    read: () => results.value,
    apply: value => { results.value = value; },
    config: () => syncConfig,
    // Cache ownership is not evidence of successful account hydration/migration.
    owner: () => {
      try { return localStorage.getItem("homebox/preferences/owner"); } catch { return null; }
    },
    setOwner: id => {
      try {
        if (id) localStorage.setItem("homebox/preferences/owner", id);
        else localStorage.removeItem("homebox/preferences/owner");
      } catch { /* In-memory identity still isolates accounts when storage is unavailable. */ }
    },
    fetch: async () => {
      const { data, error } = await useUserApi().user.getSettings();
      if (error || !data?.item) throw new Error("Settings fetch failed");
      return data.item;
    },
    save: async settings => {
      const { error } = await useUserApi().user.setSettings(settings);
      if (error) throw new Error("Settings save failed");
    },
  });
  watch(results, () => sync.changed(), { deep: true, flush: "sync" });
  // The cookie is a boolean, not an account identity. Wait for /self and watch its ID.
  watch(() => auth.token ? auth.user?.id ?? null : null, id => sync.setAccount(id), { immediate: true, flush: "sync" });
  onServerEvent(ServerEvent.UserMutation, () => sync.refresh());
}

export function useViewPreferences(): Ref<LocationViewPreferences> {
  return results as unknown as Ref<LocationViewPreferences>;
}
