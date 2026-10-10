<script setup lang="ts">
  import { useI18n } from "vue-i18n";
  import { toast } from "@/components/ui/sonner";
  import type { AnyDetail, Details } from "~~/components/global/DetailsSection/types";
  import { filterZeroValues } from "~~/components/global/DetailsSection/types";
  import type { ItemAttachment } from "~~/lib/api/types/data-contracts";
  import MdiPlus from "~icons/mdi/plus";
  import MdiMapMarkerOutline from "~icons/mdi/map-marker-outline";
  import type { PlaceVisit } from "~/lib/place-visit";
  import MdiPencil from "~icons/mdi/pencil";
  import MdiDelete from "~icons/mdi/delete";
  import { useDialog } from "@/components/ui/dialog-provider";
  import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbSeparator,
  } from "@/components/ui/breadcrumb";
  import { Button } from "@/components/ui/button";
  import { DialogID } from "~/components/ui/dialog-provider/utils";
  import BaseCard from "@/components/Base/Card.vue";
  import Currency from "~/components/global/Currency.vue";
  import LabelMaker from "~/components/global/LabelMaker.vue";
  import DetailsSection from "~/components/global/DetailsSection/DetailsSection.vue";
  import ItemAttachmentsList from "~/components/Item/AttachmentsList.vue";
  import ItemImageDialog from "~/components/Item/ImageDialog.vue";
  import PhotoCard from "~/components/Today/PhotoCard.vue";
  import NightRow from "~/components/Item/NightRow.vue";
  import MdiArrowRight from "~icons/mdi/arrow-right";
  import TagChip from "~/components/Tag/Chip.vue";

  definePageMeta({
    middleware: ["auth"],
  });

  const { t } = useI18n();

  const { openDialog } = useDialog();

  const route = useRoute();
  const api = useUserApi();
  const preferences = useViewPreferences();

  const locationId = computed<string>(() => route.params.id as string);
  const visit = useState<PlaceVisit>("night-place-visit", () => null);
  const previousPlaceId = computed(() =>
    visit.value?.placeId === locationId.value ? visit.value.previousPlaceId : null
  );

  const { data: location } = useAsyncData(
    () => `place-${locationId.value}`,
    async () => {
      const { data, error } = await api.items.getLocation(locationId.value);
      if (error) {
        toast.error(t("locations.toast.failed_load_location"));
        navigateTo("/home");
        return;
      }

      return data;
    }
  );

  const { selectedCollection } = useCollections();
  // Detail children do not carry counts. Use the existing location summaries and
  // direct purchase-price statistics, never a sum of descendants.
  const { data: roomSummary } = useAsyncData(
    () => `place-summary-${selectedCollection.value?.id || ""}-${locationId.value}`,
    async () => {
      const [summaries, values, group] = await Promise.all([
        api.items.getLocations(),
        api.stats.locations(),
        api.group.get(),
      ]);
      if (summaries.error || values.error) toast.error(t("locations.toast.failed_load_location"));
      return {
        places: summaries.error ? null : summaries.data,
        values: values.error ? null : values.data,
        name: group.error ? null : group.data.name,
      };
    }
  );
  const collectionName = computed(
    () => roomSummary.value?.name || selectedCollection.value?.name || t("menu.collection")
  );
  // itemCount is omitempty, so an empty room arrives without it. Hide the figure only while summaries are still loading.
  const directCount = computed(() => {
    const places = roomSummary.value?.places;
    if (!places) return undefined;
    return places.find(p => p.id === locationId.value)?.itemCount ?? 0;
  });
  const directValue = computed(() => placeValue(locationId.value));
  function placeValue(id: string) {
    if (!roomSummary.value?.values) return undefined;
    return roomSummary.value.values.find(p => p.id === id)?.total ?? 0;
  }
  const childPlaces = computed(() =>
    (location.value?.children || []).map(child => roomSummary.value?.places?.find(p => p.id === child.id) || child)
  );

  const confirm = useConfirm();

  async function confirmDelete() {
    const { isCanceled } = await confirm.open(t("locations.location_items_delete_confirm"));
    if (isCanceled) {
      return;
    }

    const { error } = await api.items.deleteLocation(locationId.value);
    if (error) {
      toast.error(t("locations.toast.failed_delete_location"));
      return;
    }

    toast.success(t("locations.toast.location_deleted"));
    navigateTo("/locations");
  }

  function openCreateItem() {
    openDialog(DialogID.CreateEntity, {
      params: {
        baseType: "item",
      },
    });
  }

  function openCreatePlace() {
    openDialog(DialogID.CreateEntity, {
      params: { baseType: "location" },
    });
  }

  function goToEdit() {
    navigateTo(`/location/${locationId.value}/edit`);
  }

  // Photos
  type Photo = {
    thumbnailSrc?: string;
    originalSrc: string;
    attachmentId: string;
    originalType?: string;
  };

  const photos = computed<Photo[]>(() => {
    if (!location.value?.attachments) {
      return [];
    }
    return location.value.attachments.reduce((acc, cur) => {
      if (cur.type === "photo") {
        const photo: Photo = {
          originalSrc: api.authURL(`/entities/${location.value!.id}/attachments/${cur.id}`),
          originalType: cur.mimeType,
          attachmentId: cur.id,
        };
        if (cur.thumbnail) {
          photo.thumbnailSrc = api.authURL(`/entities/${location.value!.id}/attachments/${cur.thumbnail.id}`);
        } else {
          photo.thumbnailSrc = photo.originalSrc;
        }
        acc.push(photo);
      }
      return acc;
    }, [] as Photo[]);
  });

  function openImageDialog(img: Photo, entityId: string) {
    openDialog(DialogID.ItemImage, {
      params: {
        type: "preloaded",
        originalSrc: img.originalSrc,
        originalType: img.originalType,
        thumbnailSrc: img.thumbnailSrc,
        attachmentId: img.attachmentId,
        itemId: entityId,
      },
      onClose: result => {
        if (result?.action === "delete") {
          location.value!.attachments = location.value!.attachments.filter(a => a.id !== result.id);
        }
      },
    });
  }

  // Attachments (non-photo)
  const nonPhotoAttachments = computed(() => {
    if (!location.value?.attachments) {
      return { attachments: [], warranty: [], manuals: [], receipts: [] };
    }
    return location.value.attachments.reduce(
      (acc, attachment) => {
        if (attachment.type === "photo") return acc;
        if (attachment.type === "warranty") acc.warranty.push(attachment);
        else if (attachment.type === "manual") acc.manuals.push(attachment);
        else if (attachment.type === "receipt") acc.receipts.push(attachment);
        else acc.attachments.push(attachment);
        return acc;
      },
      {
        attachments: [] as ItemAttachment[],
        warranty: [] as ItemAttachment[],
        manuals: [] as ItemAttachment[],
        receipts: [] as ItemAttachment[],
      }
    );
  });

  const hasNonPhotoAttachments = computed(() => {
    const a = nonPhotoAttachments.value;
    return a.attachments.length > 0 || a.warranty.length > 0 || a.manuals.length > 0 || a.receipts.length > 0;
  });

  // Details
  const locationDetails = computed<Details>(() => {
    if (!location.value) {
      return [];
    }

    const ret: Details = [
      {
        name: "items.notes",
        type: "markdown",
        text: location.value.notes,
      },
      ...(location.value.fields || []).map(field => {
        return {
          name: field.name,
          text: field.textValue,
        } as AnyDetail;
      }),
    ];

    if (!preferences.value.showEmpty) {
      return filterZeroValues(ret);
    }

    return ret;
  });

  const { data: items } = useAsyncData(
    () => locationId.value + "_item_list",
    async () => {
      if (!locationId.value) {
        return [];
      }

      const resp = await api.items.getAll({
        parentIds: [locationId.value],
      });

      if (resp.error) {
        toast.error(t("items.toast.failed_load_items"));
        return [];
      }

      return resp.data.items;
    },
    {
      watch: [locationId],
    }
  );
</script>

<template>
  <div>
    <ItemImageDialog />

    <div v-if="location">
      <!-- set page title -->
      <Title>{{ location.name }}</Title>

      <header class="mb-6 space-y-3">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink as-child class="text-primary hover:underline">
                <NuxtLink to="/home">{{ collectionName }}</NuxtLink>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <template v-if="location.parent">
              <BreadcrumbItem>
                <BreadcrumbLink as-child class="text-primary hover:underline">
                  <NuxtLink :to="`/location/${location.parent.id}`">{{ location.parent.name }}</NuxtLink>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
            </template>
            <BreadcrumbItem>{{ location.name }}</BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div class="min-w-0">
            <h1 class="break-words text-4xl font-semibold tracking-tight">
              {{ location.name }}
            </h1>
            <p v-if="location.description" class="mt-2 text-muted-foreground">
              {{ location.description }}
            </p>
          </div>
          <p class="flex items-center gap-2 text-primary" data-place-totals>
            <span v-if="directCount !== undefined">{{ $t("home.place_items", { count: directCount }) }}</span>
            <span v-if="directCount !== undefined && directValue !== undefined" aria-hidden="true">·</span>
            <Currency v-if="directValue !== undefined" :amount="directValue" />
          </p>
        </div>
      </header>

      <section class="mb-6" aria-labelledby="inside-heading" data-child-places>
        <div class="mb-3 flex items-center justify-between gap-3">
          <h2 id="inside-heading" class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {{ $t("locations.room.inside", { name: location.name }) }}
          </h2>
          <NuxtLink
            to="/locations"
            class="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
          >
            {{ $t("locations.room.all_places") }}
            <MdiArrowRight aria-hidden="true" />
          </NuxtLink>
        </div>
        <div v-if="childPlaces.length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <PhotoCard v-for="child in childPlaces" :key="child.id" :entity="child" place :value="placeValue(child.id)">
            <template v-if="child.id === previousPlaceId" #badge>
              <span
                class="absolute left-3 top-3 rounded-full bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground"
                data-place-visit
              >
                {{ $t("locations.room.you_were_here") }}
              </span>
            </template>
          </PhotoCard>
        </div>
        <p v-else class="text-sm text-muted-foreground">
          {{ $t("locations.room.no_children") }}
        </p>
      </section>

      <section class="mb-6" aria-labelledby="things-heading" data-place-things>
        <div class="mb-3 flex items-center justify-between gap-3">
          <h2 id="things-heading" class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {{ $t("locations.room.in_this_place") }}
          </h2>
          <NuxtLink
            :to="{ path: '/items', query: { loc: location.id } }"
            class="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
          >
            {{ $t("locations.room.all_things") }}
            <MdiArrowRight aria-hidden="true" />
          </NuxtLink>
        </div>
        <ul v-if="items?.length" class="space-y-3">
          <NightRow v-for="item in items" :key="item.id" :item="item" />
        </ul>
        <p v-else-if="items" class="text-sm text-muted-foreground">
          {{ $t("locations.room.no_things") }}
        </p>
      </section>

      <div class="mb-6 grid gap-3 sm:grid-cols-2">
        <Button @click="openCreateItem">
          <MdiPlus aria-hidden="true" />{{ $t("locations.room.add_item_here") }}
        </Button>
        <Button variant="outline" @click="openCreatePlace">
          <MdiMapMarkerOutline aria-hidden="true" />{{ $t("locations.room.add_place") }}
        </Button>
      </div>

      <!-- Existing management controls and supporting details remain available. -->
      <div class="mb-6 flex flex-wrap gap-2">
        <LabelMaker :id="location.id" type="location" />
        <Button variant="outline" @click="goToEdit"><MdiPencil aria-hidden="true" />{{ $t("global.edit") }}</Button>
        <Button variant="destructive" @click="confirmDelete"
          ><MdiDelete aria-hidden="true" />{{ $t("global.delete") }}</Button
        >
      </div>
      <div v-if="location.tags?.length" class="mb-4 flex flex-wrap gap-1">
        <TagChip v-for="tag in location.tags" :key="tag.id" :tag="tag" size="sm" />
      </div>

      <!-- Photo gallery -->
      <section v-if="photos.length > 0" class="mb-4">
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          <button
            v-for="(photo, i) in photos"
            :key="i"
            class="group relative aspect-1 h-32 overflow-hidden rounded-lg border bg-muted"
            @click="openImageDialog(photo, location.id)"
          >
            <img
              :src="photo.thumbnailSrc || photo.originalSrc"
              :alt="location.name"
              class="size-full object-cover transition-transform duration-200 group-hover:scale-105"
            />
          </button>
        </div>
      </section>

      <!-- Details (notes, custom fields) -->
      <BaseCard v-if="locationDetails.length > 0" class="mt-4">
        <template #title> {{ $t("global.details") }} </template>
        <DetailsSection :details="locationDetails" />
      </BaseCard>

      <!-- Attachments (non-photo) -->
      <BaseCard v-if="hasNonPhotoAttachments" class="mt-4">
        <template #title> {{ $t("items.attachments") }} </template>
        <div class="border-t px-4 py-2">
          <ItemAttachmentsList
            v-if="nonPhotoAttachments.attachments.length > 0"
            :attachments="nonPhotoAttachments.attachments"
            :item-id="location.id"
          />
          <ItemAttachmentsList
            v-if="nonPhotoAttachments.warranty.length > 0"
            :attachments="nonPhotoAttachments.warranty"
            :item-id="location.id"
          />
          <ItemAttachmentsList
            v-if="nonPhotoAttachments.manuals.length > 0"
            :attachments="nonPhotoAttachments.manuals"
            :item-id="location.id"
          />
          <ItemAttachmentsList
            v-if="nonPhotoAttachments.receipts.length > 0"
            :attachments="nonPhotoAttachments.receipts"
            :item-id="location.id"
          />
        </div>
      </BaseCard>
    </div>
  </div>
</template>
