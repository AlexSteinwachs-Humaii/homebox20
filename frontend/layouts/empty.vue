<script setup lang="ts">
  import { Toaster } from "~/components/ui/sonner";
  import { onBeforeMount } from "vue";
  import { releaseUnmanagedNightAtelier } from "~/composables/use-night-atelier";

  // A hard load of an auth-gated route can add the class before the redirect.
  // Do this before the page's own owner (scanner, label generator) mounts.
  onBeforeMount(() => {
    releaseUnmanagedNightAtelier();
  });

  // Public/auth screens retain their existing appearance and saved theme.
  useTheme();
</script>
<template>
  <div>
    <Toaster />
    <slot />
  </div>
</template>
