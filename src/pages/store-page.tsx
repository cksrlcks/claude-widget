import { useEffect, useState } from "react"

import { MarketplacePanel } from "@/features/store/components/marketplace-panel"
import { PluginCard } from "@/features/store/components/plugin-card"
import { StoreTabs } from "@/features/store/components/store-tabs"
import { StoreToolbar } from "@/features/store/components/store-toolbar"
import { usePluginFilter } from "@/features/store/hooks/use-plugin-filter"
import { api } from "@/shared/api/commands"
import { useCatalog } from "@/shared/api/queries"

export function StorePage() {
  const { data: catalog } = useCatalog()
  const items = catalog?.items ?? []
  const filter = usePluginFilter(items)
  const [marketsOpen, setMarketsOpen] = useState(false)
  // 설치는 터미널에서 진행 → 카탈로그가 다시 로드될 때까지 "설치 중" 표시
  const [installing, setInstalling] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (catalog?.fetchedAt) setInstalling(new Set())
  }, [catalog?.fetchedAt])

  const install = (id: string) => {
    setInstalling((s) => new Set(s).add(id))
    api.installPlugin(id)
  }

  const status = catalog?.loading
    ? "목록 불러오는 중…"
    : catalog?.error
      ? `오류: ${catalog.error}`
      : catalog?.fetchedAt
        ? `업데이트 ${new Date(catalog.fetchedAt).toLocaleTimeString()}`
        : ""

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="grid gap-3.5 border-b px-6 pt-5 pb-3">
        <StoreToolbar
          query={filter.query}
          onQueryChange={filter.setQuery}
          market={filter.market}
          markets={filter.markets}
          onMarketChange={filter.setMarket}
          loading={!!catalog?.loading}
          marketsOpen={marketsOpen}
          onToggleMarkets={() => setMarketsOpen((o) => !o)}
        />
        {marketsOpen && (
          <MarketplacePanel
            marketplaces={catalog?.marketplaces ?? []}
            onAdded={(name) => {
              filter.setQuery("")
              filter.setMarket(name)
            }}
          />
        )}
        <StoreTabs tab={filter.tab} onTabChange={filter.setTab} counts={filter.counts} status={status} />
      </header>
      <main className="grid flex-1 content-start gap-2.5 overflow-x-hidden overflow-y-auto px-6 pt-3.5 pb-6">
        {filter.filtered.length ? (
          filter.filtered.map((p) => (
            <PluginCard key={p.id} plugin={p} installing={installing.has(p.id)} onInstall={install} />
          ))
        ) : (
          <p className="text-muted-foreground py-12 text-center">
            {catalog?.loading && !items.length ? "불러오는 중…" : "플러그인이 없습니다."}
          </p>
        )}
      </main>
    </div>
  )
}
