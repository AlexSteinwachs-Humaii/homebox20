<template>
  <ScannerARView />
</template>

<script setup lang="ts">
  import ScannerARView from "@/components/Scanner/ARView.vue";

  definePageMeta({
    middleware: ["auth"],
    layout: "empty",
  });

  // Authenticated, but intentionally outside the default shell.
  useNightAtelier();

  useHead({
    title: "HomeBox | AR Scanner",
  });
</script>
