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
  /** 몸통 들썩임 + 눈 깜빡임 (index.css의 clawd-* 애니메이션) */
  animated?: boolean
  className?: string
}

const LEG_ROWS = 4 // 이 줄부터는 다리 — 몸통이 들썩여도 다리는 바닥에 붙어 있게 따로 그림

export function Clawd({ avatarKey, animated = false, className }: ClawdProps) {
  const { color, bg } = AVATARS.find((a) => a.key === avatarKey) ?? AVATARS[0]
  const unit = 4
  const ox = (64 - 12 * unit) / 2
  const oy = (64 - CLAWD.length * unit) / 2 + 2
  const pixels = (rows: number[], match: string) =>
    rows.flatMap((y) =>
      [...CLAWD[y]].map((c, x) =>
        c === match ? <rect key={`${x}-${y}`} x={ox + x * unit} y={oy + y * unit} width={unit} height={unit} /> : null,
      ),
    )
  const body = [0, 1, 2, 3]
  const legs = [LEG_ROWS, LEG_ROWS + 1]

  return (
    <svg viewBox="0 0 64 64" shapeRendering="crispEdges" className={cn("block size-full", className)}>
      <rect width="64" height="64" fill={bg} />
      <g fill={color}>{pixels(legs, "#")}</g>
      <g className={animated ? "clawd-bob" : undefined}>
        <g fill={color}>{pixels(body, "#")}</g>
        <g fill="#18181b" className={animated ? "clawd-blink" : undefined}>
          {pixels(body, "e")}
        </g>
      </g>
    </svg>
  )
}

type ProfileAvatarProps = {
  profile?: Pick<Profile, "avatar" | "customAvatar"> | null
  animated?: boolean
  className?: string
}

/** 원형 아바타. 업로드한 이미지가 있으면 그 이미지(GIF면 움직임), 없으면 Clawd */
export function ProfileAvatar({ profile, animated, className }: ProfileAvatarProps) {
  return (
    <div className={cn("shrink-0 overflow-hidden rounded-full", className)}>
      {profile?.avatar === "custom" && profile.customAvatar ? (
        <img src={profile.customAvatar} alt="" className="size-full object-cover" />
      ) : (
        <Clawd avatarKey={profile?.avatar && profile.avatar !== "custom" ? profile.avatar : "a1"} animated={animated} />
      )}
    </div>
  )
}
