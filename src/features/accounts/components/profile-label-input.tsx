import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"
import { useUpdateProfile } from "@/shared/api/mutations"
import type { Profile } from "@/shared/types"

type Props = {
  profile: Profile
  className?: string
}

/** 계정 표시 이름. 평소엔 글자처럼 보이고 마우스를 올리면 입력칸 테두리가 보임. 포커스를 잃거나 Enter면 저장 */
export function ProfileLabelInput({ profile, className }: Props) {
  const update = useUpdateProfile()
  const [value, setValue] = useState(profile.label)
  useEffect(() => setValue(profile.label), [profile.label])

  const save = () => {
    const label = value.trim()
    if (label !== profile.label) update.mutate({ id: profile.id, patch: { label } })
  }

  return (
    <input
      value={value}
      placeholder={`${profile.displayName} (이름 지정)`}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className={cn(
        "placeholder:text-foreground/90 hover:border-border focus:border-primary focus:bg-background -ml-[7px] w-full rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-semibold outline-none",
        className,
      )}
    />
  )
}
