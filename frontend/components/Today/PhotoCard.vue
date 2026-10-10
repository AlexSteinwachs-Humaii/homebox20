<script setup lang="ts">
  import { computed, ref, watch } from "vue";
  import { useUserApi } from "@/composables/use-api";
  import type { EntitySummary } from "~~/lib/api/types/data-contracts";
  import Currency from "@/components/global/Currency.vue";
  import MdiImageOutline from "~icons/mdi/image-outline";

  const props = defineProps<{ entity: EntitySummary; place?: boolean; value?: number }>();
  const api = useUserApi();
  const failed = ref(false);
  const imageUrl = computed(() => {
    const attachmentId = props.entity.thumbnailId || props.entity.imageId;
    return attachmentId ? api.authURL(`/entities/${props.entity.id}/attachments/${attachmentId}`) : null;
  });
  watch(imageUrl, () => (failed.value = false));
</script>

<template>
  <NuxtLink
    :to="`/${place ? 'location' : 'item'}/${entity.id}`"
    class="block overflow-hidden rounded-xl border bg-card hover:border-primary"
  >
    <div class="flex h-28 items-center justify-center bg-muted">
      <img
        v-if="imageUrl && !failed"
        :src="imageUrl"
        alt=""
        loading="lazy"
        class="size-full object-cover"
        @error="failed = true"
      />
      <MdiImageOutline v-else aria-hidden="true" class="size-8 text-muted-foreground" />
    </div>
    <div class="space-y-1 p-3">
      <h3 class="truncate font-semibold">{{ entity.name }}</h3>
      <p v-if="place" class="text-sm text-muted-foreground">
        {{ $t("home.place_items", { count: entity.itemCount }) }} · <Currency :amount="value ?? 0" />
      </p>
      <template v-else>
        <p class="truncate text-sm text-muted-foreground">{{ entity.parent?.name || $t("home.no_place") }}</p>
        <p class="font-semibold text-primary"><Currency :amount="entity.purchasePrice" /></p>
      </template>
    </div>
  </NuxtLink>
</template>
