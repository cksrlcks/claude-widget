import { useState } from "react"
import { ChevronRight } from "lucide-react"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

export type InventoryItem = {
  name: string
  description: string
  /** 정상이 아닐 때만 표시 (예: 꺼짐) */
  warning?: string
}

type Props = {
  title: string
  hint: string
  items: InventoryItem[]
  className?: string
}

/** 접었다 펼 수 있는 스킬·플러그인 묶음 */
export function InventoryGroup({ title, hint, items, className }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn("bg-card overflow-hidden rounded-[10px] border", className)}
    >
      <CollapsibleTrigger className="hover:bg-foreground/[0.03] flex h-[42px] w-full cursor-pointer items-center gap-2.5 px-3.5 text-left">
        <ChevronRight className={cn("text-muted-foreground size-3.5 transition-transform", open && "rotate-90")} />
        <span>{title}</span>
        <span className="text-muted-foreground bg-foreground/7 rounded-full px-2 text-[11px] tabular-nums">
          {items.length}
        </span>
        <span className="text-muted-foreground ml-auto min-w-0 truncate text-[11px]">{hint}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {items.length ? (
          items.map((i) => (
            <div
              key={i.name}
              title={i.description}
              className="flex min-w-0 items-baseline gap-2.5 border-t py-2 pr-3.5 pl-[34px]"
            >
              <span className="shrink-0 font-medium">{i.name}</span>
              {i.warning && <span className="text-muted-foreground shrink-0 text-[11.5px]">{i.warning}</span>}
              <span className="text-muted-foreground min-w-0 truncate text-xs">{i.description}</span>
            </div>
          ))
        ) : (
          <p className="text-muted-foreground border-t py-2.5 pl-[34px]">없음</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
