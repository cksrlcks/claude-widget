import { RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { WatchRow } from "@/features/integrations/components/watch-row"
import { api } from "@/shared/api/commands"
import { Section } from "@/shared/components/section"
import type { AppState } from "@/shared/types"

type Props = {
  state: AppState
  className?: string
}

/** 감시할 MCP·플러그인 선택. 감시 목록에 든 항목만 위젯의 "끊어짐" 개수에 들어감 */
export function WatchSection({ state, className }: Props) {
  const { known, items, watch, checking, checkedAt, error } = state.integrations
  const current = new Map(items.map((i) => [i.key, i]))
  const watchAll = watch === null

  const toggle = (key: string, on: boolean) => {
    const base = watch ?? known.map((k) => k.key)
    api.setWatch(on ? [...new Set([...base, key])] : base.filter((k) => k !== key))
  }

  const info = checking
    ? "확인 중… (claude mcp list 실행)"
    : checkedAt
      ? `마지막 확인 ${new Date(checkedAt).toLocaleString()}${error ? ` · 오류: ${error}` : ""}`
      : "아직 확인하지 않았습니다."

  return (
    <Section
      title="감시할 MCP · 플러그인"
      description={`${info} · 체크한 항목만 위젯에 표시됩니다`}
      className={className}
      action={
        <Button variant="secondary" disabled={checking} onClick={() => api.recheck()}>
          <RefreshCw className={checking ? "animate-spin" : undefined} /> 지금 확인
        </Button>
      }
    >
      <label className="inline-flex w-fit cursor-pointer items-center gap-2">
        <Checkbox
          checked={watchAll}
          onCheckedChange={(v) => api.setWatch(v === true ? null : known.map((k) => k.key))}
        />
        전체 감시 (새로 추가되는 항목 포함)
      </label>
      <div className="bg-card grid max-h-[300px] gap-0.5 overflow-x-hidden overflow-y-auto rounded-[14px] border p-1.5">
        {known.length ? (
          known.map((k) => (
            <WatchRow
              key={k.key}
              item={k}
              current={current.get(k.key)}
              checked={watchAll || !!watch?.includes(k.key)}
              disabled={watchAll}
              onCheckedChange={(on) => toggle(k.key, on)}
            />
          ))
        ) : (
          <p className="text-muted-foreground px-3 py-2.5">발견된 MCP·플러그인이 없습니다.</p>
        )}
      </div>
    </Section>
  )
}
