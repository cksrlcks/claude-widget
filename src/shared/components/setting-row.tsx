import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

type GroupProps = {
  /** 묶음 위 작은 제목 */
  label?: string
  className?: string
  children: ReactNode
}

/** 설정 행 묶음 (테두리 카드 + 행 사이 구분선) */
export function SettingGroup({ label, className, children }: GroupProps) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      {label && <div className="text-muted-foreground px-0.5 text-[11px] font-medium">{label}</div>}
      <div className="bg-card divide-y rounded-[10px] border">{children}</div>
    </div>
  )
}

type RowProps = {
  title: ReactNode
  description?: ReactNode
  className?: string
  /** 오른쪽 컨트롤 */
  children?: ReactNode
}

/** 왼쪽 제목·설명, 오른쪽 컨트롤 */
export function SettingRow({ title, description, className, children }: RowProps) {
  return (
    <div className={cn("flex min-h-12 items-center gap-3 px-3.5 py-2.5", className)}>
      <div className="grid min-w-0 gap-0.5">
        <div className="font-medium">{title}</div>
        {description && <div className="text-muted-foreground text-[11px] leading-snug">{description}</div>}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}
