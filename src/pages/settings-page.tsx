import { useEffect, useState } from "react"
import { listen } from "@tauri-apps/api/event"
import { Boxes, ChartColumn, Plug, Settings, Store, User, type LucideIcon } from "lucide-react"

import { AccountSection } from "@/features/accounts/components/account-section"
import { GeneralSection } from "@/features/general/components/general-section"
import { WatchSection } from "@/features/integrations/components/watch-section"
import { InventorySection } from "@/features/inventory/components/inventory-section"
import { TokenSection } from "@/features/tokens/components/token-section"
import { UpdateSection } from "@/features/updates/components/update-section"
import { cn } from "@/lib/utils"
import { StorePage } from "@/pages/store-page"
import { useAppState } from "@/shared/api/queries"
import { ProfileAvatar } from "@/shared/components/profile-avatar"
import type { AppState } from "@/shared/types"

type PageKey = "accounts" | "watch" | "inventory" | "store" | "tokens" | "general" | "update"

const NAV: { key: PageKey; label: string; icon: LucideIcon }[] = [
  { key: "accounts", label: "계정", icon: User },
  { key: "watch", label: "MCP 감시", icon: Plug },
  { key: "inventory", label: "스킬 · 플러그인", icon: Boxes },
  { key: "store", label: "플러그인 스토어", icon: Store },
  { key: "tokens", label: "토큰 사용", icon: ChartColumn },
  { key: "general", label: "일반", icon: Settings },
]

const PAGES: Record<PageKey, (s: AppState) => React.ReactNode> = {
  accounts: (s) => <AccountSection state={s} />,
  watch: (s) => <WatchSection state={s} />,
  inventory: (s) => <InventorySection state={s} />,
  store: () => <StorePage />,
  tokens: () => <TokenSection />,
  general: (s) => <GeneralSection state={s} />,
  update: (s) => <UpdateSection update={s.update} />,
}

export function SettingsPage() {
  const { data: state } = useAppState()
  // 트레이·위젯 메뉴의 "플러그인 스토어"는 #store로 열거나 이벤트로 페이지를 바꿈 (main.rs open_store)
  const [page, setPage] = useState<PageKey>(() => (location.hash === "#store" ? "store" : "accounts"))
  useEffect(() => {
    const unlisten = listen<PageKey>("settings-page", (e) => setPage(e.payload))
    return () => {
      unlisten.then((f) => f())
    }
  }, [])
  if (!state) return null

  const profile = state.profiles.find((p) => p.id === state.activeId)
  const session = state.usage?.session
  const broken = state.integrations.broken.length
  const { current, available } = state.update

  return (
    <div className="flex h-screen">
      <nav className="bg-sidebar flex w-[188px] shrink-0 flex-col gap-px p-2">
        <div className="flex min-w-0 items-center gap-2 px-2 pt-1.5 pb-3">
          <ProfileAvatar profile={profile} className="size-7" />
          <div className="grid min-w-0">
            <span className="truncate text-xs font-semibold">
              {profile ? profile.label || profile.displayName : "로그인 안 됨"}
            </span>
            <span className="text-muted-foreground truncate text-[10.5px]">
              {[profile?.plan, session && `세션 ${Math.round(session.used)}%`].filter(Boolean).join(" · ")}
            </span>
          </div>
        </div>
        {NAV.map(({ key, label, icon: Icon }) => (
          <NavItem key={key} active={page === key} onClick={() => setPage(key)}>
            <Icon />
            {label}
            {key === "watch" && broken > 0 && (
              <span className="bg-destructive/15 text-destructive ml-auto rounded-full px-1.5 text-[10.5px] font-semibold tabular-nums">
                {broken}
              </span>
            )}
          </NavItem>
        ))}
        <button
          type="button"
          onClick={() => setPage("update")}
          className={cn(
            "text-muted-foreground hover:text-foreground mt-auto flex cursor-pointer items-center gap-1.5 border-t px-2 pt-2.5 text-[11px]",
            page === "update" && "text-foreground",
          )}
        >
          v{current}
          {available && (
            <span className="bg-primary/15 text-primary ml-auto rounded-full px-2 py-px text-[10.5px] font-semibold">
              v{available.version} 업데이트
            </span>
          )}
        </button>
      </nav>
      <main className={cn("min-w-0 flex-1", page === "store" ? "overflow-hidden" : "overflow-y-auto px-6 pt-5 pb-6")}>
        {PAGES[page](state)}
      </main>
    </div>
  )
}

type NavItemProps = {
  active?: boolean
  onClick: () => void
  className?: string
  children: React.ReactNode
}

function NavItem({ active, onClick, className, children }: NavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-muted-foreground hover:text-foreground flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 text-left [&_svg]:size-[15px] [&_svg]:shrink-0",
        active && "bg-card text-foreground font-medium",
        className,
      )}
    >
      {children}
    </button>
  )
}
