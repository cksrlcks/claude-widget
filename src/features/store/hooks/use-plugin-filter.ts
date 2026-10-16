import { useMemo, useState } from "react"

import { OFFICIAL_MARKETPLACE } from "@/features/store/lib/constants"
import type { CatalogItem } from "@/shared/types"

export type StoreTab = "all" | "installed"

/** 검색어·마켓플레이스·탭으로 거르고, 설치됨 → 공식 → 이름 순으로 정렬 */
export function usePluginFilter(items: CatalogItem[]) {
  const [query, setQuery] = useState("")
  const [market, setMarket] = useState("")
  const [tab, setTab] = useState<StoreTab>("all")

  const markets = useMemo(() => [...new Set(items.map((p) => p.marketplace))].sort(), [items])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items
      .filter((p) => tab === "all" || p.installed)
      .filter((p) => !market || p.marketplace === market)
      .filter((p) => !q || `${p.name} ${p.description}`.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          Number(b.installed) - Number(a.installed) ||
          Number(b.marketplace === OFFICIAL_MARKETPLACE) - Number(a.marketplace === OFFICIAL_MARKETPLACE) ||
          a.name.localeCompare(b.name),
      )
  }, [items, query, market, tab])

  return {
    query,
    setQuery,
    market: markets.includes(market) ? market : "",
    setMarket,
    tab,
    setTab,
    markets,
    filtered,
    counts: { all: items.length, installed: items.filter((p) => p.installed).length },
  }
}
