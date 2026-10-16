import { RefreshCw, Search, Settings2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { marketplaceLabel } from "@/features/store/lib/constants"
import { cn } from "@/lib/utils"
import { api } from "@/shared/api/commands"

type Props = {
  query: string
  onQueryChange: (q: string) => void
  market: string
  markets: string[]
  onMarketChange: (m: string) => void
  loading: boolean
  marketsOpen: boolean
  onToggleMarkets: () => void
  className?: string
}

export function StoreToolbar({
  query,
  onQueryChange,
  market,
  markets,
  onMarketChange,
  loading,
  marketsOpen,
  onToggleMarkets,
  className,
}: Props) {
  return (
    <div className={cn("flex gap-2", className)}>
      <div className="relative min-w-0 flex-1">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="플러그인 검색 (이름·설명)"
          className="h-[34px] pl-8"
        />
      </div>
      <select
        value={market}
        onChange={(e) => onMarketChange(e.target.value)}
        className="border-input bg-input/30 focus-visible:border-ring h-[34px] max-w-[220px] rounded-lg border px-2.5 outline-none"
      >
        <option value="" className="bg-card">
          모든 마켓플레이스
        </option>
        {markets.map((m) => (
          <option key={m} value={m} className="bg-card">
            {marketplaceLabel(m)}
          </option>
        ))}
      </select>
      <Button variant="secondary" className="h-[34px]" disabled={loading} onClick={() => api.reloadCatalog()}>
        <RefreshCw className={loading ? "animate-spin" : undefined} /> 새로고침
      </Button>
      <Button variant={marketsOpen ? "default" : "secondary"} className="h-[34px]" onClick={onToggleMarkets}>
        <Settings2 /> 마켓플레이스 관리
      </Button>
    </div>
  )
}
