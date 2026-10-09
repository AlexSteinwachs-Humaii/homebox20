<script setup lang="ts">
  import { useI18n } from "vue-i18n";
  import BaseContainer from "@/components/Base/Container.vue";
  import { Button } from "@/components/ui/button";
  import CareRow from "@/components/Maintenance/CareRow.vue";
  import MdiRefresh from "~icons/mdi/refresh";

  const { t } = useI18n();
  const { count, needsYou, comingUp, queue, pending, error, refresh } = useCareCount();

  definePageMeta({ middleware: ["auth"] });
  useHead({ title: () => "HomeBox | " + t("care.title") });
</script>

<template>
  <BaseContainer class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-4xl font-semibold">{{ t("care.title") }}</h1>
        <p class="mt-2 text-muted-foreground">{{ t("care.subtitle") }}</p>
      </div>
      <p v-if="queue && count > 0" data-testid="care-page-count" class="font-semibold text-warning">
        {{ t("care.count", { count }) }}
      </p>
    </header>

    <div v-if="error" role="alert" class="space-y-3 rounded-xl border bg-card p-5">
      <p>{{ t("care.load_failed") }}</p>
      <Button variant="outline" @click="refresh()"><MdiRefresh />{{ t("care.retry") }}</Button>
    </div>
    <p v-else-if="pending && !queue" role="status" class="text-muted-foreground">{{ t("global.loading") }}</p>
    <template v-else-if="queue">
      <section aria-labelledby="needs-you-heading" class="space-y-3">
        <h2 id="needs-you-heading" class="text-sm font-semibold uppercase tracking-widest">
          {{ t("care.needs_you") }}
        </h2>
        <p v-if="!needsYou.length" role="status" class="rounded-xl border bg-card p-5 text-muted-foreground">
          {{ t("care.empty") }}
        </p>
        <CareRow v-for="row in needsYou" :key="`${row.kind}:${row.maintenanceId || row.itemId}`" :row="row" />
      </section>
      <section v-if="comingUp.length" aria-labelledby="coming-up-heading" class="space-y-3 text-muted-foreground">
        <h2 id="coming-up-heading" class="text-sm font-semibold uppercase tracking-widest">
          {{ t("care.coming_up") }}
        </h2>
        <CareRow v-for="row in comingUp" :key="row.maintenanceId || row.itemId" :row="row" />
      </section>
      <p class="text-sm text-muted-foreground">{{ t("care.footer") }}</p>
    </template>
  </BaseContainer>
</template>
