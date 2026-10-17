import { Maximize2 } from "lucide-react"

import { statusDotClass } from "@/features/widget/components/integration-status"
import { cn } from "@/lib/utils"
import { ProfileAvatar } from "@/shared/components/profile-avatar"
import type { AppState, Profile } from "@/shared/types"

type Props = {
  profile: Profile | undefined
  integrations: AppState["integrations"]
  onExpand: () => void
  className?: string
}

/**
 * 미니 모드: 둥근 아바타 + 귀퉁이 MCP·플러그인 상태등(색만). 마우스를 올리면 확장 버튼.
 * 창이 투명이라 원 밖(귀퉁이) 요소도 보임. 상태등은 오른쪽 아래, 펼치기 버튼은 오른쪽 위
 */
export function MiniBubble({ profile, integrations, onExpand, className }: Props) {
  return (
    <div className={cn("group relative size-[60px]", className)}>
      <ProfileAvatar profile={profile} animated className="absolute top-1 left-1 size-[52px] ring-2 ring-white/10" />
      <span
        className={cn(
          "border-widget absolute right-1.5 bottom-1.5 size-3.5 rounded-full border-2",
          statusDotClass(integrations),
        )}
      />
      <button
        type="button"
        title="펼치기"
        onClick={onExpand}
        className="bg-widget text-foreground hover:bg-primary border-widget absolute top-1 right-1 hidden size-[18px] cursor-pointer place-items-center rounded-full border-2 group-hover:grid"
      >
        <Maximize2 className="size-2.5" />
      </button>
    </div>
  )
}
