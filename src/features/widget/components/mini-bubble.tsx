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

/** 미니 모드: 둥근 아바타 + 귀퉁이 MCP·플러그인 상태등(색만). 마우스를 올리면 확장 버튼 */
export function MiniBubble({ profile, integrations, onExpand, className }: Props) {
  return (
    <div className={cn("group relative grid size-[60px] place-items-center", className)}>
      <ProfileAvatar profile={profile} className="size-11 ring-2 ring-white/10" />
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
        className="bg-widget/90 text-foreground hover:bg-primary absolute top-1 right-1 hidden size-5 cursor-pointer place-items-center rounded-full ring-1 ring-white/15 group-hover:grid"
      >
        <Maximize2 className="size-3" />
      </button>
    </div>
  )
}
