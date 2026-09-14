import process from 'node:process'

export default defineNuxtConfig({
  compatibilityDate: '2025-09-13',
  ssr: false,
  devtools: { enabled: false },
  modules: ['@nuxt/ui'],
  ui: { colorMode: false, fonts: false },
  css: ['~/assets/main.css'],
  runtimeConfig: {
    public: { apiBase: process.env.NUXT_PUBLIC_API_BASE || 'http://localhost:8787' },
  },
  app: {
    head: {
      title: '日迹 · Hoshino’s Agenda',
      htmlAttrs: { lang: 'zh-CN' },
      meta: [{ name: 'description', content: '个人项目与事项日历。' }],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
})
