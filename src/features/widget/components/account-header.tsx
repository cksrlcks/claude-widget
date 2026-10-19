import { ArrowUpCircle, Minimize2, Settings } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { api } from "@/shared/api/commands"
import { ProfileAvatar } from "@/shared/components/profile-avatar"
import type { Profile } from "@/shared/types"

type Props = {
  profile: Profile | undefined
  onMinimize: () => void
  /** 아바타 애니메이션 (설정 > 아바타 움직임) */
  animated: boolean
  /** 새 버전이 있으면 그 버전 — 업데이트 아이콘 표시 */
  updateVersion?: string
  className?: string
}

export function AccountHeader({ profile, onMinimize, animated, updateVersion, className }: Props) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <ProfileAvatar profile={profile} animated={animated} className="ring-foreground/10 size-[34px] ring-2" />
      <div className="grid min-w-0 flex-1 gap-px">
        <div className="truncate text-[13.5px] font-semibold">
          {profile ? profile.label || profile.displayName : "로그인 안 됨"}
        </div>
        <div className="text-muted-foreground truncate text-[11px]">
          {profile ? `${profile.email}${profile.plan ? ` · ${profile.plan}` : ""}` : "설정에서 로그인하세요"}
        </div>
      </div>
      <div className="-mr-1 flex shrink-0 items-center">
        {updateVersion && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-primary"
            title={`새 버전 v${updateVersion} — 설정에서 업데이트`}
            onClick={() => api.openSettings()}
          >
            <ArrowUpCircle />
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" title="미니 모드" onClick={onMinimize}>
          <Minimize2 />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          title="설정 / 계정 전환"
          onClick={() => api.openSettings()}
        >
          <Settings />
        </Button>
      </div>
    </div>
  )
}
