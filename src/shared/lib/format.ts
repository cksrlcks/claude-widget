import type { Integration, IntegrationStatus } from "@/shared/types"

/** 사용률에 따른 색 (70% 이상 노랑, 90% 이상 빨강) */
export function usageTone(used: number): "success" | "warning" | "destructive" {
  if (used >= 90) return "destructive"
  if (used >= 70) return "warning"
  return "success"
}

export function formatReset(iso: string | null): string {
  if (!iso) return ""
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return "곧 초기화"
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h >= 24) return `${Math.floor(h / 24)}일 ${h % 24}시간 후 초기화`
  return h > 0 ? `${h}시간 ${m}분 후 초기화` : `${m}분 후 초기화`
}

export type IntegrationKindLabel = "connector" | "local" | "plugin"

const CONNECTOR_PREFIX = "claude.ai "

/** claude.ai 커넥터 / 로컬 MCP / 플러그인 구분 */
export function kindOf(i: Pick<Integration, "type" | "name">): IntegrationKindLabel {
  if (i.type === "plugin") return "plugin"
  return i.name.startsWith(CONNECTOR_PREFIX) ? "connector" : "local"
}

/** 커넥터는 배지가 종류를 알려주므로 "claude.ai " 접두어를 뗀다 */
export function displayName(i: Pick<Integration, "type" | "name">): string {
  return kindOf(i) === "connector" ? i.name.slice(CONNECTOR_PREFIX.length) : i.name
}

export const STATUS_LABEL: Record<IntegrationStatus, string> = {
  ok: "정상",
  fail: "연결 실패",
  auth: "인증 필요",
  off: "비활성",
  missing: "현재 계정에 없음",
}
