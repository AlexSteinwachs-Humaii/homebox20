<script setup lang="ts">
  import type { EntitySummary } from "~~/lib/api/types/data-contracts";
  import Currency from "@/components/global/Currency.vue";
  import MdiImageOutline from "~icons/mdi/image-outline";
  import MdiArrowRight from "~icons/mdi/arrow-right";

  const props = defineProps<{ item: EntitySummary; locationFlatTree?: FlatTreeItem[] }>();
  const api = useUserApi();
  const failed = ref(false);
  const imageUrl = computed(() => {
    const attachmentId = props.item.thumbnailId || props.item.imageId;
    return attachmentId ? api.authURL(`/entities/${props.item.id}/attachments/${attachmentId}`) : null;
  });
  watch(imageUrl, () => (failed.value = false));
  const placePath = computed(
    () => props.locationFlatTree?.find(l => l.id === props.item.parent?.id)?.treeString || props.item.parent?.name
  );
</script>

<template>
  <li
    class="flex overflow-hidden rounded-xl border bg-card"
    :class="item.archived ? 'text-muted-foreground' : 'text-card-foreground'"
    :data-archived="item.archived"
    data-thing-row
  >
    <div class="relative flex min-h-40 w-24 shrink-0 items-center justify-center bg-muted sm:w-44 lg:w-56">
      <img
        v-if="imageUrl && !failed"
        :src="imageUrl"
        :alt="item.name"
        loading="lazy"
        class="absolute inset-0 size-full object-cover"
        :class="{ 'opacity-60': item.archived }"
        @error="failed = true"
      />
      <MdiImageOutline v-else aria-hidden="true" class="size-8 text-muted-foreground" />
    </div>
    <div class="flex min-w-0 grow flex-wrap gap-3 p-4 sm:p-5">
      <div class="min-w-0 flex-1 space-y-2">
        <p
          class="text-xs font-semibold uppercase tracking-widest"
          :class="item.archived ? 'text-warning' : 'text-primary'"
        >
          {{ item.archived ? $t("global.archived") : item.parent?.name || $t("home.no_place") }}
        </p>
        <h2 class="break-words text-lg font-semibold sm:text-xl">{{ item.name }}</h2>
        <p class="break-words text-sm text-muted-foreground">
          {{ placePath || $t("home.no_place") }} · {{ $t("global.quantity") }}: {{ item.quantity }} · {{ item.assetId }}
        </p>
        <ul v-if="item.tags?.length" class="flex flex-wrap gap-1.5" :aria-label="$t('global.tags')">
          <li v-for="tag in item.tags" :key="tag.id" class="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
            {{ tag.name }}
          </li>
        </ul>
      </div>
      <div class="flex w-full items-center justify-between gap-3 sm:w-auto sm:flex-col sm:items-end">
        <p class="text-xl font-semibold" :class="item.archived ? 'text-muted-foreground' : 'text-primary'">
          <Currency :amount="item.purchasePrice" />
        </p>
        <NuxtLink
          :to="`/item/${item.id}`"
          class="inline-flex min-h-11 items-center gap-2 rounded-md px-1 text-sm font-semibold hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          :class="item.archived ? 'text-muted-foreground' : 'text-primary'"
          :aria-label="$t('items.open_thing', { name: item.name })"
        >
          {{ $t("items.open") }} <MdiArrowRight aria-hidden="true" />
        </NuxtLink>
      </div>
    </div>
  </li>
</template>
