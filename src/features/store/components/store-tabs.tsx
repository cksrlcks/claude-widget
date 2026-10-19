import type { StoreTab } from "@/features/store/hooks/use-plugin-filter"
import { cn } from "@/lib/utils"

type Props = {
  tab: StoreTab
  onTabChange: (tab: StoreTab) => void
  counts: Record<StoreTab, number>
  status: string
  className?: string
}

const TABS: { key: StoreTab; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "installed", label: "설치됨" },
]

export function StoreTabs({ tab, onTabChange, counts, status, className }: Props) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onTabChange(t.key)}
          className={cn(
            "text-muted-foreground hover:text-foreground inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[12.5px]",
            tab === t.key && "bg-secondary text-foreground",
          )}
        >
          {t.label}
          {counts[t.key] > 0 && <span className="text-[11px] tabular-nums opacity-80">{counts[t.key]}</span>}
        </button>
      ))}
      <span className="text-muted-foreground ml-auto min-w-0 truncate pl-2 text-[11px]" title={status}>
        {status}
      </span>
    </div>
  )
}
