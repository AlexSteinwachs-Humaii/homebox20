<script setup lang="ts">
  import { useI18n } from "vue-i18n";
  import { MaintenanceFilterStatus, type CareRow } from "~/lib/api/types/data-contracts";
  import { Button } from "@/components/ui/button";
  import Currency from "~/components/global/Currency.vue";
  import DateTime from "~/components/global/DateTime.vue";
  import MdiCheck from "~icons/mdi/check";
  import MdiEye from "~icons/mdi/eye";
  import MdiCamera from "~icons/mdi/camera";
  import MdiClock from "~icons/mdi/clock-outline";

  import { toast } from "@/components/ui/sonner";
  import { careMaintenanceUpdate } from "~/lib/datelib/careMaintenance";

  const props = defineProps<{ row: CareRow }>();
  const emit = defineEmits<{ updated: [] }>();
  const { t } = useI18n();
  const busy = ref(false);

  async function updateEntry(action: "done" | "snooze") {
    const row = props.row;
    if (busy.value || !row.maintenanceId) return;
    if (action === "snooze" ? row.kind !== "coming_up" : row.kind !== "overdue") return;
    busy.value = true;
    try {
      const api = useUserApi();
      // The queue omits cost. Read the current entry rather than overwrite it
      // with queue display data, and refuse stale completed/overdue snoozes.
      const result = await api.items.maintenance.getLog(row.itemId, {
        status: MaintenanceFilterStatus.MaintenanceFilterStatusBoth,
      });
      if (result.error) throw new Error("Could not read maintenance entry");
      const entry = result.data?.find(entry => entry.id === row.maintenanceId);
      if (!entry) throw new Error("Maintenance entry is no longer available");
      const { error } = await api.maintenance.update(entry.id, careMaintenanceUpdate(entry, action));
      if (error) throw new Error("Could not update maintenance entry");
      emit("updated");
    } catch {
      toast.error(t("maintenance.toast.failed_to_update"));
    } finally {
      busy.value = false;
    }
  }
</script>

<template>
  <article
    :data-care-kind="row.kind"
    class="grid gap-4 rounded-xl border p-5 sm:grid-cols-[9rem_1fr_auto] sm:items-center"
    :class="row.kind === 'coming_up' ? 'bg-background text-muted-foreground' : 'bg-card'"
  >
    <p
      class="text-xs font-semibold uppercase tracking-widest"
      :class="{
        'text-warning': row.kind === 'overdue' || row.kind === 'warranty',
        'text-primary': row.kind === 'missing_photo',
      }"
    >
      <template v-if="row.kind === 'overdue'">{{ t("care.overdue_days", { days: row.daysLate }) }}</template>
      <template v-else-if="row.kind === 'warranty'">{{
        t("care.warranty_days", { days: row.daysRemaining })
      }}</template>
      <template v-else-if="row.kind === 'missing_photo'">{{ t("care.no_photo") }}</template>
      <template v-else-if="!row.daysRemaining">{{ t("care.today") }}</template>
      <template v-else>{{ t("care.in_days", { days: row.daysRemaining }) }}</template>
    </p>
    <div class="min-w-0">
      <h3 class="break-words text-lg font-semibold">{{ row.name || row.itemName }}</h3>
      <p class="mt-1 break-words text-sm text-muted-foreground">
        <span v-if="row.locationPath.length">{{ row.locationPath.map(place => place.name).join(" / ") }}</span>
        <template v-if="row.kind === 'overdue' || row.kind === 'coming_up'">
          <span v-if="row.description"
            ><template v-if="row.locationPath.length"> · </template>{{ row.description }}</span
          >
        </template>
        <template v-else>
          <template v-if="row.locationPath.length"> · </template><Currency :amount="row.purchasePrice" />
          <template v-if="row.kind === 'warranty'">
            · {{ t("care.ends") }} <DateTime :date="row.warrantyExpires" format="human" datetime-type="date" />
          </template>
        </template>
      </p>
    </div>
    <div class="justify-self-end">
      <Button v-if="row.kind === 'overdue'" :disabled="busy" :aria-busy="busy" @click="updateEntry('done')">
        <MdiCheck aria-hidden="true" />{{ t("care.mark_done") }}
      </Button>
      <Button v-else-if="row.kind === 'warranty'" variant="outline" as-child>
        <NuxtLink :to="`/item/${row.itemId}`"><MdiEye aria-hidden="true" />{{ t("care.see_item") }}</NuxtLink>
      </Button>
      <Button v-else-if="row.kind === 'missing_photo'" variant="outline" as-child>
        <NuxtLink :to="`/item/${row.itemId}/edit`"><MdiCamera aria-hidden="true" />{{ t("care.add_photo") }}</NuxtLink>
      </Button>
      <Button
        v-else-if="row.kind === 'coming_up'"
        variant="outline"
        :disabled="busy"
        :aria-busy="busy"
        @click="updateEntry('snooze')"
      >
        <MdiClock aria-hidden="true" />{{ t("care.snooze") }}
      </Button>
    </div>
  </article>
</template>
