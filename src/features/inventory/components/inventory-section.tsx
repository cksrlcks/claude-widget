import { Store } from "lucide-react"

import { Button } from "@/components/ui/button"
import { InventoryGroup } from "@/features/inventory/components/inventory-group"
import { api } from "@/shared/api/commands"
import { Section } from "@/shared/components/section"
import type { AppState } from "@/shared/types"

type Props = {
  state: AppState
  className?: string
}

export function InventorySection({ state, className }: Props) {
  const plugins = state.plugins.map((p) => ({
    name: p.name,
    description: "",
    warning: p.status === "ok" ? undefined : p.statusText,
  }))

  return (
    <Section
      title="설치된 스킬 · 플러그인"
      className={className}
      action={
        <Button variant="secondary" size="sm" onClick={() => api.openStore()}>
          <Store /> 플러그인 스토어 열기
        </Button>
      }
    >
      <div className="grid gap-2">
        <InventoryGroup title="내 스킬" hint="~/.claude/skills · 모든 계정 공통" items={state.skills.local} />
        <InventoryGroup title="계정 동기화 스킬" hint="현재 계정에서 내려받은 스킬" items={state.skills.synced} />
        <InventoryGroup title="플러그인" hint="claude plugin list" items={plugins} />
      </div>
    </Section>
  )
}
