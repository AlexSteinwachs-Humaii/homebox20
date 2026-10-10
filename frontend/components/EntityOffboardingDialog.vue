<script setup lang="ts">
  import { useI18n } from "vue-i18n";
  import { DialogRoot as Dialog } from "reka-ui";
  import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
  import { Button } from "@/components/ui/button";
  import { toast } from "@/components/ui/sonner";
  import { useLocationStore } from "~/stores/locations";
  import { useTagStore } from "~/stores/tags";
  import type { EntityOut, OffboardingPreview } from "~/lib/api/types/data-contracts";
  import { calendarDate, dispositions, needsRecipient, salePrefill, type Disposition } from "~/lib/offboarding";

  const props = defineProps<{ entity: EntityOut; initialDisposition?: Disposition }>();
  const open = defineModel<boolean>("open", { required: true });
  const { t } = useI18n();
  const api = useUserApi();
  const locations = useLocationStore();
  const tags = useTagStore();
  const disposition = ref<Disposition>("destroyed");
  const date = ref("");
  const notes = ref("");
  const recipient = ref("");
  const value = ref("");
  const preview = ref<OffboardingPreview>();
  const busy = ref(false);
  const loading = ref(false);
  const reviewing = ref(false);
  const error = ref("");
  const form = ref<HTMLFormElement>();
  let generation = 0;

  function prefillSale() {
    const prefill = salePrefill(props.entity, calendarDate(new Date(), ""));
    recipient.value = prefill.recipient;
    date.value = prefill.date;
    value.value = prefill.value;
    notes.value = prefill.notes;
  }

  watch(disposition, selected => {
    reviewing.value = false;
    if (selected === "sold") prefillSale();
  });

  async function loadPreview() {
    const current = ++generation;
    loading.value = true;
    preview.value = undefined;
    try {
      const result = await api.items.previewOffboarding(props.entity.id);
      if (current !== generation || !open.value) return;
      if (result.error) {
        error.value = t(result.status === 404 ? "offboarding.unavailable" : "offboarding.preview_error");
      } else {
        preview.value = result.data;
      }
    } catch {
      if (current === generation) error.value = t("offboarding.preview_error");
    } finally {
      if (current === generation) loading.value = false;
    }
  }

  watch(
    open,
    async shown => {
      if (!shown) {
        generation++;
        return;
      }
      disposition.value = props.initialDisposition ?? "destroyed";
      date.value = calendarDate(new Date(), "");
      notes.value = "";
      recipient.value = "";
      value.value = "";
      error.value = "";
      reviewing.value = false;
      if (disposition.value === "sold") prefillSale();
      await loadPreview();
    },
    { immediate: true }
  );

  function changeOpen(shown: boolean) {
    if (!busy.value) open.value = shown;
  }

  function review() {
    if (busy.value || !preview.value || !form.value?.reportValidity()) return;
    error.value = "";
    reviewing.value = true;
  }

  async function complete() {
    if (busy.value || !reviewing.value || !preview.value) return;
    busy.value = true;
    error.value = "";
    try {
      const result = await api.items.offboard(props.entity.id, {
        confirmation: preview.value.confirmation,
        disposition: disposition.value,
        date: date.value,
        notes: notes.value,
        recipient: needsRecipient(disposition.value) ? recipient.value.trim() : "",
        ...(value.value !== "" ? { value: Number(value.value) } : {}),
      });
      if (result.error) {
        if (result.status === 409) {
          reviewing.value = false;
          error.value = t("offboarding.changed");
          await loadPreview();
        } else {
          error.value = t(result.status === 404 ? "offboarding.unavailable" : "offboarding.submit_error");
        }
        return;
      }
      const destination = props.entity.entityType?.isLocation ? "/locations" : "/home";
      open.value = false;
      // Invalidate before navigation; pages refetch inventory/counts and stores cannot keep removed places or tag counts.
      clearNuxtData();
      locations.$reset();
      tags.$reset();
      toast.success(t("offboarding.success", { count: result.data.completed }));
      await navigateTo(destination);
    } catch {
      error.value = t("offboarding.submit_error");
    } finally {
      busy.value = false;
    }
  }
</script>

<template>
  <Dialog :open="open" @update:open="changeOpen">
    <DialogContent
      class="max-h-[90dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto [overflow-wrap:anywhere]"
      :disable-close="busy"
      @escape-key-down="busy && $event.preventDefault()"
      @interact-outside="busy && $event.preventDefault()"
    >
      <DialogHeader>
        <DialogTitle>{{ t("offboarding.title") }}</DialogTitle>
        <DialogDescription>{{ t("offboarding.description") }}</DialogDescription>
      </DialogHeader>
      <p v-if="loading" role="status">{{ t("offboarding.loading") }}</p>
      <p v-if="error" role="alert" class="text-destructive">{{ error }}</p>
      <Button v-if="!preview && !loading" variant="outline" @click="loadPreview">{{ t("offboarding.retry") }}</Button>
      <form v-if="!reviewing" ref="form" class="space-y-4" @submit.prevent="review">
        <fieldset :disabled="busy" class="space-y-4">
          <div>
            <label for="offboarding-disposition" class="mb-1 block">{{ t("offboarding.outcome") }}</label>
            <select
              id="offboarding-disposition"
              v-model="disposition"
              class="w-full rounded-md border bg-background p-2"
            >
              <option v-for="option in dispositions" :key="option" :value="option">
                {{ t(`offboarding.outcomes.${option}`) }}
              </option>
            </select>
          </div>
          <div>
            <label for="offboarding-date" class="mb-1 block">{{ t("offboarding.date") }}</label>
            <input
              id="offboarding-date"
              v-model="date"
              type="date"
              required
              min="0001-01-01"
              max="9999-12-31"
              class="w-full rounded-md border bg-background p-2"
            />
          </div>
          <div v-if="needsRecipient(disposition)">
            <label for="offboarding-recipient" class="mb-1 block">{{ t("offboarding.recipient") }}</label>
            <input
              id="offboarding-recipient"
              v-model="recipient"
              required
              pattern=".*\S.*"
              maxlength="1000"
              class="w-full rounded-md border bg-background p-2"
            />
          </div>
          <div>
            <label for="offboarding-value" class="mb-1 block">{{ t("offboarding.value") }}</label>
            <input
              id="offboarding-value"
              v-model="value"
              type="number"
              min="0"
              step="any"
              class="w-full rounded-md border bg-background p-2"
            />
          </div>
          <div>
            <label for="offboarding-notes" class="mb-1 block">{{ t("offboarding.notes") }}</label>
            <textarea
              id="offboarding-notes"
              v-model="notes"
              maxlength="10000"
              rows="3"
              class="w-full rounded-md border bg-background p-2"
            />
          </div>
        </fieldset>
        <p v-if="preview">{{ t("offboarding.confirm_tree", { name: entity.name, count: preview.descendantCount }) }}</p>
        <div class="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" :disabled="busy" @click="changeOpen(false)">{{
            t("global.cancel")
          }}</Button>
          <Button type="submit" :disabled="!preview || loading || busy">{{ t("offboarding.review") }}</Button>
        </div>
      </form>
      <div v-else class="min-w-0 space-y-4">
        <p>{{ t("offboarding.confirm_tree", { name: entity.name, count: preview?.descendantCount }) }}</p>
        <p class="whitespace-pre-wrap break-words">
          {{ t(`offboarding.outcomes.${disposition}`) }} · {{ date }}<br />{{
            needsRecipient(disposition) ? recipient : ""
          }}<br />{{ value }}<br />{{ notes }}
        </p>
        <p>{{ t("offboarding.retained") }}</p>
        <div class="flex flex-wrap justify-end gap-2">
          <Button variant="outline" :disabled="busy" @click="changeOpen(false)">{{ t("global.cancel") }}</Button>
          <Button variant="outline" :disabled="busy" @click="reviewing = false">{{ t("offboarding.back") }}</Button>
          <Button variant="destructive" :disabled="busy" @click="complete">{{
            t(busy ? "offboarding.submitting" : "offboarding.confirm")
          }}</Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
