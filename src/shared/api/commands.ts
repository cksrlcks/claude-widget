// Tauri 명령 호출 — 화면 코드는 invoke를 직접 쓰지 않고 여기 함수만 사용
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"

import type { AppState, Catalog, MarketplaceAction, PluginAction, ProfilePatch, WidgetAnchor } from "@/shared/types"

export const api = {
  // 상태
  getState: () => invoke<AppState>("get_state"),
  refresh: () => invoke<void>("refresh"),
  recheck: () => invoke<void>("recheck"),

  // 창
  openSettings: () => invoke<void>("open_settings_cmd"),
  openStore: () => invoke<void>("open_store_cmd"),
  openConnectors: () => invoke<void>("open_connectors"),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  accountMenu: () => invoke<void>("account_menu"),
  setMini: (value: boolean) => invoke<void>("set_mini", { value }),
  setHeight: (h: number) => invoke<void>("set_height", { h }),
  startDrag: () => getCurrentWindow().startDragging(),

  // 계정
  switchAccount: (id: string) => invoke<boolean>("switch_account_cmd", { id }),
  loginNew: () => invoke<void>("login_new"),
  removeProfile: (id: string) => invoke<boolean>("remove_profile", { id }),
  updateProfile: (id: string, patch: ProfilePatch) => invoke<void>("update_profile", { id, patch }),

  // MCP·감시
  mcpLogin: (names: string[]) => invoke<void>("mcp_login", { names }),
  setWatch: (keys: string[] | null) => invoke<void>("set_watch", { keys }),
  setInterval: (min: number) => invoke<void>("set_interval", { min }),
  setAutoStart: (on: boolean) => invoke<void>("set_auto_start", { on }),
  setAvatarMotion: (on: boolean) => invoke<void>("set_avatar_motion", { on }),
  setAnchor: (anchor: WidgetAnchor) => invoke<void>("set_anchor", { anchor }),
  setSwitchPrompt: (on: boolean, at: number) => invoke<void>("set_switch_prompt", { on, at }),

  // 앱 업데이트
  checkUpdate: () => invoke<void>("check_update_cmd"),
  installUpdate: () => invoke<void>("install_update_cmd"),

  // 플러그인 스토어
  getCatalog: () => invoke<Catalog>("store_catalog"),
  reloadCatalog: () => invoke<void>("store_reload"),
  installPlugin: (id: string) => invoke<void>("store_install", { id }),
  pluginAction: (action: PluginAction, id: string) => invoke<void>("store_action", { action, id }),
  marketplaceAction: (action: MarketplaceAction, value: string) =>
    invoke<{ ok?: boolean; error?: string }>("store_marketplace", { action, value }),
}
