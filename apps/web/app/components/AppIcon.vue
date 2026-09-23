<script setup lang="ts">
defineProps<{ name: string; size?: number }>()
const paths: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  calendar: 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  chevronLeft: 'm14 6-6 6 6 6',
  chevronRight: 'm10 6 6 6-6 6',
  chevronDown: 'm6 9 6 6 6-6',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
  link: 'm10 13 4-4M9 15l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
  edit: 'm15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  mail: 'M3 5h18v14H3zM3 5l9 7 9-7',
  cloud: 'M7 18a5 5 0 1 1 0-10 6 6 0 0 1 11-1 5.5 5.5 0 0 1 0 11M9 16l3 3 5-5',
  refresh: 'M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3',
  spark: 'm12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7z',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  sort: 'M4 6h2m3 0h11M4 12h2m3 0h11M4 18h2m3 0h11',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  clock: 'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
}
</script>

<template>
  <svg :width="size || 20" :height="size || 20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="paths[name] || paths.spark" />
  </svg>
</template>
