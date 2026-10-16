import { useState, type FormEvent } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { marketplaceLabel, OFFICIAL_MARKETPLACE } from "@/features/store/lib/constants"
import { useConfirm } from "@/hooks/use-confirm"
import { cn } from "@/lib/utils"
import { useMarketplaceAction } from "@/shared/api/mutations"
import { appKeys } from "@/shared/api/queries"
import type { Catalog, Marketplace } from "@/shared/types"

type Props = {
  marketplaces: Marketplace[]
  /** 새 마켓을 추가하면 그 이름으로 필터를 바꾸기 위해 호출 */
  onAdded: (name: string) => void
  className?: string
}

// https://github.com/owner/repo(.git) 형태도 owner/repo로 정리
const normalizeSource = (v: string) => v.trim().replace(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(\.git)?\/?$/, "$1")

export function MarketplacePanel({ marketplaces, onAdded, className }: Props) {
  const confirm = useConfirm()
  const qc = useQueryClient()
  const action = useMarketplaceAction()
  const [source, setSource] = useState("")

  const add = (e: FormEvent) => {
    e.preventDefault()
    const value = normalizeSource(source)
    if (!value) return
    const before = new Set(marketplaces.map((m) => m.name))
    action.mutate(
      { action: "add", value },
      {
        onSuccess: () => {
          setSource("")
          // 백엔드는 카탈로그를 다시 읽은 뒤 응답하므로 캐시에 새 마켓이 이미 들어 있음
          const latest = qc.getQueryData<Catalog>(appKeys.catalog())?.marketplaces ?? []
          const added = latest.find((m) => !before.has(m.name))
          if (added) onAdded(added.name)
        },
      },
    )
  }

  const remove = async (name: string) => {
    const ok = await confirm(
      `“${name}” 마켓플레이스를 제거할까요?`,
      "여기서 설치한 플러그인도 함께 제거될 수 있습니다.",
      "취소",
      "제거",
    )
    if (ok) action.mutate({ action: "remove", value: name })
  }

  return (
    <div className={cn("bg-card rounded-[14px] border p-3.5", className)}>
      <form onSubmit={add} className="flex gap-2">
        <Input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="GitHub owner/repo 또는 https 주소 (예: DietrichGebert/ponytail)"
          autoComplete="off"
          className="bg-background h-[34px]"
        />
        <Button type="submit" className="h-[34px]" disabled={action.isPending || !source.trim()}>
          {action.isPending ? "추가 중…" : "추가"}
        </Button>
      </form>
      <div className="mt-2.5 grid border-t">
        {marketplaces.map((m) => (
          <div key={m.name} className="flex min-h-10 min-w-0 items-center gap-2.5 border-b px-0.5 last:border-b-0">
            <span className="shrink-0 font-medium">{marketplaceLabel(m.name)}</span>
            <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">{m.repo}</span>
            {m.name !== OFFICIAL_MARKETPLACE && (
              <Button variant="destructive" size="sm" disabled={action.isPending} onClick={() => remove(m.name)}>
                제거
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
