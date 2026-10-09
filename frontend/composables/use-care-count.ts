import { computed } from "vue";
import { useUserApi } from "./use-api";
import { useAuthContext } from "./use-auth-context";
import { useViewPreferences } from "./use-preferences";
import { onServerEvent, ServerEvent } from "./use-server-events";

/** Shared Care query for the rail, Care and Today. Never recount item reasons here. */
export function useCareCount() {
  const prefs = useViewPreferences();
  const auth = useAuthContext();
  const groupId = computed(() => prefs.value.collectionId || auth.user?.defaultGroupId || "");
  const key = () => `care:${auth.user?.id || ""}:${groupId.value}`;
  const { data, refresh, pending, error } = useAsyncData(key, async () => {
    const requestedGroup = groupId.value;
    // Build the client at request time: X-Tenant must follow collection switches.
    const result = await useUserApi().maintenance.getCare();
    if (result.error) throw new Error("Could not load Care queue");
    return { groupId: requestedGroup, queue: result.data };
  });
  // Never show an outgoing collection's count while the next request is pending.
  const queue = computed(() => (data.value?.groupId === groupId.value ? data.value.queue : null));
  const count = computed(() => queue.value?.count ?? 0);
  const needsYou = computed(() => queue.value?.needsYou ?? []);
  const comingUp = computed(() => queue.value?.comingUp ?? []);
  onServerEvent(ServerEvent.EntityMutation, () => void refresh());
  onServerEvent(ServerEvent.ImportMutation, () => void refresh());
  return { queue, count, needsYou, comingUp, refresh, pending, error };
}
