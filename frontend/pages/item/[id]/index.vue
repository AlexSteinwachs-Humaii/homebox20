<script setup lang="ts">
  import { useI18n } from "vue-i18n";
  import { toast } from "@/components/ui/sonner";
  import type { AnyDetail, Details } from "~~/components/global/DetailsSection/types";
  import { filterZeroValues } from "~~/components/global/DetailsSection/types";
  import { differenceInCalendarDays } from "date-fns";
  import { parseDateOnly, toDateOnlyString } from "~/lib/datelib/dateOnly";
  import MdiClockOutline from "~icons/mdi/clock-outline";
  import MdiPencil from "~icons/mdi/pencil";
  import MdiPackageVariant from "~icons/mdi/package-variant";
  import MdiPlus from "~icons/mdi/plus";
  import MdiMinus from "~icons/mdi/minus";
  import MdiDelete from "~icons/mdi/delete";
  import MdiPlusBoxMultipleOutline from "~icons/mdi/plus-box-multiple-outline";
  import MdiContentSaveEdit from "~icons/mdi/content-save-edit";
  import MdiDotsVertical from "~icons/mdi/dots-vertical";
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
  } from "@/components/ui/dropdown-menu";
  import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbSeparator,
  } from "@/components/ui/breadcrumb";
  import { Button, ButtonGroup } from "@/components/ui/button";
  import { useDialog } from "@/components/ui/dialog-provider";
  import { Label } from "@/components/ui/label";
  import { Switch } from "@/components/ui/switch";
  import { Card } from "@/components/ui/card";
  import { DialogID } from "~/components/ui/dialog-provider/utils";
  import BaseContainer from "@/components/Base/Container.vue";
  import ItemImageDialog from "~/components/Item/ImageDialog.vue";
  import ItemDuplicateSettings from "~/components/Item/DuplicateSettings.vue";
  import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
  import TagChip from "~/components/Tag/Chip.vue";
  import DateTime from "~/components/global/DateTime.vue";
  import LabelMaker from "~/components/global/LabelMaker.vue";
  import Markdown from "~/components/global/Markdown.vue";
  import BaseCard from "@/components/Base/Card.vue";
  import CopyText from "@/components/global/CopyText.vue";
  import DetailsSection from "~/components/global/DetailsSection/DetailsSection.vue";
  import ItemViewSelectable from "~/components/Item/View/Selectable.vue";

  const { t } = useI18n();

  const { openDialog, closeDialog } = useDialog();

  definePageMeta({
    middleware: ["auth"],
  });

  const route = useRoute();
  const api = useUserApi();

  const itemId = computed<string>(() => route.params.id as string);
  const preferences = useViewPreferences();
  const { selectedCollection } = useCollections();

  const temporaryDuplicateSettings = ref<DuplicateSettings>({
    copyMaintenance: preferences.value.duplicateSettings.copyMaintenance,
    copyAttachments: preferences.value.duplicateSettings.copyAttachments,
    copyCustomFields: preferences.value.duplicateSettings.copyCustomFields,
    copyPrefixOverride: preferences.value.duplicateSettings.copyPrefixOverride,
  });

  const hasNested = computed<boolean>(() => {
    return route.fullPath.split("/").at(-1) !== itemId.value;
  });

  const { data: item, refresh } = useAsyncData(itemId.value, async () => {
    const { data, error } = await api.items.get(itemId.value);
    if (error) {
      toast.error(t("items.toast.failed_load_item"));
      navigateTo("/home");
      return;
    }
    return data;
  });
  onMounted(() => {
    refresh();
  });

  const lastRoute = ref(route.fullPath);
  watchEffect(() => {
    if (lastRoute.value.endsWith("edit")) {
      refresh();
    }

    lastRoute.value = route.fullPath;
  });

  async function adjustQuantity(amount: number) {
    if (!item.value) {
      return;
    }

    const newQuantity = item.value.quantity + amount;
    if (newQuantity < 0) {
      toast.error(t("items.toast.quantity_cannot_negative"));
      return;
    }

    const resp = await api.items.patch(item.value.id, {
      id: item.value.id,
      quantity: newQuantity,
    });

    if (resp.error) {
      toast.error(t("items.toast.failed_adjust_quantity"));
      return;
    }

    if (resp.data) {
      item.value = resp.data;
    }
  }

  type Photo = {
    thumbnailSrc?: string;
    originalSrc: string;
    attachmentId: string;
    originalType?: string;
  };

  const itemTags = computed(() => {
    return useTagStore().withAncestors(item.value?.tags || []);
  });

  const photos = computed<Photo[]>(() => {
    if (!item.value) {
      return [];
    }
    return (
      item.value.attachments.reduce((acc, cur) => {
        if (cur.type === "photo") {
          const photo: Photo = {
            originalSrc: api.authURL(`/entities/${item.value!.id}/attachments/${cur.id}`),
            originalType: cur.mimeType,
            attachmentId: cur.id,
          };
          if (cur.thumbnail) {
            photo.thumbnailSrc = api.authURL(`/entities/${item.value!.id}/attachments/${cur.thumbnail.id}`);
          } else {
            photo.thumbnailSrc = photo.originalSrc; // fallback to itself if no thumbnail
          }
          acc.push(photo);
        }
        return acc;
      }, [] as Photo[]) || []
    );
  });

  // Prefer the designated cover photo, retaining the existing gallery order.
  const primaryPhoto = computed(() => {
    return photos.value.find(photo => photo.attachmentId === item.value?.imageId) || photos.value[0];
  });
  const photoCaption = computed(() => {
    const attachment = item.value?.attachments.find(photo => photo.id === primaryPhoto.value?.attachmentId);
    return attachment?.title || item.value?.description || "";
  });
  const placePath = computed(() => (fullpath.value || []).filter(part => part.id !== item.value?.id));

  const warrantyDays = computed(() => {
    if (item.value?.lifetimeWarranty) return null;
    const end = parseDateOnly(toDateOnlyString(item.value?.warrantyExpires));
    if (!end) return null;
    const days = differenceInCalendarDays(end, new Date());
    return days > 0 && days <= 30 ? days : null;
  });

  const assetID = computed<Details>(() => {
    if (!item.value) {
      return [];
    }

    if (item.value?.assetId === "000-000") {
      return [];
    }

    return [
      {
        name: "items.asset_id",
        text: item.value?.assetId,
      },
    ];
  });

  const itemDetails = computed<Details>(() => {
    if (!item.value) {
      return [];
    }

    const ret: Details = [
      {
        name: "items.quantity",
        text: item.value?.quantity,
        slot: "quantity",
      },
      {
        name: "items.purchase_price",
        text: String(item.value.purchasePrice ?? 0),
        type: "currency",
      },
      {
        name: "items.insured",
        text: item.value?.insured ? "Yes" : "No",
      },
      {
        name: "items.serial_number",
        text: item.value.serialNumber || "—",
        copyable: true,
      },
      {
        name: "items.purchase_date",
        text: item.value.purchaseDate || "",
        type: "date",
        date: true,
        slot: "purchased",
      },
      {
        name: "items.model_number",
        text: item.value.modelNumber || "",
        copyable: true,
      },
      {
        name: "items.manufacturer",
        text: item.value.manufacturer || "",
        copyable: true,
      },
      {
        name: "items.archived",
        text: item.value?.archived ? "Yes" : "No",
      },
      ...assetID.value,
      ...item.value.fields.map(field => {
        /**
         * Support Special URL Syntax
         */
        const url = maybeUrl(field.textValue);
        if (url.isUrl) {
          return {
            type: "link",
            name: field.name,
            text: url.text,
            href: url.url,
          } as AnyDetail;
        }

        return {
          name: field.name,
          text: field.textValue,
        };
      }),
    ];

    if (!preferences.value.showEmpty) {
      return ret.filter(
        detail =>
          [
            "items.quantity",
            "items.purchase_price",
            "items.insured",
            "items.serial_number",
            "items.purchase_date",
          ].includes(detail.name) || filterZeroValues([detail]).length > 0
      );
    }

    return ret;
  });

  const showWarranty = computed(() => {
    if (preferences.value.showEmpty) {
      return true;
    }
    return item.value?.lifetimeWarranty || validDate(item.value?.warrantyExpires);
  });

  const warrantyDetails = computed(() => {
    const details: Details = [
      {
        name: "items.lifetime_warranty",
        text: item.value?.lifetimeWarranty ? "Yes" : "No",
      },
    ];

    if (item.value?.lifetimeWarranty) {
      details.push({
        name: "items.warranty_expires",
        text: "N/A",
      });
    } else {
      details.push({
        name: "items.warranty_expires",
        text: item.value?.warrantyExpires || "",
        type: "date",
        date: true,
      });
    }

    details.push({
      name: "items.warranty_details",
      type: "markdown",
      text: item.value?.warrantyDetails || "",
    });

    if (!preferences.value.showEmpty) {
      return filterZeroValues(details);
    }

    return details;
  });

  const showPurchase = computed(() => {
    if (preferences.value.showEmpty) {
      return true;
    }
    return item.value?.purchaseFrom || item.value?.purchasePrice !== 0 || validDate(item.value?.purchaseDate);
  });

  const purchaseDetails = computed<Details>(() => {
    const v: Details = [
      {
        name: "items.purchased_from",
        text: item.value?.purchaseFrom || "",
      },
      {
        name: "items.purchase_price",
        text: String(item.value?.purchasePrice) || "",
        type: "currency",
      },
      {
        name: "items.purchase_date",
        text: item.value?.purchaseDate || "",
        type: "date",
        date: true,
      },
    ];

    if (!preferences.value.showEmpty) {
      return filterZeroValues(v);
    }

    return v;
  });

  const showSold = computed(() => {
    if (preferences.value.showEmpty) {
      return true;
    }
    return item.value?.soldTo || item.value?.soldPrice !== 0 || validDate(item.value?.soldDate);
  });

  const soldDetails = computed<Details>(() => {
    const v: Details = [
      {
        name: "items.sold_to",
        text: item.value?.soldTo || "",
      },
      {
        name: "items.sold_price",
        text: String(item.value?.soldPrice) || "",
        type: "currency",
      },
      {
        name: "items.sold_at",
        text: item.value?.soldDate || "",
        type: "date",
        date: true,
      },
    ];

    if (!preferences.value.showEmpty) {
      return filterZeroValues(v);
    }

    return v;
  });

  function openImageDialog(img: Photo, itemId: string) {
    openDialog(DialogID.ItemImage, {
      params: {
        type: "preloaded",
        originalSrc: img.originalSrc,
        originalType: img.originalType,
        thumbnailSrc: img.thumbnailSrc,
        attachmentId: img.attachmentId,
        itemId,
      },
      onClose: result => {
        if (result?.action === "delete") {
          item.value!.attachments = item.value!.attachments.filter(a => a.id !== result.id);
        }
      },
    });
  }

  const currentUrl = computed(() => {
    return window.location.href;
  });

  const currentPath = computed(() => {
    return route.path;
  });

  const tabs = computed(() => {
    return [
      {
        id: "details",
        name: "global.details",
        to: `/item/${itemId.value}`,
      },
      {
        id: "log",
        name: "care.title",
        to: `/item/${itemId.value}/maintenance`,
      },
      {
        id: "attachments",
        name: "items.attachments",
        to: `/item/${itemId.value}/attachments`,
      },
      {
        id: "label",
        name: "items.label_tab",
        to: `/item/${itemId.value}/label`,
      },
    ];
  });

  const fullpath = computedAsync(async () => {
    if (!item.value) {
      return [];
    }

    const resp = await api.items.fullpath(item.value.id);
    if (resp.error) {
      toast.error(t("items.toast.failed_load_item"));
      return [];
    }

    return resp.data;
  });

  const { data: items, refresh: refreshItemList } = useAsyncData(
    () => itemId.value + "_item_list",
    async () => {
      if (!itemId.value) {
        return [];
      }

      const resp = await api.items.getAll({
        parentIds: [itemId.value],
      });

      if (resp.error) {
        toast.error(t("items.toast.failed_load_items"));
        return [];
      }

      return resp.data.items;
    },
    {
      watch: [itemId],
    }
  );

  async function duplicateItem(settings?: DuplicateSettings) {
    if (!item.value) {
      return;
    }

    const duplicateSettings = settings
      ? {
          copyMaintenance: settings.copyMaintenance,
          copyAttachments: settings.copyAttachments,
          copyCustomFields: settings.copyCustomFields,
          copyPrefix: settings.copyPrefixOverride ?? t("items.duplicate.prefix"),
        }
      : {
          copyMaintenance: preferences.value.duplicateSettings.copyMaintenance,
          copyAttachments: preferences.value.duplicateSettings.copyAttachments,
          copyCustomFields: preferences.value.duplicateSettings.copyCustomFields,
          copyPrefix: preferences.value.duplicateSettings.copyPrefixOverride ?? t("items.duplicate.prefix"),
        };

    const { error, data } = await api.items.duplicate(itemId.value, duplicateSettings);

    if (error) {
      toast.error(t("items.toast.failed_duplicate_item"));
      return;
    }

    navigateTo(`/item/${data.id}`);
  }

  function handleDuplicateClick(event: MouseEvent) {
    if (event.shiftKey) {
      openDialog(DialogID.DuplicateTemporarySettings);
    } else {
      duplicateItem();
    }
  }

  const confirm = useConfirm();

  async function deleteItem() {
    const confirmed = await confirm.open(t("items.delete_item_confirm"));

    if (!confirmed.data) {
      return;
    }

    const { error } = await api.items.delete(itemId.value);
    if (error) {
      toast.error(t("items.toast.failed_delete_item"));
      return;
    }
    toast.success(t("items.toast.item_deleted"));
    navigateTo("/home");
  }

  async function saveAsTemplate() {
    if (!item.value) {
      return;
    }

    const NIL_UUID = "00000000-0000-0000-0000-000000000000";

    // Create template from item data
    const templateData = {
      name: `Template: ${item.value.name}`,
      description: "",
      notes: "",
      defaultName: item.value.name,
      defaultDescription: item.value.description || "",
      defaultQuantity: item.value.quantity,
      defaultInsured: item.value.insured,
      defaultManufacturer: item.value.manufacturer || "",
      defaultModelNumber: item.value.modelNumber || "",
      defaultLifetimeWarranty: item.value.lifetimeWarranty,
      defaultWarrantyDetails: item.value.warrantyDetails || "",
      defaultLocationId: item.value.location?.id || item.value.parent?.id || "",
      defaultTagIds: item.value.tags?.map(l => l.id) || [],
      includeWarrantyFields: !!(
        item.value.warrantyDetails ||
        item.value.lifetimeWarranty ||
        item.value.warrantyExpires
      ),
      includePurchaseFields: !!(item.value.purchaseFrom || item.value.purchasePrice || item.value.purchaseDate),
      includeSoldFields: !!(item.value.soldTo || item.value.soldPrice || item.value.soldDate),
      fields: item.value.fields.map(field => ({
        id: NIL_UUID,
        name: field.name,
        type: "text",
        textValue: field.textValue || "",
      })),
    };

    const { data, error } = await api.templates.create(templateData);
    if (error) {
      toast.error(t("components.template.toast.create_failed"));
      return;
    }

    toast.success(t("components.template.toast.saved_as_template", { name: templateData.name }));
    navigateTo(`/template/${data.id}`);
  }

  async function createSubitem() {
    openDialog(DialogID.CreateEntity, {
      params: {
        baseType: "item",
        subItem: true,
      },
    });
  }
</script>

<template>
  <BaseContainer v-if="item">
    <!-- set page title -->
    <Title>{{ item.name }}</Title>

    <ItemImageDialog />
    <Dialog :dialog-id="DialogID.DuplicateTemporarySettings">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ $t("items.duplicate.temporary_title") }}</DialogTitle>
        </DialogHeader>
        <ItemDuplicateSettings v-model="temporaryDuplicateSettings" />
        <DialogFooter>
          <Button
            @click="
              closeDialog(DialogID.DuplicateTemporarySettings);
              duplicateItem(temporaryDuplicateSettings);
            "
          >
            {{ $t("global.duplicate") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <section>
      <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" data-testid="item-record-header">
        <Card class="overflow-hidden" data-testid="item-record-photo">
          <template v-if="primaryPhoto">
            <button
              class="block w-full bg-secondary"
              :aria-label="$t('items.photo')"
              @click="openImageDialog(primaryPhoto, item.id)"
            >
              <img class="aspect-[4/5] w-full object-contain" :src="primaryPhoto.originalSrc" :alt="item.name" />
            </button>
            <div class="flex flex-wrap items-center justify-between gap-3 bg-card p-4">
              <Markdown v-if="photoCaption" class="prose min-w-0 flex-1 text-sm" :source="photoCaption" />
              <span class="shrink-0 text-sm font-semibold text-primary" data-testid="item-photo-asset-id">
                {{ $t("items.asset_id") }}: {{ item.assetId }}
              </span>
            </div>
          </template>
          <div v-else class="flex aspect-[4/5] items-center justify-center bg-card text-muted-foreground">
            <MdiPackageVariant class="size-20" :aria-label="item.name" />
          </div>
        </Card>

        <header class="min-w-0 space-y-4">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink as-child class="text-primary hover:underline">
                  <NuxtLink to="/home">{{ selectedCollection?.name || $t("menu.collection") }}</NuxtLink>
                </BreadcrumbLink>
                <BreadcrumbSeparator v-if="placePath.length" />
              </BreadcrumbItem>
              <BreadcrumbItem v-for="(part, idx) in placePath" :key="part.id">
                <BreadcrumbLink as-child class="text-primary hover:underline">
                  <NuxtLink :to="`/${part.type}/${part.id}`">{{ part.name }}</NuxtLink>
                </BreadcrumbLink>
                <BreadcrumbSeparator v-if="idx < placePath.length - 1" />
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <h1 class="break-words text-3xl font-semibold lg:text-4xl">{{ item.name }}</h1>
          <div v-if="!primaryPhoto" class="text-sm font-semibold text-primary" data-testid="item-record-asset-id">
            {{ $t("items.asset_id") }}: {{ item.assetId }}
          </div>
          <div class="flex flex-wrap gap-2">
            <TagChip v-for="tag in itemTags" :key="tag.id" :tag="tag" size="sm" :ancestors="tag.ancestors" />
          </div>
          <div
            v-if="warrantyDays !== null"
            class="flex items-center gap-2 rounded-xl border border-warning/50 bg-card px-4 py-3 text-warning"
            data-testid="item-warranty-warning"
          >
            <MdiClockOutline class="size-4 shrink-0" />
            <strong>{{ $t("items.warranty_ends_in", { days: warrantyDays }) }}</strong>
            <span>· <DateTime :date="item.warrantyExpires" format="long" datetime-type="date" /></span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Button as-child>
              <NuxtLink :to="`/item/${item.id}/edit`"><MdiPencil />{{ $t("global.edit") }}</NuxtLink>
            </Button>
            <Button variant="outline" @click="createSubitem"> <MdiPlus />{{ $t("global.create_subitem") }} </Button>
            <template v-if="currentPath !== `/item/${itemId}/label`">
              <LabelMaker v-if="item.assetId" :id="item.assetId" type="asset" />
              <LabelMaker v-else :id="item.id" type="item" />
            </template>
            <!-- More actions dropdown -->
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="outline" size="icon" :aria-label="$t('global.more_actions')">
                  <MdiDotsVertical class="size-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-48">
                <DropdownMenuItem @click="handleDuplicateClick">
                  <MdiPlusBoxMultipleOutline class="mr-2 size-4" />
                  {{ $t("global.duplicate") }}
                </DropdownMenuItem>
                <DropdownMenuItem @click="saveAsTemplate">
                  <MdiContentSaveEdit class="mr-2 size-4" />
                  {{ $t("components.template.save_as_template") }}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem class="text-destructive focus:text-destructive" @click="deleteItem">
                  <MdiDelete class="mr-2 size-4" />
                  {{ $t("global.delete") }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div v-if="item.description" class="prose max-w-full text-sm">
            <Markdown :source="item.description" />
          </div>
          <div class="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>{{ $t("items.created_at") }} <DateTime :date="item.createdAt" /></span>
            <span>{{ $t("items.updated_at") }} <DateTime :date="item.updatedAt" /></span>
          </div>
        </header>
      </div>

      <div class="mb-6 mt-3 flex flex-wrap items-center justify-between">
        <ButtonGroup role="group" aria-label="Item sections">
          <Button
            v-for="tab in tabs"
            :key="tab.id"
            as-child
            :variant="tab.to === currentPath ? 'default' : 'outline'"
            size="sm"
          >
            <NuxtLink :to="tab.to" :aria-current="tab.to === currentPath ? 'page' : undefined">
              {{ $t(tab.name) }}
            </NuxtLink>
          </Button>
        </ButtonGroup>
      </div>
    </section>

    <section>
      <div class="space-y-6">
        <!-- this renders the other pages content -->
        <NuxtPage :item="item" :page-key="itemId" />

        <!-- anything in this is not rendered if on another page -->
        <BaseCard v-if="!hasNested" class="bg-card" data-testid="item-details">
          <template #title> {{ $t("items.details") }} </template>
          <template #title-actions>
            <div class="mt-2 flex flex-wrap items-center justify-between gap-4">
              <Label class="flex cursor-pointer items-center gap-2">
                <Switch v-model="preferences.showEmpty" />
                {{ $t("items.show_empty") }}
              </Label>
              <div class="space-x-1">
                <CopyText :text="currentUrl" :icon-size="16" />
              </div>
            </div>
          </template>
          <DetailsSection :details="itemDetails">
            <template #quantity="{ detail }">
              <div class="flex items-center">
                {{ detail.text }}
                <span class="my-0 ml-4 inline-flex gap-2">
                  <Button
                    size="icon"
                    variant="outline"
                    class="size-8 rounded-full"
                    :aria-label="$t('items.quantity_decrease')"
                    :disabled="item.quantity === 0"
                    @click="adjustQuantity(-1)"
                  >
                    <MdiMinus class="size-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    class="size-8 rounded-full"
                    :aria-label="$t('items.quantity_increase')"
                    @click="adjustQuantity(1)"
                  >
                    <MdiPlus class="size-3" />
                  </Button>
                </span>
              </div>
            </template>
            <template #purchased>
              <DateTime
                v-if="validDate(item.purchaseDate)"
                :date="item.purchaseDate"
                format="long"
                datetime-type="date"
              />
              <span v-else>—</span>
              <span v-if="item.purchaseFrom"> · {{ item.purchaseFrom }}</span>
            </template>
          </DetailsSection>
          <div v-if="item.notes" class="border-t px-6 py-4" data-testid="item-notes">
            <h3 class="mb-2 text-sm font-medium">{{ $t("items.notes") }}</h3>
            <Markdown :source="item.notes" />
          </div>
        </BaseCard>

        <!-- anything in this is not rendered if on another page -->
        <template v-if="!hasNested">
          <BaseCard v-if="photos && photos.length > 0">
            <template #title> {{ $t("items.photos") }} </template>
            <div class="scroll-bg container mx-auto flex max-h-[500px] flex-wrap gap-2 overflow-y-scroll border-t p-4">
              <button v-for="(img, i) in photos" :key="i" @click="openImageDialog(img, item.id)">
                <img class="max-h-[200px] rounded" :src="img.thumbnailSrc" :alt="$t('items.photo')" loading="lazy" />
              </button>
            </div>
          </BaseCard>

          <BaseCard v-if="showPurchase" collapsable>
            <template #title> {{ $t("items.purchase_details") }} </template>
            <DetailsSection :details="purchaseDetails" />
          </BaseCard>

          <BaseCard v-if="showWarranty" collapsable>
            <template #title> {{ $t("items.warranty_details") }} </template>
            <DetailsSection :details="warrantyDetails" />
          </BaseCard>

          <BaseCard v-if="showSold" collapsable>
            <template #title> {{ $t("items.sold_details") }} </template>
            <DetailsSection :details="soldDetails" />
          </BaseCard>
        </template>
      </div>
    </section>

    <section v-if="items && items.length > 0" class="mt-6">
      <ItemViewSelectable :items="items" @refresh="refreshItemList" />
    </section>
  </BaseContainer>
</template>

<style lang="css" scoped>
  /* Style dialog background */
  dialog::backdrop {
    background: rgba(0, 0, 0, 0.5);
  }
</style>
