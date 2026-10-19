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
  // 1줄: 제목 + 새로고침·마켓플레이스 관리 / 2줄: 검색 + 마켓플레이스 필터
  return (
    <div className={cn("grid gap-3", className)}>
      <div className="flex items-center gap-2">
        <h2 className="mr-auto text-[15px] font-semibold">플러그인 스토어</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          title="목록 새로고침"
          className="text-muted-foreground"
          disabled={loading}
          onClick={() => api.reloadCatalog()}
        >
          <RefreshCw className={loading ? "animate-spin" : undefined} />
        </Button>
        <Button variant={marketsOpen ? "default" : "secondary"} size="sm" onClick={onToggleMarkets}>
          <Settings2 /> 마켓플레이스 관리
        </Button>
      </div>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="플러그인 검색 (이름·설명)"
            className="h-8 pl-8 text-[12.5px] md:text-[12.5px]"
          />
        </div>
        <select
          value={market}
          onChange={(e) => onMarketChange(e.target.value)}
          className="border-input bg-card focus-visible:border-ring h-8 w-[180px] shrink-0 truncate rounded-lg border px-2 text-[12.5px] outline-none"
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
      </div>
    </div>
  )
}
