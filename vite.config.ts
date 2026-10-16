import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// 창마다 HTML 진입점 하나 (Rust에서 widget.html / settings.html / store.html로 엶)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        widget: resolve(__dirname, "widget.html"),
        settings: resolve(__dirname, "settings.html"),
        store: resolve(__dirname, "store.html"),
      },
    },
  },
})
