// Tauri 백엔드 호출 래퍼 — 화면 코드는 window.api만 사용
const { invoke } = window.__TAURI__.core
const { listen } = window.__TAURI__.event

window.api = {
  onState: (cb) => listen("state", (e) => cb(e.payload)),
  getState: () => invoke("get_state"),
  refresh: () => invoke("refresh"),
  checkIntegrations: () => invoke("recheck"),
  openSettings: () => invoke("open_settings_cmd"),
  openStore: () => invoke("open_store_cmd"),
  switchAccount: (id) => invoke("switch_account_cmd", { id }),
  loginNew: () => invoke("login_new"),
  mcpLogin: (names) => invoke("mcp_login", { names }),
  openConnectors: () => invoke("open_connectors"),
  openUrl: (url) => invoke("open_url", { url }),
  removeProfile: (id) => invoke("remove_profile", { id }),
  updateProfile: (id, patch) => invoke("update_profile", { id, patch }),
  setWatch: (keys) => invoke("set_watch", { keys }),
  setInterval: (min) => invoke("set_interval", { min: Number(min) }),
  setAutoStart: (on) => invoke("set_auto_start", { on }),
  setMini: (value) => invoke("set_mini", { value }),
  setHeight: (h) => invoke("set_height", { h }),
  accountMenu: () => invoke("account_menu"),
  startDrag: () => window.__TAURI__.window.getCurrentWindow().startDragging(),
  onCatalog: (cb) => listen("catalog", (e) => cb(e.payload)),
  getCatalog: () => invoke("store_catalog"),
  reloadCatalog: () => invoke("store_reload"),
  installPlugin: (id) => invoke("store_install", { id }),
  pluginAction: (action, id) => invoke("store_action", { action, id }),
  marketplaceAction: (action, value) => invoke("store_marketplace", { action, value }),
}
