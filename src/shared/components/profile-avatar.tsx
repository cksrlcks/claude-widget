import { cn } from "@/lib/utils"
import { SPRITES, type SpriteKey } from "@/shared/lib/pixel-sprites"
import type { Profile } from "@/shared/types"

/** 선택 목록용: [key, 이름] */
export const AVATARS = (Object.keys(SPRITES) as SpriteKey[]).map((key) => ({ key, name: SPRITES[key].name }))

const isSpriteKey = (k: string | undefined): k is SpriteKey => !!k && k in SPRITES

type PixelAvatarProps = {
  avatarKey: SpriteKey
  /** 캐릭터별 모션 + 눈 깜빡임 (index.css의 px-* 애니메이션) */
  animated?: boolean
  className?: string
}

const UNIT = 4 // 64x64 viewBox에서 픽셀 한 칸 크기

export function PixelAvatar({ avatarKey, animated = false, className }: PixelAvatarProps) {
  const sprite = SPRITES[avatarKey]
  const { rows, palette, bg } = sprite
  const fixed = new Set("fixedRows" in sprite ? sprite.fixedRows : [])
  const ox = (64 - rows[0].length * UNIT) / 2
  const oy = (64 - rows.length * UNIT) / 2

  // 같은 색끼리 묶어 <g fill>로 그림. moving=true면 모션이 적용되는 줄만
  const layer = (moving: boolean, onlyEyes: boolean) =>
    Object.entries(palette)
      .filter(([ch]) => (ch === "e") === onlyEyes)
      .map(([ch, color]) => (
        <g key={ch} fill={color}>
          {rows.flatMap((row, y) =>
            fixed.has(y) === moving
              ? []
              : [...row].map((c, x) =>
                  c === ch ? (
                    <rect key={`${x}-${y}`} x={ox + x * UNIT} y={oy + y * UNIT} width={UNIT} height={UNIT} />
                  ) : null,
                ),
          )}
        </g>
      ))

  return (
    <svg viewBox="0 0 64 64" shapeRendering="crispEdges" className={cn("block size-full", className)}>
      <rect width="64" height="64" fill={bg} />
      {layer(false, false)}
      <g className={animated ? `px-${sprite.motion}` : undefined}>
        {layer(true, false)}
        <g className={animated ? "px-blink" : undefined}>{layer(true, true)}</g>
      </g>
    </svg>
  )
}

type ProfileAvatarProps = {
  profile?: Pick<Profile, "avatar" | "customAvatar"> | null
  animated?: boolean
  className?: string
}

/** 원형 아바타. 업로드한 이미지가 있으면 그 이미지(GIF면 움직임), 없으면 도트 캐릭터 */
export function ProfileAvatar({ profile, animated, className }: ProfileAvatarProps) {
  return (
    <div className={cn("shrink-0 overflow-hidden rounded-full", className)}>
      {profile?.avatar === "custom" && profile.customAvatar ? (
        <img src={profile.customAvatar} alt="" className="size-full object-cover" />
      ) : (
        <PixelAvatar avatarKey={isSpriteKey(profile?.avatar) ? profile.avatar : "a1"} animated={animated} />
      )}
    </div>
  )
}
