import { cn } from "@/lib/utils"
import { ProfileAvatar } from "@/shared/components/profile-avatar"
import { usageTone } from "@/shared/lib/format"
import type { Profile } from "@/shared/types"

const RING = 2 * Math.PI * 34 // viewBox 76 기준 둘레
const RING_TONE = { success: "stroke-success", warning: "stroke-warning", destructive: "stroke-destructive" }

type Props = {
  profile: Profile | undefined
  /** 세션 사용률 0~100 */
  used: number
  brokenCount: number
  onClick: () => void
  className?: string
}

/** 미니 모드: 아바타 + 세션 사용량 링 + 끊김 뱃지 */
export function MiniBubble({ profile, used, brokenCount, onClick, className }: Props) {
  return (
    <div onClick={onClick} className={cn("relative size-[60px] cursor-pointer", className)}>
      <svg viewBox="0 0 76 76" className="absolute inset-[3px] size-[54px] -rotate-90">
        <circle cx="38" cy="38" r="34" className="fill-widget stroke-white/12" strokeWidth={5} />
        <circle
          cx="38"
          cy="38"
          r="34"
          fill="none"
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={RING}
          strokeDashoffset={RING * (1 - used / 100)}
          className={cn("transition-[stroke-dashoffset] duration-400", RING_TONE[usageTone(used)])}
        />
      </svg>
      <ProfileAvatar profile={profile} className="absolute inset-[10px] size-10" />
      {brokenCount > 0 && (
        <span className="bg-destructive border-widget absolute top-px right-px h-5 min-w-5 rounded-full border-2 px-1 text-center text-[11px] leading-4 font-bold text-white">
          {brokenCount}
        </span>
      )}
    </div>
  )
}
