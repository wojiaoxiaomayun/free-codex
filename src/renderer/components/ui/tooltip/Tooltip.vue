<script setup lang="ts">
import type { TooltipRootProps } from 'reka-ui'
import { TooltipRoot } from 'reka-ui'

const props = defineProps<TooltipRootProps>()
</script>

<template>
  <TooltipRoot v-bind="props">
    <slot />
  </TooltipRoot>
</template>
