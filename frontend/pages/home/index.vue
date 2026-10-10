<script setup lang="ts">
  import { useI18n } from "vue-i18n";
  import BaseContainer from "@/components/Base/Container.vue";
  import CareRow from "@/components/Maintenance/CareRow.vue";
  import Currency from "~/components/global/Currency.vue";
  import DateTime from "~/components/global/DateTime.vue";
  import { Button } from "@/components/ui/button";
  import MdiRefresh from "~icons/mdi/refresh";

  const { t } = useI18n();
  definePageMeta({ middleware: ["auth"] });
  useHead({ title: () => "HomeBox | " + t("menu.today") });

  const { selectedCollection } = useCollections();
  const collectionName = computed(() => selectedCollection.value?.name || t("menu.collection"));
  const { count, needsYou, queue, pending: carePending, error: careError, refresh: refreshCare } = useCareCount();
  const { summary, pending, error, refresh } = useTodaySummary();
</script>

<template>
  <BaseContainer class="space-y-6">
    <header>
      <h1 class="text-4xl font-semibold">{{ collectionName }}</h1>
      <p v-if="summary?.updatedAt" class="mt-2 text-muted-foreground">
        {{ t("home.updated") }} <DateTime :date="summary.updatedAt" format="relative" />
      </p>
    </header>

    <section aria-labelledby="today-needs-you" class="space-y-3">
      <h2 id="today-needs-you" class="text-right">
        <NuxtLink v-if="queue" to="/maintenance" class="font-semibold text-warning hover:underline">
          {{ t("care.count", { count }) }}
        </NuxtLink>
      </h2>
      <div v-if="careError" role="alert" class="space-y-3 rounded-xl border bg-card p-5">
        <p>{{ t("care.load_failed") }}</p>
        <Button variant="outline" @click="refreshCare()"><MdiRefresh />{{ t("care.retry") }}</Button>
      </div>
      <p v-else-if="carePending && !queue" role="status" class="text-muted-foreground">
        {{ t("global.loading") }}
      </p>
      <div v-else-if="needsYou.length" class="grid gap-3 md:grid-cols-3">
        <CareRow
          v-for="row in needsYou.slice(0, 3)"
          :key="`${row.kind}:${row.maintenanceId || row.itemId}`"
          :row="row"
          compact
          @updated="refreshCare()"
        />
      </div>
      <p v-else-if="queue" role="status" class="text-muted-foreground">{{ t("care.empty") }}</p>
    </section>

    <div v-if="error" role="alert" class="space-y-3 rounded-xl border bg-card p-5">
      <p>{{ t("home.load_failed") }}</p>
      <Button variant="outline" @click="refresh()"><MdiRefresh />{{ t("care.retry") }}</Button>
    </div>
    <p v-else-if="pending && !summary" role="status" class="text-muted-foreground">{{ t("global.loading") }}</p>
    <section
      v-else-if="summary"
      :aria-label="t('home.collection_counts')"
      class="grid grid-cols-2 gap-3 md:grid-cols-4"
    >
      <NuxtLink to="/items" class="rounded-xl border bg-card p-4 hover:border-primary">
        <span class="block text-3xl font-semibold text-primary"
          ><Currency :amount="summary.statistics.totalItemPrice"
        /></span>
        <span class="mt-1 block text-sm text-muted-foreground">{{ t("home.total_value") }}</span>
      </NuxtLink>
      <NuxtLink to="/items" class="rounded-xl border bg-card p-4 hover:border-primary">
        <span class="block text-3xl font-semibold text-primary">{{ summary.statistics.totalItems }}</span>
        <span class="mt-1 block text-sm text-muted-foreground">{{ t("home.items") }}</span>
      </NuxtLink>
      <NuxtLink to="/locations" class="rounded-xl border bg-card p-4 hover:border-primary">
        <span class="block text-3xl font-semibold text-primary">{{ summary.statistics.totalLocations }}</span>
        <span class="mt-1 block text-sm text-muted-foreground">{{ t("home.places") }}</span>
      </NuxtLink>
      <NuxtLink to="/items?onlyWithoutPhoto=true" class="rounded-xl border bg-card p-4 hover:border-primary">
        <span class="block text-3xl font-semibold text-primary">{{ summary.withoutPhoto }}</span>
        <span class="mt-1 block text-sm text-muted-foreground">{{ t("home.need_photo") }}</span>
      </NuxtLink>
    </section>
  </BaseContainer>
</template>
