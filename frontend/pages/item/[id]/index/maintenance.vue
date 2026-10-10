<script setup lang="ts">
  import type { EntityOut } from "~~/lib/api/types/data-contracts";
  import MaintenanceListView from "~/components/Maintenance/ListView.vue";

  const props = defineProps<{
    item: EntityOut;
  }>();
</script>

<template>
  <section class="rounded-xl border bg-card p-6" data-testid="item-care">
    <h2 class="mb-6 text-lg font-semibold">{{ $t("care.title") }} · {{ props.item.name }}</h2>
    <MaintenanceListView :key="props.item.id" :current-item-id="props.item.id" />
  </section>
</template>
