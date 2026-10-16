import { cn } from "@/lib/utils"
import { api } from "@/shared/api/commands"
import { displayName, kindOf } from "@/shared/lib/format"
import type { Integration } from "@/shared/types"

const MAX = 6
const KIND_SHORT = { connector: "커넥터", local: "로컬", plugin: "플러그인" }

type Props = {
  items: Integration[]
  className?: string
}

/** 끊긴 항목 목록. 인증 필요 → MCP 로그인, 계정에 없음 → claude.ai 커넥터 설정 */
export function BrokenList({ items, className }: Props) {
  if (!items.length) return null
  return (
    <div className={cn("grid gap-0.5", className)}>
      {items.slice(0, MAX).map((i) => (
        <BrokenRow key={i.key} item={i} />
      ))}
      {items.length > MAX && (
        <Row onClick={() => api.openSettings()} className="text-muted-foreground">
          외 {items.length - MAX}개 · 설정에서 확인
        </Row>
      )}
    </div>
  )
}

function BrokenRow({ item }: { item: Integration }) {
  const action =
    item.status === "auth"
      ? { label: "인증 필요 · 클릭해서 로그인", run: () => api.mcpLogin([item.name]) }
      : item.status === "missing"
        ? { label: "계정에 없음 · claude.ai에서 추가", run: () => api.openConnectors() }
        : null

  return (
    <Row onClick={action?.run} title={item.statusText}>
      ✕{" "}
      <span className="text-muted-foreground mx-0.5 rounded bg-white/9 px-1 text-[10px]">
        {KIND_SHORT[kindOf(item)]}
      </span>{" "}
      {displayName(item)} — {action?.label ?? "연결 실패"}
    </Row>
  )
}

type RowProps = {
  onClick?: () => void
  title?: string
  className?: string
  children: React.ReactNode
}

function Row({ onClick, title, className, children }: RowProps) {
  return (
    <div
      onClick={onClick}
      title={title}
      className={cn(
        "truncate rounded-md px-2.5 py-1 text-[11px] text-[#f7b4bf]",
        onClick && "cursor-pointer hover:bg-white/9 hover:text-white",
        className,
      )}
    >
      {children}
    </div>
  )
}
