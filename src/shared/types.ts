import type { SpriteKey } from "@/shared/lib/pixel-sprites"

// Rust 백엔드(build_state, catalog)가 보내는 JSON 구조 — 백엔드를 바꾸면 여기부터 고친다

export type UsageWindow = { used: number; resetsAt: string | null }
export type Usage = { session: UsageWindow | null; weekly: UsageWindow | null }
export type UsageSource = "live" | "cache" | "stored"

/** 도트 캐릭터 키(pixel-sprites.ts의 SPRITES) 또는 업로드 이미지 */
export type AvatarKey = SpriteKey | "custom"

export type Profile = {
  id: string
  email: string
  displayName: string
  orgName: string
  plan: string
  refreshExpiresAt: number | null
  refreshExpired: boolean
  avatar: AvatarKey
  customAvatar: string | null
  label: string
  lastUsage: Usage | null
}

export type ProfilePatch = Partial<Pick<Profile, "avatar" | "customAvatar" | "label">>

/** 위젯 고정 위치. "" = 자유(드래그한 곳) */
export type WidgetAnchor = "" | "tl" | "tr" | "bl" | "br"

export type IntegrationKind = "mcp" | "plugin"
/** missing: 예전에 있었는데 현재 계정에 없음 */
export type IntegrationStatus = "ok" | "auth" | "fail" | "off" | "missing"

export type Integration = {
  key: string
  type: IntegrationKind
  name: string
  status?: IntegrationStatus
  statusText?: string
}

export type Skill = { name: string; description: string }

export type UpdateInfo = {
  /** 지금 실행 중인 버전 */
  current: string
  /** 새 버전. null이면 최신 */
  available: { version: string; notes: string | null; date: string | null } | null
  checking: boolean
  installing: boolean
  /** 다운로드 진행률 0~100 */
  progress: number | null
  error: string | null
  checkedAt: number | null
}

export type AppState = {
  profiles: Profile[]
  activeId: string | null
  loggedIn: boolean
  usage: Usage | null
  usageSource: UsageSource | null
  usageError: string | null
  /** 토큰이 서버에서 거부됨 — 다시 로그인 필요 */
  authProblem: string | null
  integrations: {
    checking: boolean
    checkedAt: number | null
    error: string | null
    total: number
    broken: Integration[]
    items: Integration[]
    known: Integration[]
    watch: string[] | null
  }
  skills: { local: Skill[]; synced: Skill[] }
  plugins: Integration[]
  mcpIntervalMin: number
  autoStart: boolean
  avatarMotion: boolean
  anchor: WidgetAnchor
  /** 사용량이 switchPromptAt% 넘으면 Claude Code 세션 안에서 계정 전환을 물어봄 */
  switchPrompt: boolean
  switchPromptAt: number
  mini: boolean
  update: UpdateInfo
}

export type CatalogItem = {
  id: string
  name: string
  description: string
  marketplace: string
  version: string
  url: string
  installed: boolean
  enabled: boolean
}

export type Marketplace = { name: string; repo: string; source: string }

export type Catalog = {
  items: CatalogItem[]
  marketplaces?: Marketplace[]
  fetchedAt?: number
  error?: string | null
  loading?: boolean
}

export type PluginAction = "uninstall" | "enable" | "disable"
export type MarketplaceAction = "add" | "remove"
