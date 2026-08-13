<script setup lang="ts">
import { computed } from "vue"
import type { HTMLAttributes } from "vue"
import type { SwitchRootEmits, SwitchRootProps } from "reka-ui"
import { reactiveOmit } from "@vueuse/core"
import {
  SwitchRoot,
  SwitchThumb,
  useForwardPropsEmits,
} from "reka-ui"
import { cn } from "@/lib/utils"

const props = defineProps<
  SwitchRootProps & {
    checked?: boolean
    class?: HTMLAttributes["class"]
  }
>()

const emits = defineEmits<
  SwitchRootEmits & {
    "update:checked": [value: boolean]
  }
>()

const delegatedProps = reactiveOmit(props, "class", "checked", "modelValue")

const forwarded = useForwardPropsEmits(delegatedProps, emits)

// 适配 :checked / @update:checked 受控模式（映射到 reka-ui 的 modelValue）
const checked = computed({
  get: () => (props.checked !== undefined ? props.checked : props.modelValue === props.trueValue),
  set: (value: boolean) => emits("update:checked", value),
})
</script>

<template>
  <SwitchRoot
    v-slot="slotProps"
    v-model="checked"
    data-slot="switch"
    v-bind="forwarded"
    :class="cn(
      'peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-input/80 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50',
      props.class,
    )"
  >
    <SwitchThumb
      data-slot="switch-thumb"
      :class="cn('bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0')"
    >
      <slot name="thumb" v-bind="slotProps" />
    </SwitchThumb>
  </SwitchRoot>
</template>
