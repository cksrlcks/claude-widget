import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// 창마다 HTML 진입점 하나 (Rust에서 widget.html / settings.html로 엶)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  clearScreen: false,
  // Rust 쪽은 Tauri가 감시. target의 exe를 감시하면 Windows에서 빌드 중 잠겨 EBUSY로 죽음
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        widget: resolve(__dirname, "widget.html"),
        settings: resolve(__dirname, "settings.html"),
      },
    },
  },
})
