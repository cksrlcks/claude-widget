import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ProfileCard } from "@/features/accounts/components/profile-card"
import { api } from "@/shared/api/commands"
import { Section } from "@/shared/components/section"
import type { AppState } from "@/shared/types"

type Props = {
  state: AppState
  className?: string
}

export function AccountSection({ state, className }: Props) {
  return (
    <Section
      title="계정"
      className={className}
      action={
        <Button variant="secondary" onClick={() => api.loginNew()}>
          <Plus /> 다른 계정 로그인
        </Button>
      }
    >
      {state.profiles.length ? (
        <div className="grid gap-3">
          {state.profiles.map((p) => (
            <ProfileCard key={p.id} profile={p} active={p.id === state.activeId} />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground px-3 py-2.5">
          로그인된 계정이 없습니다. “다른 계정 로그인”으로 로그인하세요.
        </p>
      )}
    </Section>
  )
}
