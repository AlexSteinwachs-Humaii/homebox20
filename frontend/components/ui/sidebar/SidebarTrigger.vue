<script setup lang="ts">
  import type { HTMLAttributes } from "vue";
  import { useSidebar } from "./utils";
  import { Button } from "@/components/ui/button";
  import { cn } from "@/lib/utils";
  import MdiMenu from "~icons/mdi/menu";

  const props = defineProps<{
    class?: HTMLAttributes["class"];
    variant?: "ghost" | "default";
    label?: string;
  }>();

  const { toggleSidebar } = useSidebar();
</script>

<template>
  <Button
    data-sidebar="trigger"
    :variant="props.variant ?? 'ghost'"
    :size="props.label ? 'default' : 'icon'"
    :class="cn(props.label ? 'h-9 [&_svg]:size-6' : 'size-9 [&_svg]:size-6', props.class)"
    @click="toggleSidebar"
  >
    <MdiMenu />
    <span :class="props.label ? undefined : 'sr-only'">{{ props.label || "Toggle Sidebar" }}</span>
  </Button>
</template>
