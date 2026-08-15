import { computed } from 'vue'
import { useColorMode } from '@vueuse/core'

export type ThemeMode = 'light' | 'dark' | 'auto'

// 官方 shadcn-vue 推荐（Vite 暗色模式指南）：useColorMode
// - 自动维护 <html> 的 dark class + localStorage 持久化
// - storageKey 沿用 'free-codex-theme'（兼容旧值 'light' / 'dark'）
// - emitAuto: true → theme 保留 'auto' 三档选择（而非解析成具体值）
// - modes 自定义：light/auto 不加 class，dark 加 'dark'（与项目现有 .dark 变体一致）
export const theme = useColorMode<ThemeMode>({
  storageKey: 'free-codex-theme',
  emitAuto: true,
  modes: {
    auto: '',
    light: '',
    dark: 'dark',
  },
})

/** 当前实际生效的暗色状态（auto 时解析为系统偏好） */
export const isDark = computed(() => theme.state.value === 'dark')
