import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { api } from "@/shared/api/commands"
import { Section } from "@/shared/components/section"
import { SettingGroup, SettingRow } from "@/shared/components/setting-row"
import { getTheme, setTheme, type Theme } from "@/shared/lib/theme"
import type { AppState, WidgetAnchor } from "@/shared/types"

// 2×2 모서리 선택기 순서 (왼쪽 위 → 오른쪽 아래)
const CORNERS: { value: Exclude<WidgetAnchor, "">; label: string }[] = [
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

  const [promptAt, setPromptAt] = useState(String(state.switchPromptAt))
  useEffect(() => setPromptAt(String(state.switchPromptAt)), [state.switchPromptAt])

  const [theme, setThemeState] = useState<Theme>(getTheme)
  const changeTheme = (t: Theme) => {
    setTheme(t)
    setThemeState(t)
  }

  const saveSwitchPrompt = async (on: boolean, at: number) => {
    try {
      await api.setSwitchPrompt(on, at)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }
  const savePromptAt = () => {
    const at = Math.max(50, Math.min(100, Number(promptAt) || 90))
    if (at !== state.switchPromptAt) saveSwitchPrompt(state.switchPrompt, at)
    else setPromptAt(String(at))
  }

  const saveInterval = () => {
    const min = Math.max(1, Math.min(120, Number(interval) || 10))
    if (min !== state.mcpIntervalMin) api.setInterval(min)
    else setIntervalText(String(min))
  }

  return (
    <Section title="일반" description="위젯 동작과 알림" className={className}>
      <SettingGroup label="화면">
        <SettingRow title="테마" description="위젯과 설정 창에 함께 적용됩니다">
          <Segmented
            value={theme}
            options={[
              { value: "light", label: "라이트" },
              { value: "dark", label: "다크" },
            ]}
            onChange={changeTheme}
          />
        </SettingRow>
        <SettingRow title="위젯 위치" description="모서리에 고정하거나 드래그한 곳에 둡니다">
          <Segmented
            value={state.anchor ? "corner" : "free"}
            options={[
              { value: "free", label: "자유" },
              { value: "corner", label: "모서리" },
            ]}
            onChange={(v) => api.setAnchor(v === "free" ? "" : state.anchor || "br")}
          />
          <div className="bg-background grid h-[38px] w-[54px] grid-cols-2 gap-[3px] rounded-md border p-[3px]">
            {CORNERS.map((c) => (
              <button
                key={c.value}
                type="button"
                title={c.label}
                aria-pressed={state.anchor === c.value}
                onClick={() => api.setAnchor(c.value)}
                className={cn(
                  "bg-foreground/10 hover:bg-foreground/20 cursor-pointer rounded-[3px]",
                  state.anchor === c.value && "bg-primary hover:bg-primary",
                )}
              />
            ))}
          </div>
        </SettingRow>
        <SettingRow title="아바타 움직임" description="도트 캐릭터가 가끔 움직입니다">
          <Switch checked={state.avatarMotion} onCheckedChange={api.setAvatarMotion} />
        </SettingRow>
        <SettingRow title="Windows 시작 시 실행">
          <Switch checked={state.autoStart} onCheckedChange={api.setAutoStart} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup label="사용량" className="mt-3">
        <SettingRow
          title="한도 가까우면 계정 전환 물어보기"
          description="Claude Code 세션 안에서 다른 계정으로 바꿀지 묻습니다"
        >
          <Switch checked={state.switchPrompt} onCheckedChange={(on) => saveSwitchPrompt(on, state.switchPromptAt)} />
        </SettingRow>
        <SettingRow title="기준" description="세션 또는 주간 사용량이 이 값을 넘으면">
          <UnitInput
            value={promptAt}
            unit="%"
            min={50}
            max={100}
            disabled={!state.switchPrompt}
            onChange={setPromptAt}
            onCommit={savePromptAt}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup label="MCP" className="mt-3">
        <SettingRow title="자동 확인 간격">
          <UnitInput value={interval} unit="분" min={1} max={120} onChange={setIntervalText} onCommit={saveInterval} />
        </SettingRow>
      </SettingGroup>
    </Section>
  )
}

type SegmentedProps<T extends string> = {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}

function Segmented<T extends string>({ value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="bg-background inline-flex rounded-lg border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "text-muted-foreground cursor-pointer rounded-md px-2.5 py-1 text-[11.5px]",
            value === o.value && "bg-secondary text-foreground font-medium",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

type UnitInputProps = {
  value: string
  unit: string
  min: number
  max: number
  disabled?: boolean
  onChange: (value: string) => void
  onCommit: () => void
}

function UnitInput({ value, unit, min, max, disabled, onChange, onCommit }: UnitInputProps) {
  return (
    <label className={cn("flex items-center gap-1.5", disabled && "opacity-50")}>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="h-7 w-14 text-right tabular-nums"
      />
      <span className="text-muted-foreground text-xs">{unit}</span>
    </label>
  )
}
