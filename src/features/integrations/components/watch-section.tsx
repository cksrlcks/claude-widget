import { RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { WatchRow } from "@/features/integrations/components/watch-row"
import { api } from "@/shared/api/commands"
import { Section } from "@/shared/components/section"
import { SettingGroup, SettingRow } from "@/shared/components/setting-row"
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
  const watchedCount = watchAll ? known.length : known.filter((k) => watch.includes(k.key)).length

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
      title="MCP 감시"
      description={`켠 항목만 위젯의 끊김 개수에 들어갑니다 · ${info}`}
      className={className}
      action={
        <Button variant="secondary" size="sm" disabled={checking} onClick={() => api.recheck()}>
          <RefreshCw className={checking ? "animate-spin" : undefined} /> 지금 확인
        </Button>
      }
    >
      <SettingGroup>
        <SettingRow title="전체 감시" description="새로 추가되는 항목도 자동으로 포함">
          <Switch checked={watchAll} onCheckedChange={(on) => api.setWatch(on ? null : known.map((k) => k.key))} />
        </SettingRow>
      </SettingGroup>
      {known.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-[11.5px]">
            {known.length}개 중 {watchedCount}개 감시
          </span>
          <div className="flex gap-1">
            {/* 지금 있는 항목만 켬. 새 항목까지 자동 포함은 위의 "전체 감시"가 담당 */}
            <Button
              variant="ghost"
              size="xs"
              disabled={watchedCount === known.length}
              onClick={() => api.setWatch(known.map((k) => k.key))}
            >
              모두 켜기
            </Button>
            {/* "전체 감시"가 켜져 있어도 함께 꺼서 한 번에 모두 끔 */}
            <Button variant="ghost" size="xs" disabled={watchedCount === 0} onClick={() => api.setWatch([])}>
              모두 끄기
            </Button>
          </div>
        </div>
      )}
      <div className="bg-card divide-y overflow-x-hidden rounded-[10px] border">
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
