<script setup lang="ts">
  import { Toaster } from "~/components/ui/sonner";

  // Public/auth screens retain their existing appearance and saved theme.
  useTheme();
</script>
<template>
  <div>
    <Toaster />
    <slot />
  </div>
</template>
