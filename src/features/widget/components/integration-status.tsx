import { cn } from "@/lib/utils"
import { api } from "@/shared/api/commands"
import type { AppState } from "@/shared/types"

type Props = {
  integrations: AppState["integrations"]
  className?: string
}

/** 상태등 색 (확장 모드 요약 버튼과 미니 모드가 같이 씀): 확인 중 노랑, 끊김 빨강, 정상 초록 */
export function statusDotClass({ broken, total, checking, error }: AppState["integrations"]) {
  if (checking) return "bg-warning animate-pulse"
  if (broken.length > 0 || (error && !total)) return "bg-destructive shadow-[0_0_0_3px] shadow-destructive/20"
  return "bg-success shadow-[0_0_0_3px] shadow-success/15"
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
          ? `감시 중 ${total}개 중 ${broken.length}개 끊어짐`
          : total
            ? `감시 중 ${total}개 정상`
            : "감시 중인 항목 없음"

  return (
    <button
      type="button"
      onClick={() => api.recheck()}
      title={checkedAt ? `마지막 확인 ${new Date(checkedAt).toLocaleTimeString()} · 클릭해서 다시 확인` : undefined}
      className={cn(
        "bg-foreground/5 hover:bg-foreground/9 flex w-full cursor-pointer items-center gap-2 rounded-[10px] px-2.5 py-[7px] text-left text-xs",
        bad && "bg-destructive/14 hover:bg-destructive/20 text-destructive",
        className,
      )}
    >
      <span className={cn("size-2 shrink-0 rounded-full", statusDotClass(integrations))} />
      {text}
    </button>
  )
}
