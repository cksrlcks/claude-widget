import { cn } from "@/lib/utils"
import { formatReset, usageTone } from "@/shared/lib/format"
import type { UsageSource, UsageWindow } from "@/shared/types"

const BAR_TONE = { success: "bg-success", warning: "bg-warning", destructive: "bg-destructive" }

type Props = {
  label: string
  window: UsageWindow | null
  source: UsageSource | null
  /** 사용량을 못 가져왔을 때 보여줄 메시지 */
  fallback?: string | null
  className?: string
}

export function UsageMeter({ label, window: w, source, fallback, className }: Props) {
  const used = w ? Math.min(100, Math.max(0, Math.round(w.used))) : null
  const sub = w ? `${formatReset(w.resetsAt)}${source && source !== "live" ? " · 캐시" : ""}` : (fallback ?? "")

  return (
    <div className={className}>
      <div className="text-muted-foreground flex items-baseline justify-between text-[11.5px]">
        <span>{label}</span>
        <b className="text-foreground text-[13px] font-semibold tabular-nums">{used === null ? "-" : `${used}%`}</b>
      </div>
      <div className="mt-[5px] h-1.5 overflow-hidden rounded-full bg-white/8">
        <i
          className={cn("block h-full rounded-full transition-all duration-400", BAR_TONE[usageTone(used ?? 0)])}
          style={{ width: `${used ?? 0}%` }}
        />
      </div>
      {sub && <div className="text-muted-foreground mt-[5px] text-[10.5px]">{sub}</div>}
    </div>
  )
}
