import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { api } from "@/shared/api/commands"
import { KindBadge } from "@/shared/components/kind-badge"
import { displayName, kindOf, STATUS_LABEL } from "@/shared/lib/format"
import type { Integration, IntegrationStatus } from "@/shared/types"

const STATUS_TONE: Record<IntegrationStatus, string> = {
  ok: "text-success",
  auth: "text-destructive",
  fail: "text-destructive",
  missing: "text-muted-foreground",
  off: "text-muted-foreground",
}

type Props = {
  item: Integration
  /** 현재 계정 점검 결과. 없으면 "현재 계정에 없음" */
  current: Integration | undefined
  checked: boolean
  disabled: boolean
  onCheckedChange: (checked: boolean) => void
  className?: string
}

// 열 고정: 체크 | 이름 | 종류 | 상태 | 버튼 → 줄마다 세로 정렬이 맞도록
export function WatchRow({ item, current, checked, disabled, onCheckedChange, className }: Props) {
  const status: IntegrationStatus = current?.status ?? "missing"
  const kind = kindOf(item)

  return (
    <label
      className={cn(
        "grid min-h-9 cursor-pointer grid-cols-[16px_minmax(0,1fr)_68px_96px_64px] items-center gap-x-2.5 rounded-lg px-2.5 hover:bg-white/[0.035]",
        !checked && "opacity-45",
        className,
      )}
    >
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(v) => onCheckedChange(v === true)} />
      <span className="truncate" title={current?.statusText}>
        {displayName(item)}
      </span>
      <KindBadge kind={kind} className="justify-self-start" />
      <span className={cn("text-[11.5px] whitespace-nowrap", STATUS_TONE[status])}>{STATUS_LABEL[status]}</span>
      <RowAction status={status} name={item.name} isConnector={kind === "connector"} />
    </label>
  )
}

type RowActionProps = { status: IntegrationStatus; name: string; isConnector: boolean }

function RowAction({ status, name, isConnector }: RowActionProps) {
  const action =
    status === "auth"
      ? { label: "로그인", run: () => api.mcpLogin([name]) }
      : status === "missing" && isConnector
        ? { label: "claude.ai", run: () => api.openConnectors() }
        : null
  if (!action) return <span />
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault() // label 클릭으로 체크박스가 토글되지 않게
        action.run()
      }}
      title={status === "missing" ? "claude.ai 커넥터 설정에서 이 계정에 추가" : undefined}
      className="bg-primary/15 hover:border-primary justify-self-end rounded-md border border-transparent px-2 py-0.5 text-[11px] whitespace-nowrap text-[#9dbdf7] hover:text-white"
    >
      {action.label}
    </button>
  )
}
