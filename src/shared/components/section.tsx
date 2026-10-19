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

/** 설정 화면의 한 페이지 (제목·설명 + 우측 액션 + 본문) */
export function Section({ title, action, description, className, children }: Props) {
  return (
    <section className={cn("grid gap-3", className)}>
      <div className="mb-1 flex min-h-8 items-center justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {description && <p className="text-muted-foreground truncate text-[11.5px]">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}
