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

  const lastUsed = p.lastUsage?.session ? ` · 마지막 세션 사용 ${Math.round(p.lastUsage.session.used)}%` : ""

  return (
    <div
      className={cn(
        "bg-card rounded-[14px] border p-4",
        active && "border-primary ring-primary/15 ring-[3px]",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3.5">
        <ProfileAvatar profile={p} className="size-[52px]" />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <ProfileLabelInput profile={p} />
          <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
            <span className="truncate">{p.email}</span>
            {active && <Badge className="bg-primary/15 font-normal text-[#9dbdf7]">사용 중</Badge>}
          </div>
          <div className="text-muted-foreground truncate text-xs">
            {p.orgName}
            {p.plan && ` · ${p.plan}`}
            {lastUsed}
          </div>
        </div>
        <div className="grid w-[76px] shrink-0 gap-1.5">
          <Button disabled={active || switchAccount.isPending} onClick={() => switchAccount.mutate(p.id)}>
            {active ? "사용 중" : "전환"}
          </Button>
          <Button variant="destructive" disabled={active || remove.isPending} onClick={onRemove}>
            삭제
          </Button>
        </div>
      </div>
      {p.refreshExpired && (
        <p className="text-warning mt-2.5 text-xs">저장된 로그인이 만료됐습니다. 이 계정으로 다시 로그인해 주세요.</p>
      )}
      <AvatarPicker profile={p} className="mt-3.5 border-t pt-3.5" />
    </div>
  )
}
