<template>
  <div id="app">
    <!--
    Confirmation Modal is a singleton used by all components so we render
    it here to ensure it's always available. Possibly could move this further
    up the tree
    -->
    <ModalConfirm />
    <OutdatedModal v-if="status" :status="status" />
    <EntityCreateModal />
    <WipeInventoryDialog />
    <TagCreateModal />
    <ItemBarcodeModal />
    <AppQuickMenuModal :actions="quickMenuActions" />
    <AppScannerModal />
    <CollectionCreateModal />
    <CollectionJoinModal />
    <CollectionInviteCreateModal />
    <SidebarProvider :default-open="sidebarState">
      <Sidebar collapsible="offcanvas">
        <SidebarHeader class="gap-3 p-4">
          <NuxtLink to="/home" class="flex items-center gap-2 text-lg font-semibold">
            <MdiHome class="size-6 text-primary" />
            {{ $t("global.homebox") }}
          </NuxtLink>
          <CollectionSelector />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup v-for="group in railGroups" :key="group.key">
            <SidebarGroupLabel class="uppercase tracking-wider">{{ $t(group.key) }}</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem v-for="n in group.items" :key="n.to">
                <SidebarMenuLink
                  :href="n.to"
                  :class="{ 'bg-sidebar-accent text-primary': n.active.value }"
                  :tooltip="n.name.value"
                >
                  <component :is="n.icon" />
                  <span>{{ n.name.value }}</span>
                  <span
                    v-if="n.to === '/maintenance' && careCount > 0"
                    class="ml-auto min-w-5 rounded-full bg-warning px-1.5 text-center text-xs font-semibold tabular-nums text-warning-foreground"
                    data-testid="care-count"
                    >{{ careCount }}</span
                  >
                </SidebarMenuLink>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter class="p-4">
          <div class="rounded-lg border border-sidebar-border bg-sidebar-accent p-1">
            <SidebarMenuLink href="/profile" class="h-auto p-2" :tooltip="username">
              <MdiAccount />
              <span class="min-w-0">
                <span class="block truncate font-semibold">{{ username }}</span>
                <span class="block truncate text-xs text-muted-foreground">{{
                  $t("menu.collection_name", { collection: collectionName })
                }}</span>
              </span>
            </SidebarMenuLink>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <SidebarMenuButton :tooltip="$t('menu.collection')">
                  <MdiCog />
                  <span>{{ $t("menu.collection") }}</span>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start">
                <DropdownMenuItem v-for="entry in collectionNav" :key="entry.to" as-child>
                  <NuxtLink :to="entry.to">
                    <component :is="entry.icon" />
                    {{ entry.name.value }}
                  </NuxtLink>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset class="min-h-dvh max-w-full overflow-hidden bg-background-accent">
        <div class="relative flex h-full flex-col justify-center">
          <!-- Keep the header heights aligned with the item edit page's sticky controls. -->
          <div
            class="sticky top-0 z-20 flex h-[var(--header-height-mobile)] flex-wrap items-center gap-2 border-b border-border bg-card p-2 sm:h-[var(--header-height)] sm:flex-nowrap sm:px-4"
          >
            <SidebarTrigger :label="$t('menu.navigation')" />
            <form class="flex min-w-0 flex-1 items-center gap-2" role="search" @submit.prevent="triggerSearch">
              <MdiMagnify class="size-5 shrink-0 text-muted-foreground" />
              <Input
                v-model:model-value="search"
                class="h-9 min-w-0"
                :placeholder="$t('global.search_items_places_tags')"
                :aria-label="$t('global.search_items_places_tags')"
                type="search"
              />
            </form>
            <Button variant="outline" class="shrink-0" @click="openScanner">
              <MdiBarcodeScan />
              {{ $t("menu.scanner") }}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button class="shrink-0">
                  <MdiPlus />
                  <span>
                    {{ $t("global.create") }}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent class="z-40 min-w-[var(--reka-dropdown-menu-trigger-width)]">
                <DropdownMenuItem
                  v-for="btn in dropdown"
                  :key="btn.id"
                  class="group cursor-pointer text-lg"
                  @click="
                    () => {
                      if (btn.dialogId === DialogID.CreateEntity) {
                        if (btn.id == 0)
                          // create item
                          openDialog(btn.dialogId, {
                            params: { baseType: 'item' },
                          });
                        else if (btn.id == 1)
                          // create location
                          openDialog(btn.dialogId, {
                            params: { baseType: 'location' },
                          });
                      } else {
                        openDialog(btn.dialogId as NoParamDialogIDs);
                      }
                    }
                  "
                >
                  <component :is="btn.icon" />
                  {{ btn.name.value }}
                  <Shortcut
                    v-if="btn.shortcut"
                    class="invisible ml-auto group-hover:visible"
                    :keys="btn.shortcut.replace('Shift', '⇧').split('+')"
                  />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <slot />
          <div class="grow" />

          <footer v-if="status" class="bottom-0 w-full pb-4 text-center">
            <p class="text-center text-sm">
              <span
                v-html="
                  DOMPurify.sanitize(
                    $t('global.footer.version_link', {
                      version: status.build.version.replace(/^v/, ''),
                      build: status.build.commit,
                    })
                  )
                "
              />
              ~
              <span v-html="DOMPurify.sanitize($t('global.footer.api_link'))" />
            </p>
          </footer>
        </div>
      </SidebarInset>
    </SidebarProvider>
  </div>
</template>

<script lang="ts" setup>
  import { useI18n } from "vue-i18n";
  import DOMPurify from "dompurify";
  import { useTagStore } from "~/stores/tags";
  import { useLocationStore } from "~~/stores/locations";
  import { useEntityTypeStore } from "~~/stores/entityTypes";

  import MdiBarcodeScan from "~icons/mdi/barcode-scan";
  import MdiMapMarker from "~icons/mdi/map-marker";
  import MdiCubeOutline from "~icons/mdi/cube-outline";
  import MdiAccountMultiple from "~icons/mdi/account-multiple";
  import MdiEmail from "~icons/mdi/email";
  import MdiBell from "~icons/mdi/bell";
  import MdiShape from "~icons/mdi/shape";
  import MdiHome from "~icons/mdi/home";
  import MdiTagMultiple from "~icons/mdi/tag-multiple";
  import MdiMagnify from "~icons/mdi/magnify";
  import MdiAccount from "~icons/mdi/account";
  import MdiCog from "~icons/mdi/cog";
  import MdiWrench from "~icons/mdi/wrench";
  import MdiPlus from "~icons/mdi/plus";
  import MdiFileDocumentMultiple from "~icons/mdi/file-document-multiple";

  import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarInset,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuLink,
    SidebarProvider,
    SidebarTrigger,
  } from "@/components/ui/sidebar";
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
  } from "@/components/ui/dropdown-menu";
  import { Shortcut } from "~/components/ui/shortcut";
  import { useDialog } from "~/components/ui/dialog-provider";
  import { Input } from "~/components/ui/input";
  import { Button } from "~/components/ui/button";
  import { toast } from "@/components/ui/sonner";
  import { DialogID, type NoParamDialogIDs } from "~/components/ui/dialog-provider/utils";
  import ModalConfirm from "~/components/ModalConfirm.vue";
  import OutdatedModal from "~/components/App/OutdatedModal.vue";
  import EntityCreateModal from "~/components/Entity/CreateModal.vue";
  import WipeInventoryDialog from "~/components/WipeInventoryDialog.vue";
  import TagCreateModal from "~/components/Tag/CreateModal.vue";
  import ItemBarcodeModal from "~/components/Item/BarcodeModal.vue";
  import AppQuickMenuModal from "~/components/App/QuickMenuModal.vue";
  import AppScannerModal from "~/components/App/ScannerModal.vue";
  import CollectionSelector from "~/components/Collection/Selector.vue";
  import CollectionCreateModal from "~/components/Collection/CreateModal.vue";
  import CollectionJoinModal from "~/components/Collection/JoinModal.vue";
  import CollectionInviteCreateModal from "~/components/Collection/InviteCreateModal.vue";

  const { t } = useI18n();
  const username = computed(() => authCtx.user?.name || t("menu.profile"));

  const { count: careCount } = useCareCount();

  const { selectedCollection } = useCollections();
  const collectionName = computed(() => selectedCollection.value?.name || t("menu.collection"));

  const { openDialog } = useDialog();

  // get sidebar state from cookies
  const sidebarState = useCookie("sidebar:state", {
    readonly: true,
    decode: value => value !== "false",
  });

  const pubApi = usePublicApi();
  const { data: status } = useAsyncData(async () => {
    const { data } = await pubApi.status();

    return data;
  });

  const search = ref("");

  const triggerSearch = () => {
    if (search.value) {
      navigateTo(`/items?q=${encodeURIComponent(search.value)}`);
      search.value = "";
      // remove focus from input
      if (document.activeElement && "blur" in document.activeElement) {
        (document.activeElement as HTMLElement).blur();
      }
    }
  };

  const openScanner = () => {
    // request permission
    if (navigator.mediaDevices) {
      navigator.mediaDevices
        .getUserMedia({ video: true })
        .then(() => {
          openDialog(DialogID.Scanner);
        })
        .catch(err => {
          console.error(err);
          toast.error(t("scanner.permission_denied"));
        });
    } else {
      toast.error(t("scanner.unsupported"));
    }
  };

  // Preload currency format
  useFormatCurrency();

  type DropdownItem = {
    id: number;
    name: ComputedRef<string>;
    icon: Component;
    shortcut: string;
    dialogId: DialogID;
  };

  const dropdown: DropdownItem[] = [
    {
      id: 0,
      icon: MdiCubeOutline,
      name: computed(() => t("menu.create_item")),
      shortcut: "Shift+1",
      dialogId: DialogID.CreateEntity,
    },
    {
      id: 1,
      icon: MdiMapMarker,
      name: computed(() => t("menu.create_location")),
      shortcut: "Shift+2",
      dialogId: DialogID.CreateEntity,
    },
    {
      id: 2,
      icon: MdiTagMultiple,
      name: computed(() => t("menu.create_tag")),
      shortcut: "Shift+3",
      dialogId: DialogID.CreateTag,
    },
  ];

  const route = useRoute();
  const router = useRouter();

  const navItem = (to: string, key: string, icon: Component) => ({
    to,
    icon,
    name: computed(() => t(key)),
    active: computed(() => route.path === to),
  });
  const railGroups = [
    {
      key: "menu.tonight",
      items: [
        navItem("/home", "menu.today", MdiHome),
        navItem("/locations", "menu.places", MdiMapMarker),
        navItem("/items", "menu.things", MdiCubeOutline),
        navItem("/maintenance", "menu.care", MdiWrench),
      ],
    },
    {
      key: "menu.organize",
      items: [
        navItem("/tags", "global.tags", MdiTagMultiple),
        navItem("/templates", "menu.templates", MdiFileDocumentMultiple),
      ],
    },
  ];
  const collectionNav = [
    navItem("/collection/members", "collection.tabs.members", MdiAccountMultiple),
    navItem("/collection/invites", "collection.tabs.invites", MdiEmail),
    navItem("/collection/notifiers", "collection.tabs.notifiers", MdiBell),
    navItem("/collection/settings", "collection.tabs.settings", MdiCog),
    navItem("/collection/entity-types", "collection.tabs.entity_types", MdiShape),
    navItem("/collection/tools", "collection.tabs.tools", MdiWrench),
  ];
  const nav = [
    ...railGroups.flatMap(group => group.items),
    navItem("/profile", "menu.profile", MdiAccount),
    ...collectionNav,
  ];

  const quickMenuActions = reactive([
    ...dropdown.map(v => ({
      text: computed(() => v.name.value),
      dialogId: v.dialogId,
      shortcut: v.shortcut.split("+")[1] as string,
      id: v.id,
      type: "create" as const,
    })),
    ...nav.map(v => ({
      text: computed(() => v.name.value),
      href: v.to,
      type: "navigate" as const,
    })),
  ]);

  const tagStore = useTagStore();
  tagStore.ensureAllTagsFetched();

  const locationStore = useLocationStore();
  locationStore.ensureLocationsFetched();

  const entityTypeStore = useEntityTypeStore();
  entityTypeStore.ensureFetched();

  useNightAtelier();

  onMounted(() => {
    locationStore.refreshParents();
    locationStore.refreshTree();

    // Auto-open JoinModal when invitation token is in URL
    const token = route.query.token;
    if (typeof token === "string" && token.length > 0) {
      // Remove token from browser URL
      const url = new URL(window.location.href);
      url.searchParams.delete("token");
      window.history.replaceState(history.state, "", url.toString());

      // Sync router's state to clear route.query.token
      const { token: _, ...cleanQuery } = route.query;
      router.replace({ query: cleanQuery });

      openDialog(DialogID.JoinCollection, {
        params: { inviteCode: token },
      });
    }
  });

  onServerEvent(ServerEvent.TagMutation, () => {
    tagStore.refresh();
  });

  onServerEvent(ServerEvent.EntityMutation, () => {
    locationStore.refreshChildren();
    locationStore.refreshParents();
    locationStore.refreshTree();
  });

  const authCtx = useAuthContext();
</script>
