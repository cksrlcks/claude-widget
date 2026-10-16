import { cn } from "@/lib/utils"
import { api } from "@/shared/api/commands"
import type { AppState } from "@/shared/types"

type Props = {
  integrations: AppState["integrations"]
  className?: string
}

/** "4개 중 2개 끊어짐" 요약 버튼. 클릭하면 즉시 다시 확인 */
export function IntegrationStatus({ integrations, className }: Props) {
  const { broken, total, checking, checkedAt, error } = integrations
  const bad = broken.length > 0

  const text =
    checking && !checkedAt
      ? "MCP 확인 중…"
      : error && !total
        ? "MCP 확인 실패"
        : bad
          ? `${total}개 중 ${broken.length}개 끊어짐`
          : total
            ? `MCP·플러그인 ${total}개 정상`
            : "감시 중인 항목 없음"

  const dot = checking
    ? "bg-warning animate-pulse"
    : bad || (error && !total)
      ? "bg-destructive shadow-[0_0_0_3px] shadow-destructive/20"
      : "bg-success shadow-[0_0_0_3px] shadow-success/15"

  return (
    <button
      type="button"
      onClick={() => api.recheck()}
      title={checkedAt ? `마지막 확인 ${new Date(checkedAt).toLocaleTimeString()} · 클릭해서 다시 확인` : undefined}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-[10px] bg-white/5 px-2.5 py-[7px] text-left text-xs hover:bg-white/9",
        bad && "bg-destructive/14 hover:bg-destructive/20 text-[#ffd3da]",
        className,
      )}
    >
      <span className={cn("size-2 shrink-0 rounded-full", dot)} />
      {text}
    </button>
  )
}
