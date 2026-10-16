// Rust 백엔드(build_state, catalog)가 보내는 JSON 구조 — 백엔드를 바꾸면 여기부터 고친다

export type UsageWindow = { used: number; resetsAt: string | null }
export type Usage = { session: UsageWindow | null; weekly: UsageWindow | null }
export type UsageSource = "live" | "cache" | "stored"

export type AvatarKey = "a1" | "a2" | "a3" | "a4" | "a5" | "custom"

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

export type AppState = {
  profiles: Profile[]
  activeId: string | null
  loggedIn: boolean
  usage: Usage | null
  usageSource: UsageSource | null
  usageError: string | null
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
  mini: boolean
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
