import { Download, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useConfirm } from "@/hooks/use-confirm"
import { cn } from "@/lib/utils"
import { api } from "@/shared/api/commands"
import { Section } from "@/shared/components/section"
import type { UpdateInfo } from "@/shared/types"

type Props = {
  update: UpdateInfo
  className?: string
}

// updater 플러그인의 영어 오류를 사용자용 문구로 (원문은 마우스를 올리면 보임)
function friendlyError(error: string) {
  if (/valid release JSON|404/i.test(error)) return "배포된 업데이트 정보를 찾지 못했습니다"
  if (/signature/i.test(error)) return "업데이트 서명을 확인하지 못했습니다"
  if (/network|dns|connect|timed out/i.test(error)) return "네트워크에 연결하지 못했습니다"
  return error
}

/** 현재 버전, 새 버전 확인·설치. 설치하면 앱이 잠깐 종료됐다가 새 버전으로 다시 실행됨 */
export function UpdateSection({ update: u, className }: Props) {
  const confirm = useConfirm()

  const install = async () => {
    if (!u.available) return
    const ok = await confirm(
      `v${u.available.version}로 업데이트할까요?`,
      "다운로드가 끝나면 위젯이 잠깐 종료됐다가 새 버전으로 다시 실행됩니다.",
      "나중에",
      "업데이트",
    )
    if (ok) api.installUpdate()
  }

  const status = u.installing
    ? `다운로드 중… ${u.progress ?? 0}%`
    : u.checking
      ? "확인 중…"
      : u.error
        ? `확인 실패: ${friendlyError(u.error)}`
        : u.available
          ? `새 버전 v${u.available.version}이 있습니다`
          : u.checkedAt
            ? `최신 버전입니다 · ${new Date(u.checkedAt).toLocaleString()} 확인`
            : "아직 확인하지 않았습니다"

  return (
    <Section title="업데이트" className={className}>
      <div className="bg-card grid gap-3 rounded-[14px] border p-4">
        <div className="flex items-center gap-3">
          <div className="grid min-w-0 flex-1 gap-0.5">
            <div className="font-semibold">
              현재 버전 v{u.current}
              {u.available && <span className="text-primary ml-2 font-normal">→ v{u.available.version}</span>}
            </div>
            <div
              title={u.error ?? undefined}
              className={cn("text-muted-foreground truncate text-xs", u.error && "text-destructive")}
            >
              {status}
            </div>
          </div>
          {u.available ? (
            <Button disabled={u.installing} onClick={install}>
              <Download /> 업데이트
            </Button>
          ) : (
            <Button variant="secondary" disabled={u.checking || u.installing} onClick={() => api.checkUpdate()}>
              <RefreshCw className={u.checking ? "animate-spin" : undefined} /> 업데이트 확인
            </Button>
          )}
        </div>
        {u.installing && (
          <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
            <i
              className="bg-primary block h-full rounded-full transition-all"
              style={{ width: `${u.progress ?? 0}%` }}
            />
          </div>
        )}
        {u.available?.notes && !u.installing && (
          <p className="text-muted-foreground border-t pt-3 text-xs whitespace-pre-wrap">{u.available.notes}</p>
        )}
      </div>
    </Section>
  )
}
