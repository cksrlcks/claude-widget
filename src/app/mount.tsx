import { StrictMode, type ComponentType } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRoot } from "react-dom/client"
import { Toaster } from "sonner"

import { ConfirmProvider } from "@/hooks/use-confirm"
import { initTheme } from "@/shared/lib/theme"

import "@/index.css"

type Options = {
  /** 위젯처럼 작은 창은 토스트를 띄우지 않음 */
  toaster?: boolean
}

/** 창(HTML 진입점)마다 공통 Provider를 씌워 페이지를 마운트 */
export function mount(Page: ComponentType, { toaster = true }: Options = {}) {
  initTheme()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ConfirmProvider>
          <Page />
          {/* shortcut: 창을 연 시점의 테마만 반영, 테마를 바꾼 뒤 토스트까지 맞추려면 상태로 올릴 것 */}
          {toaster && (
            <Toaster
              theme={document.documentElement.classList.contains("theme-paper") ? "light" : "dark"}
              position="bottom-center"
              richColors
            />
          )}
        </ConfirmProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
}
