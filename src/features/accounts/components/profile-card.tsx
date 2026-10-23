import { Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AvatarPicker } from "@/features/accounts/components/avatar-picker"
import { ProfileLabelInput } from "@/features/accounts/components/profile-label-input"
import { useConfirm } from "@/hooks/use-confirm"
import { cn } from "@/lib/utils"
import { useRemoveProfile, useSwitchAccount } from "@/shared/api/mutations"
import { ProfileAvatar } from "@/shared/components/profile-avatar"
import type { Profile } from "@/shared/types"

type Props = {
  profile: Profile
  active: boolean
  className?: string
}

/** 계정 카드: 아바타 · 이름 · 세션 사용량 · 전환/삭제 + 아래에 아바타 선택 */
export function ProfileCard({ profile: p, active, className }: Props) {
  const confirm = useConfirm()
  const switchAccount = useSwitchAccount()
  const remove = useRemoveProfile()

  const onRemove = async () => {
    const ok = await confirm(
      `${p.email} 계정을 삭제할까요?`,
      "위젯에서만 지워집니다. 다시 쓰려면 이 계정으로 다시 로그인해야 합니다.",
    )
    if (ok) remove.mutate(p.id)
  }

  const used = p.lastUsage?.session ? Math.round(p.lastUsage.session.used) : null
  const checkedAt = p.lastUsageAt ? new Date(p.lastUsageAt).toLocaleString() : null

  return (
    <div
      className={cn(
        "bg-card rounded-[10px] border px-3.5 py-3",
        active && "border-primary ring-primary/15 ring-[3px]",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <ProfileAvatar profile={p} className="size-9 shrink-0" />
        <div className="grid min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <ProfileLabelInput profile={p} className="field-sizing-content w-auto max-w-full min-w-0 text-[12.5px]" />
            {active && <Badge className="bg-primary/15 text-primary shrink-0 font-semibold">사용 중</Badge>}
          </div>
          <div className="text-muted-foreground truncate text-[11px]">
            {p.email}
            {p.plan && ` · ${p.plan}`}
          </div>
          {p.refreshExpired && (
            <div className="text-destructive mt-0.5 text-[11px]">로그인이 만료됐어요 · 다시 로그인해 주세요</div>
          )}
        </div>
        <div
          className="w-[84px] shrink-0"
          title={checkedAt ? `세션 사용량 · ${checkedAt} 확인` : "세션 사용량 · 아직 확인하지 않음"}
        >
          <div className="text-muted-foreground flex justify-between text-[10.5px]">
            <span>세션</span>
            <span className="tabular-nums">{used === null ? "—" : `${used}%`}</span>
          </div>
          <div className="bg-foreground/8 mt-1 h-1 overflow-hidden rounded-full">
            <i className="bg-primary block h-full rounded-full" style={{ width: `${used ?? 0}%` }} />
          </div>
        </div>
        <Button
          size="sm"
          variant={active ? "secondary" : "default"}
          disabled={active || switchAccount.isPending}
          onClick={() => switchAccount.mutate(p.id)}
        >
          전환
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title="삭제"
          className="text-muted-foreground hover:text-destructive"
          disabled={active || remove.isPending}
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </div>
      <AvatarPicker profile={p} className="mt-3 border-t pt-3" />
    </div>
  )
}
