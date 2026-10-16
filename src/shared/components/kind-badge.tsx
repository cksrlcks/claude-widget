import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { IntegrationKindLabel } from "@/shared/lib/format"

const KIND: Record<IntegrationKindLabel, { label: string; className: string }> = {
  connector: { label: "커넥터", className: "bg-primary/15 text-[#9dbdf7]" },
  local: { label: "로컬 MCP", className: "bg-success/15 text-[#8fe0b2]" },
  plugin: { label: "플러그인", className: "bg-[#aa82f0]/15 text-[#cdb3f5]" },
}

type Props = {
  kind: IntegrationKindLabel
  className?: string
}

export function KindBadge({ kind, className }: Props) {
  return (
    <Badge variant="secondary" className={cn("font-normal", KIND[kind].className, className)}>
      {KIND[kind].label}
    </Badge>
  )
}
