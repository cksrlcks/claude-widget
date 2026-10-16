import { useRef } from "react"
import { Plus } from "lucide-react"

import { resizeToDataUrl } from "@/features/accounts/lib/resize-image"
import { cn } from "@/lib/utils"
import { useUpdateProfile } from "@/shared/api/mutations"
import { AVATARS, Clawd } from "@/shared/components/profile-avatar"
import type { Profile } from "@/shared/types"

type Props = {
  profile: Profile
  className?: string
}

/** 기본 Clawd 5색 + 업로드한 이미지 중 선택 */
export function AvatarPicker({ profile, className }: Props) {
  const update = useUpdateProfile()
  const fileRef = useRef<HTMLInputElement>(null)

  const pick = (avatar: Profile["avatar"]) => update.mutate({ id: profile.id, patch: { avatar } })

  const upload = async (file: File | undefined) => {
    if (!file) return
    const customAvatar = await resizeToDataUrl(file)
    update.mutate({ id: profile.id, patch: { avatar: "custom", customAvatar } })
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {AVATARS.map((a) => (
        <PickButton key={a.key} title={a.name} selected={profile.avatar === a.key} onClick={() => pick(a.key)}>
          <Clawd avatarKey={a.key} />
        </PickButton>
      ))}
      {profile.customAvatar && (
        <PickButton title="내 이미지" selected={profile.avatar === "custom"} onClick={() => pick("custom")}>
          <img src={profile.customAvatar} alt="" className="size-full object-cover" />
        </PickButton>
      )}
      <button
        type="button"
        title="내 이미지 업로드"
        onClick={() => fileRef.current?.click()}
        className="text-muted-foreground border-border-strong hover:text-foreground grid size-[34px] cursor-pointer place-items-center rounded-full border border-dashed"
      >
        <Plus className="size-4" />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          upload(e.target.files?.[0])
          e.target.value = ""
        }}
      />
    </div>
  )
}

type PickButtonProps = {
  title: string
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}

function PickButton({ title, selected, onClick, children }: PickButtonProps) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "hover:border-border-strong size-[34px] cursor-pointer overflow-hidden rounded-full border-2 border-transparent",
        selected && "border-primary ring-primary/20 hover:border-primary ring-2",
      )}
    >
      {children}
    </button>
  )
}
