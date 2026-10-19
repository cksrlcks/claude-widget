import { ExternalLink } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { marketplaceLabel, OFFICIAL_MARKETPLACE } from "@/features/store/lib/constants"
import { useConfirm } from "@/hooks/use-confirm"
import { cn } from "@/lib/utils"
import { api } from "@/shared/api/commands"
import { usePluginAction } from "@/shared/api/mutations"
import type { CatalogItem } from "@/shared/types"

type Props = {
  plugin: CatalogItem
  /** 설치 터미널이 열려 있는 동안 true */
  installing: boolean
  onInstall: (id: string) => void
  className?: string
}

export function PluginCard({ plugin: p, installing, onInstall, className }: Props) {
  const official = p.marketplace === OFFICIAL_MARKETPLACE

  return (
    <div
      className={cn(
        "bg-card hover:border-border-strong flex min-w-0 items-center gap-4 rounded-[10px] border px-3.5 py-3",
        p.installed && "border-success/35 hover:border-success/50",
        className,
      )}
    >
      <div className="grid min-w-0 flex-1 gap-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[12.5px] font-semibold">{p.name}</span>
          {p.version && <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">v{p.version}</span>}
          <Badge variant="secondary" className={cn("font-normal", official && "bg-primary/15 text-primary")}>
            {marketplaceLabel(p.marketplace)}
          </Badge>
          {p.installed && (
            <Badge
              variant="secondary"
              className={cn("font-normal", p.enabled ? "bg-success/15 text-success" : "text-muted-foreground")}
            >
              {p.enabled ? "사용 중" : "꺼짐"}
            </Badge>
          )}
          {p.url && (
            <button
              type="button"
              onClick={() => api.openUrl(p.url)}
              className="text-muted-foreground hover:text-primary ml-auto flex shrink-0 cursor-pointer items-center gap-1 text-[11.5px]"
            >
              소스 보기 <ExternalLink className="size-3" />
            </button>
          )}
        </div>
        <p className="text-muted-foreground line-clamp-2 text-[11.5px] leading-relaxed" title={p.description}>
          {p.description || "설명 없음"}
        </p>
      </div>
      <PluginActions plugin={p} installing={installing} onInstall={onInstall} />
    </div>
  )
}

function PluginActions({ plugin: p, installing, onInstall }: Omit<Props, "className">) {
  const confirm = useConfirm()
  const action = usePluginAction()

  if (!p.installed) {
    return (
      <Button size="sm" className="w-[76px] shrink-0" disabled={installing} onClick={() => onInstall(p.id)}>
        {installing ? "설치 중…" : "설치"}
      </Button>
    )
  }

  const uninstall = async () => {
    if (await confirm(`${p.name} 플러그인을 제거할까요?`, p.id, "취소", "제거")) {
      action.mutate({ action: "uninstall", id: p.id })
    }
  }

  return (
    <div className="grid w-[76px] shrink-0 gap-1">
      <Button
        size="sm"
        variant="secondary"
        disabled={action.isPending}
        onClick={() => action.mutate({ action: p.enabled ? "disable" : "enable", id: p.id })}
      >
        {p.enabled ? "비활성화" : "활성화"}
      </Button>
      <Button size="sm" variant="destructive" disabled={action.isPending} onClick={uninstall}>
        제거
      </Button>
    </div>
  )
}
