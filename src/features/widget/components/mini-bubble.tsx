import { Maximize2 } from "lucide-react"

import { statusDotClass } from "@/features/widget/components/integration-status"
import { cn } from "@/lib/utils"
import { ProfileAvatar } from "@/shared/components/profile-avatar"
import { usageTone } from "@/shared/lib/format"
import type { AppState, Profile, UsageWindow } from "@/shared/types"

const RING_TONE = { success: "stroke-success", warning: "stroke-warning", destructive: "stroke-destructive" }
const R = 27 // 60px 창 안의 링 반지름 (선 두께 3)
const CIRC = 2 * Math.PI * R

type Props = {
  profile: Profile | undefined
  integrations: AppState["integrations"]
  /** 링으로 표시할 세션 사용량 (펼친 모드 막대처럼 쓴 만큼 참). 없으면 링 없이 아바타만 */
  session: UsageWindow | null
  onExpand: () => void
  animated: boolean
  className?: string
}

/**
 * 미니 모드: 둥근 아바타 + 둘레 링(세션 사용량) + 귀퉁이 MCP·플러그인 상태등. 마우스를 올리면 확장 버튼.
 * 창이 투명이라 원 밖(귀퉁이) 요소도 보임. 상태등은 오른쪽 아래, 펼치기 버튼은 오른쪽 위
 */
export function MiniBubble({ profile, integrations, session, onExpand, animated, className }: Props) {
  const used = session ? Math.min(100, Math.max(0, session.used)) : null

  return (
    <div
      className={cn("group relative size-[60px]", className)}
      title={used === null ? undefined : `세션 ${Math.round(used)}% 사용 · ${Math.round(100 - used)}% 남음`}
    >
      <svg viewBox="0 0 60 60" className="absolute inset-0 size-full -rotate-90">
        <circle cx="30" cy="30" r={R} fill="var(--widget)" className="stroke-foreground/10" strokeWidth="3" />
        {used !== null && (
          <circle
            cx="30"
            cy="30"
            r={R}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${(CIRC * used) / 100} ${CIRC}`}
            className={cn("transition-all duration-400", RING_TONE[usageTone(used)])}
          />
        )}
      </svg>
      <ProfileAvatar profile={profile} animated={animated} className="absolute top-[7px] left-[7px] size-[46px]" />
      <span
        className={cn(
          "border-widget absolute right-1 bottom-1 size-3.5 rounded-full border-2",
          statusDotClass(integrations),
        )}
      />
      <button
        type="button"
        title="펼치기"
        onClick={onExpand}
        className="bg-widget text-foreground hover:bg-primary border-widget absolute top-0.5 right-0.5 hidden size-[18px] cursor-pointer place-items-center rounded-full border-2 group-hover:grid"
      >
        <Maximize2 className="size-2.5" />
      </button>
    </div>
  )
}
