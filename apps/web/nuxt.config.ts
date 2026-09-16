export default defineNuxtConfig({
  compatibilityDate: '2025-09-13',
  ssr: false,
  devtools: { enabled: false },
  modules: ['@nuxt/ui'],
  ui: { colorMode: false, fonts: false },
  css: ['~/assets/main.css'],
  nitro: {
    devProxy: {
      '/api': { target: 'http://127.0.0.1:8787/api', changeOrigin: true },
    },
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
