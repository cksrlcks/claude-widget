import { Plus, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ProfileCard } from "@/features/accounts/components/profile-card"
import { api } from "@/shared/api/commands"
import { useRefreshUsage } from "@/shared/api/mutations"
import { Section } from "@/shared/components/section"
import { SettingGroup, SettingRow } from "@/shared/components/setting-row"
import type { AppState } from "@/shared/types"

type Props = {
  state: AppState
  className?: string
}

export function AccountSection({ state, className }: Props) {
  const refresh = useRefreshUsage()
  return (
    <Section
      title="계정"
      description="계정을 저장해 두고 클릭 한 번으로 전환합니다"
      className={className}
      action={
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon-sm"
            title="모든 계정의 사용량 다시 확인"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            <RefreshCw className={refresh.isPending ? "animate-spin" : undefined} />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => api.loginNew()}>
            <Plus /> 계정 추가
          </Button>
        </div>
      }
    >
      {state.profiles.length ? (
        <div className="grid gap-2">
          {state.profiles.map((p) => (
            <ProfileCard key={p.id} profile={p} active={p.id === state.activeId} />
          ))}
        </div>
      ) : (
        <SettingGroup>
          <SettingRow title="로그인된 계정이 없습니다" description="“계정 추가”로 로그인하세요" />
        </SettingGroup>
      )}
      <p className="text-muted-foreground px-0.5 text-[11px] leading-relaxed">
        전환하면 MCP·플러그인·settings는 그대로, 계정 정보만 바뀝니다. 실행 중인 Claude Code 세션은 다시 시작해야
        적용됩니다.
      </p>
    </Section>
  )
}
