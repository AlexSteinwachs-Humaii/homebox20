<script setup lang="ts">
  import type { EntityOut } from "~/lib/api/types/data-contracts";
  import BaseCard from "~/components/Base/Card.vue";
  import LabelMaker from "~/components/global/LabelMaker.vue";

  defineProps<{ item: EntityOut }>();
</script>

<template>
  <BaseCard class="bg-card" data-testid="item-label">
    <template #title>{{ $t("items.label_tab") }}</template>
    <div class="border-t p-6">
      <LabelMaker v-if="item.assetId" :id="item.assetId" type="asset" />
      <LabelMaker v-else :id="item.id" type="item" />
    </div>
  </BaseCard>
</template>
