import { computed } from "vue";
import { useUserApi } from "./use-api";
import { useAuthContext } from "./use-auth-context";
import { useViewPreferences } from "./use-preferences";
import { onServerEvent, ServerEvent } from "./use-server-events";

/** Collection-scoped summary; Care remains the sole owner of the needs-you queue. */
export function useTodaySummary() {
  const prefs = useViewPreferences();
  const auth = useAuthContext();
  const groupId = computed(() => prefs.value.collectionId || auth.user?.defaultGroupId || "");
  const { data, refresh, pending, error } = useAsyncData(
    () => `today:${auth.user?.id || ""}:${groupId.value}`,
    async () => {
      const requestedGroup = groupId.value;
      const api = useUserApi();
      const [statistics, latest, withoutPhoto] = await Promise.all([
        api.stats.group(),
        api.items.getAll({ orderBy: "updatedAt", page: 1, pageSize: 1 }),
        api.items.getAll({ onlyWithoutPhoto: true, page: 1, pageSize: 1 }),
      ]);
      if (statistics.error || latest.error || withoutPhoto.error) throw new Error("Could not load Today summary");
      return {
        groupId: requestedGroup,
        statistics: statistics.data,
        updatedAt: latest.data.items[0]?.updatedAt,
        withoutPhoto: withoutPhoto.data.total,
      };
    }
  );
  const summary = computed(() => (data.value?.groupId === groupId.value ? data.value : null));
  onServerEvent(ServerEvent.EntityMutation, () => void refresh());
  onServerEvent(ServerEvent.ImportMutation, () => void refresh());
  return { summary, refresh, pending, error };
}
