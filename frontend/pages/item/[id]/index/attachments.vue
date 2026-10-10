<script setup lang="ts">
  import type { EntityOut } from "~/lib/api/types/data-contracts";
  import BaseCard from "~/components/Base/Card.vue";
  import ItemAttachmentsList from "~/components/Item/AttachmentsList.vue";
  import { Button } from "~/components/ui/button";
  import MdiPencil from "~icons/mdi/pencil";

  defineProps<{ item: EntityOut }>();
</script>

<template>
  <BaseCard class="bg-card" data-testid="item-attachments">
    <template #title>{{ $t("items.attachments") }}</template>
    <template #title-actions>
      <Button as-child variant="outline" size="sm">
        <NuxtLink :to="`/item/${item.id}/edit`"><MdiPencil />{{ $t("global.edit") }}</NuxtLink>
      </Button>
    </template>
    <div class="border-t p-6">
      <ItemAttachmentsList v-if="item.attachments.length" :attachments="item.attachments" :item-id="item.id" />
      <p v-else class="text-muted-foreground">{{ $t("items.no_attachments") }}</p>
    </div>
  </BaseCard>
</template>
