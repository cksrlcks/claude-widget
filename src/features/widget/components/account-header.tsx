import { Settings } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { api } from "@/shared/api/commands"
import { ProfileAvatar } from "@/shared/components/profile-avatar"
import type { Profile } from "@/shared/types"

type Props = {
  profile: Profile | undefined
  onAvatarClick: () => void
  className?: string
}

export function AccountHeader({ profile, onAvatarClick, className }: Props) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <button type="button" onClick={onAvatarClick} title="미니 모드" className="cursor-pointer">
        <ProfileAvatar profile={profile} className="size-[34px] ring-2 ring-white/10" />
      </button>
      <div className="grid min-w-0 flex-1 gap-px">
        <div className="truncate text-[13.5px] font-semibold">
          {profile ? profile.label || profile.displayName : "로그인 안 됨"}
        </div>
        <div className="text-muted-foreground truncate text-[11px]">
          {profile ? `${profile.email}${profile.plan ? ` · ${profile.plan}` : ""}` : "설정에서 로그인하세요"}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground -mr-1"
        title="설정 / 계정 전환"
        onClick={() => api.openSettings()}
      >
        <Settings />
      </Button>
    </div>
  )
}
