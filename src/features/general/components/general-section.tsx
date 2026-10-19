import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { api } from "@/shared/api/commands"
import { Section } from "@/shared/components/section"
import type { AppState, WidgetAnchor } from "@/shared/types"

const ANCHORS: { value: WidgetAnchor; label: string }[] = [
  { value: "", label: "자유" },
  { value: "tl", label: "왼쪽 위" },
  { value: "tr", label: "오른쪽 위" },
  { value: "bl", label: "왼쪽 아래" },
  { value: "br", label: "오른쪽 아래" },
]

type Props = {
  state: AppState
  className?: string
}

export function GeneralSection({ state, className }: Props) {
  const [interval, setIntervalText] = useState(String(state.mcpIntervalMin))
  useEffect(() => setIntervalText(String(state.mcpIntervalMin)), [state.mcpIntervalMin])

  const saveInterval = () => {
    const min = Math.max(1, Math.min(120, Number(interval) || 10))
    if (min !== state.mcpIntervalMin) api.setInterval(min)
    else setIntervalText(String(min))
  }

  return (
    <Section title="일반" className={className}>
      <label className="flex items-center gap-2.5">
        MCP 자동 확인 간격
        <Input
          type="number"
          min={1}
          max={120}
          value={interval}
          onChange={(e) => setIntervalText(e.target.value)}
          onBlur={saveInterval}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="w-16"
        />
        분
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1">위젯 위치</span>
        {ANCHORS.map((a) => (
          <Button
            key={a.value}
            size="xs"
            variant={state.anchor === a.value ? "default" : "outline"}
            aria-pressed={state.anchor === a.value}
            onClick={() => api.setAnchor(a.value)}
          >
            {a.label}
          </Button>
        ))}
      </div>
      <label className="flex w-fit cursor-pointer items-center gap-2.5">
        <Checkbox checked={state.autoStart} onCheckedChange={(v) => api.setAutoStart(v === true)} />
        Windows 시작 시 자동 실행
      </label>
      <label className="flex w-fit cursor-pointer items-center gap-2.5">
        <Checkbox checked={state.avatarMotion} onCheckedChange={(v) => api.setAvatarMotion(v === true)} />
        아바타 움직임
      </label>
    </Section>
  )
}
