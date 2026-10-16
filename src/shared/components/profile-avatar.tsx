import { cn } from "@/lib/utils"
import type { AvatarKey, Profile } from "@/shared/types"

// Claude Code 마스코트(Clawd) 12x6 픽셀: # 몸통, e 눈, . 빈칸
const CLAWD = ["..########..", "..##e##e##..", ".##########.", "..########..", "..#.#..#.#..", "..#.#..#.#.."]

export const AVATARS: { key: Exclude<AvatarKey, "custom">; name: string; color: string; bg: string }[] = [
  { key: "a1", name: "오렌지", color: "#d97757", bg: "#3a2620" },
  { key: "a2", name: "블루", color: "#5b8def", bg: "#1f2a40" },
  { key: "a3", name: "그린", color: "#4fbf7f", bg: "#1d3328" },
  { key: "a4", name: "퍼플", color: "#9b7be8", bg: "#2b2340" },
  { key: "a5", name: "핑크", color: "#e8739b", bg: "#3d2230" },
]

type ClawdProps = {
  avatarKey: Exclude<AvatarKey, "custom">
  className?: string
}

export function Clawd({ avatarKey, className }: ClawdProps) {
  const { color, bg } = AVATARS.find((a) => a.key === avatarKey) ?? AVATARS[0]
  const unit = 4
  const ox = (64 - 12 * unit) / 2
  const oy = (64 - CLAWD.length * unit) / 2 + 2
  return (
    <svg viewBox="0 0 64 64" shapeRendering="crispEdges" className={cn("block size-full", className)}>
      <rect width="64" height="64" fill={bg} />
      {CLAWD.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === "." ? null : (
            <rect
              key={`${x}-${y}`}
              x={ox + x * unit}
              y={oy + y * unit}
              width={unit}
              height={unit}
              fill={c === "e" ? "#18181b" : color}
            />
          ),
        ),
      )}
    </svg>
  )
}

type ProfileAvatarProps = {
  profile?: Pick<Profile, "avatar" | "customAvatar"> | null
  className?: string
}

/** 원형 아바타. 업로드한 이미지가 있으면 그 이미지, 없으면 Clawd */
export function ProfileAvatar({ profile, className }: ProfileAvatarProps) {
  return (
    <div className={cn("shrink-0 overflow-hidden rounded-full", className)}>
      {profile?.avatar === "custom" && profile.customAvatar ? (
        <img src={profile.customAvatar} alt="" className="size-full object-cover" />
      ) : (
        <Clawd avatarKey={profile?.avatar && profile.avatar !== "custom" ? profile.avatar : "a1"} />
      )}
    </div>
  )
}
