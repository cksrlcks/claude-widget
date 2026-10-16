import { AccountHeader } from "@/features/widget/components/account-header"
import { BrokenList } from "@/features/widget/components/broken-list"
import { IntegrationStatus } from "@/features/widget/components/integration-status"
import { MiniBubble } from "@/features/widget/components/mini-bubble"
import { UsageMeter } from "@/features/widget/components/usage-meter"
import { useFitHeight } from "@/features/widget/hooks/use-fit-height"
import { useWindowDrag } from "@/features/widget/hooks/use-window-drag"
import { api } from "@/shared/api/commands"
import { useAppState } from "@/shared/api/queries"
import { useNow } from "@/shared/hooks/use-now"

export function WidgetPage() {
  const { data: s } = useAppState()
  const drag = useWindowDrag()
  const cardRef = useFitHeight<HTMLDivElement>(!!s && !s.mini)
  useNow() // 초기화까지 남은 시간 갱신

  if (!s) return null
  const profile = s.profiles.find((p) => p.id === s.activeId)

  return (
    <div
      {...drag}
      onContextMenu={(e) => {
        e.preventDefault()
        api.accountMenu()
      }}
      className="cursor-grab select-none"
    >
      {s.mini ? (
        <MiniBubble
          profile={profile}
          used={Math.min(100, Math.max(0, s.usage?.session?.used ?? 0))}
          brokenCount={s.integrations.broken.length}
          onClick={() => api.setMini(false)}
        />
      ) : (
        <div ref={cardRef} className="px-3.5 py-3">
          <AccountHeader profile={profile} onAvatarClick={() => api.setMini(true)} className="mb-2.5" />
          <UsageMeter
            label="세션 (5시간) 사용"
            window={s.usage?.session ?? null}
            source={s.usageSource}
            fallback={s.usage ? null : s.usageError}
          />
          <UsageMeter label="주간 사용" window={s.usage?.weekly ?? null} source={s.usageSource} className="mt-2" />
          <IntegrationStatus integrations={s.integrations} className="mt-2.5" />
          <BrokenList items={s.integrations.broken} className="mt-1.5" />
        </div>
      )}
    </div>
  )
}
