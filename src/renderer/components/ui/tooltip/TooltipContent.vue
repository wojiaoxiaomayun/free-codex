<script setup lang="ts">
import type { TooltipContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { TooltipArrow, TooltipContent, TooltipPortal } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<TooltipContentProps & { class?: HTMLAttributes['class'] }>()
</script>

<template>
  <TooltipPortal>
    <TooltipContent
      data-slot="tooltip-content"
      v-bind="props"
      :class="cn('z-50 w-fit rounded-md bg-primary px-2.5 py-1.5 text-primary-foreground text-xs', props.class)"
    >
      <slot />
      <TooltipArrow class="bg-primary fill-primary" />
    </TooltipContent>
  </TooltipPortal>
</template>
