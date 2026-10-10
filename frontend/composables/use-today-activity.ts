import { computed } from "vue";
import { useUserApi } from "./use-api";
import { useAuthContext } from "./use-auth-context";
import { useViewPreferences } from "./use-preferences";
import { onServerEvent, ServerEvent } from "./use-server-events";

/** The same top-level rooms query as the location store, scoped to the active collection. */
export function useTodayActivity() {
  const prefs = useViewPreferences();
  const auth = useAuthContext();
  const groupId = computed(() => prefs.value.collectionId || auth.user?.defaultGroupId || "");
  const { data, refresh, pending, error } = useAsyncData(
    () => `today-activity:${auth.user?.id || ""}:${groupId.value}`,
    async () => {
      const requestedGroup = groupId.value;
      const api = useUserApi();
      const [recent, rooms, values] = await Promise.all([
        // /entities defaults to non-location items.
        api.items.getAll({ orderBy: "updatedAt", page: 1, pageSize: 4 }),
        api.items.getLocations({ filterChildren: true }),
        api.stats.locations(),
      ]);
      if (recent.error || rooms.error || values.error) throw new Error("Could not load Today activity");
      const totals = new Map(values.data.map(value => [value.id, value.total]));
      return {
        groupId: requestedGroup,
        recent: recent.data.items,
        places: rooms.data.map(place => ({ ...place, value: totals.get(place.id) ?? 0 })),
      };
    }
  );
  const activity = computed(() => (data.value?.groupId === groupId.value ? data.value : null));
  onServerEvent(ServerEvent.EntityMutation, () => void refresh());
  onServerEvent(ServerEvent.ImportMutation, () => void refresh());
  return { activity, refresh, pending, error };
}
