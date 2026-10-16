import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

type Props = {
  title: string
  /** 제목 오른쪽 버튼 영역 */
  action?: ReactNode
  description?: ReactNode
  className?: string
  children: ReactNode
}

/** 설정 화면의 섹션 (제목 + 우측 액션 + 본문) */
export function Section({ title, action, description, className, children }: Props) {
  return (
    <section className={cn("grid gap-3", className)}>
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {action}
      </div>
      {description && <p className="text-muted-foreground -mt-1 text-xs">{description}</p>}
      {children}
    </section>
  )
}
