import { Download } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useUpdateClaude } from "@/shared/api/mutations"
import { useClaudeVersion } from "@/shared/api/queries"

type Props = {
  className?: string
}

/** Claude Code CLI 버전 + 업데이트 (터미널 창에서 실행, 창을 닫으면 버전을 다시 읽음) */
export function ClaudeCodeUpdate({ className }: Props) {
  const version = useClaudeVersion()
  const update = useUpdateClaude()

  const status = update.isPending
    ? "터미널 창에서 업데이트 중… 끝나면 창을 닫아 주세요"
    : version.isError
      ? "Claude Code를 찾지 못했습니다"
      : "MCP 로그인 등 일부 기능은 최신 Claude Code가 필요합니다"

  return (
    <div className={cn("bg-card flex items-center gap-3 rounded-[10px] border p-3.5", className)}>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <div className="font-semibold">
          Claude Code {version.data ? `v${version.data}` : version.isPending ? "확인 중…" : ""}
        </div>
        <div className={cn("text-muted-foreground truncate text-xs", version.isError && "text-destructive")}>
          {status}
        </div>
      </div>
      <Button variant="secondary" disabled={update.isPending || version.isError} onClick={() => update.mutate()}>
        <Download /> {update.isPending ? "업데이트 중…" : "업데이트"}
      </Button>
    </div>
  )
}
