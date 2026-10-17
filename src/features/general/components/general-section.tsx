import { useEffect, useState } from "react"

import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { api } from "@/shared/api/commands"
import { Section } from "@/shared/components/section"
import type { AppState } from "@/shared/types"

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
