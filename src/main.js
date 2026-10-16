const path = require("path")
const { spawn } = require("child_process")
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, screen, shell } = require("electron")
const claude = require("./lib/claude")

// productName("Claude Widget")과 무관하게 기존 데이터 폴더(%APPDATA%/claude-widget) 유지
app.setPath("userData", path.join(app.getPath("appData"), "claude-widget"))

if (!app.requestSingleInstanceLock()) app.quit()

// store는 app.getPath를 쓰므로 ready 이후 로드
let store
let widget = null
let settingsWin = null
let tray = null
let mini = false
let fullHeight = 212

const SIZE = { full: { w: 252, h: 230 }, mini: { w: 76, h: 76 } }
const AVATAR_KEYS = ["a1", "a2", "a3", "a4", "a5"]

const runtime = {
  activeId: null,
  loggedIn: false,
  usage: null,
  usageSource: null, // live | cache | stored
  usageError: null,
  usageFetchedAt: 0,
  integrations: null,
  checking: false,
}

// ---------- 상태 ----------

// 같은 이름의 로컬 MCP가 있으면 claude.ai 커넥터는 중복이므로 목록에서 제외
function visibleKnown() {
  const { lastIntegrations, knownIntegrations } = store.get()
  const locals = new Set(
    (lastIntegrations?.items ?? [])
      .filter((i) => i.type === "mcp" && !i.name.startsWith("claude.ai "))
      .map((i) => i.name.toLowerCase())
  )
  return knownIntegrations.filter((k) => !(k.name.startsWith("claude.ai ") && locals.has(k.name.slice(10).toLowerCase())))
}

function watchedItems() {
  const { watch, lastIntegrations } = store.get()
  if (!lastIntegrations) return []
  const current = new Map(lastIntegrations.items.map((i) => [i.key, i]))
  // 예전에 발견됐는데 지금 계정 목록에 없는 항목도 "끊어짐"으로 포함
  return visibleKnown()
    .filter((k) => !watch || watch.includes(k.key))
    .map((k) => current.get(k.key) ?? { ...k, status: "missing", statusText: "현재 계정에 없음" })
}

function buildState() {
  const s = store.get()
  const items = watchedItems()
  const broken = items.filter((i) => i.status !== "ok" && i.status !== "off")
  return {
    profiles: s.profiles.map((p) => ({ ...p, refreshExpired: p.refreshExpiresAt ? p.refreshExpiresAt < Date.now() : false })),
    activeId: runtime.activeId,
    loggedIn: runtime.loggedIn,
    usage: runtime.usage,
    usageSource: runtime.usageSource,
    usageError: runtime.usageError,
    integrations: {
      checking: runtime.checking,
      checkedAt: s.lastIntegrations?.checkedAt ?? null,
      error: s.lastIntegrations?.error ?? null,
      total: items.length,
      broken,
      items: s.lastIntegrations?.items ?? [],
      known: visibleKnown(),
      watch: s.watch,
    },
    skills: claude.listSkills(runtime.orgId, runtime.activeId),
    plugins: (s.lastIntegrations?.items ?? []).filter((i) => i.type === "plugin"),
    mcpIntervalMin: s.mcpIntervalMin,
    autoStart: app.getLoginItemSettings().openAtLogin,
    mini,
  }
}

function broadcast() {
  const state = buildState()
  for (const w of [widget, settingsWin]) if (w && !w.isDestroyed()) w.webContents.send("state", state)
  updateTray(state)
}

function profileMetaFromAuth(auth, existing) {
  const a = auth.oauthAccount
  const usedAvatars = store.get().profiles.map((p) => p.avatar)
  return {
    id: auth.accountUuid,
    email: a.emailAddress,
    displayName: a.displayName || a.fullName || a.emailAddress,
    orgName: a.organizationName ?? "",
    plan: auth.oauth.subscriptionType ?? "",
    refreshExpiresAt: auth.oauth.refreshTokenExpiresAt ?? null,
    avatar: existing?.avatar ?? AVATAR_KEYS.find((k) => !usedAvatars.includes(k)) ?? "a1",
    customAvatar: existing?.customAvatar ?? null,
    label: existing?.label ?? "",
    lastUsage: existing?.lastUsage ?? null,
  }
}

// 현재 로그인 계정을 읽어 프로필과 동기화. 토큰이 갱신(회전)됐을 수 있어 매번 덮어쓴다
function syncLiveAuth() {
  const live = claude.readLiveAuth()
  runtime.loggedIn = !!live
  runtime.activeId = live?.accountUuid ?? null
  runtime.orgId = live?.oauthAccount?.organizationUuid ?? live?.organizationUuid ?? null
  if (!live) return null

  const profiles = store.get().profiles
  const existing = profiles.find((p) => p.id === live.accountUuid)
  const meta = profileMetaFromAuth(live, existing)
  store.saveSecret(live.accountUuid, {
    accountUuid: live.accountUuid,
    oauth: live.oauth,
    organizationUuid: live.organizationUuid,
    oauthAccount: live.oauthAccount,
  })
  store.update({
    profiles: existing ? profiles.map((p) => (p.id === meta.id ? meta : p)) : [...profiles, meta],
  })
  return live
}

async function refreshStatus({ forceUsage = false } = {}) {
  const live = syncLiveAuth()
  if (!live) {
    runtime.usage = null
    runtime.usageSource = null
    return broadcast()
  }

  const stale = Date.now() - runtime.usageFetchedAt > 3 * 60_000
  if (forceUsage || stale || runtime.usageSource !== "live") {
    const expired = live.oauth.expiresAt && live.oauth.expiresAt < Date.now()
    try {
      if (expired) throw new Error("토큰 만료 (Claude Code 실행 시 자동 갱신)")
      runtime.usage = claude.summarizeUsage(await claude.fetchUsage(live.oauth.accessToken))
      runtime.usageSource = "live"
      runtime.usageError = null
      runtime.usageFetchedAt = Date.now()
    } catch (err) {
      runtime.usageError = err instanceof Error ? err.message : "사용량 조회 실패"
      const cached = live.cachedUsage
      if (cached?.accountUuid === live.accountUuid) {
        runtime.usage = claude.summarizeUsage(cached.utilization)
        runtime.usageSource = "cache"
      } else {
        const p = store.get().profiles.find((x) => x.id === live.accountUuid)
        runtime.usage = p?.lastUsage ?? null
        runtime.usageSource = runtime.usage ? "stored" : null
      }
    }
  }

  if (runtime.usage) {
    store.update({
      profiles: store.get().profiles.map((p) => (p.id === live.accountUuid ? { ...p, lastUsage: runtime.usage } : p)),
    })
  }
  broadcast()
}

async function checkIntegrations() {
  if (runtime.checking) return
  runtime.checking = true
  broadcast()
  try {
    const result = await claude.checkIntegrations()
    const known = new Map(store.get().knownIntegrations.map((i) => [i.key, i]))
    for (const i of result.items) known.set(i.key, { key: i.key, type: i.type, name: i.name })
    store.update({ lastIntegrations: result, knownIntegrations: [...known.values()] })
  } finally {
    runtime.checking = false
    broadcast()
  }
}

// ---------- 계정 전환 ----------

async function switchAccount(id) {
  if (id === runtime.activeId) return true
  const target = store.loadSecret(id)
  const meta = store.get().profiles.find((p) => p.id === id)
  if (!target || !meta) {
    dialog.showErrorBox("전환 실패", "저장된 계정 정보가 없습니다. 해당 계정으로 다시 로그인해 주세요.")
    return false
  }

  const procs = await claude.listClaudeProcesses()
  if (procs > 0) {
    const parent = settingsWin && !settingsWin.isDestroyed() && settingsWin.isVisible() ? settingsWin : widget
    const { response } = await dialog.showMessageBox(parent, {
      type: "warning",
      buttons: ["전환", "취소"],
      defaultId: 0,
      cancelId: 1,
      title: "계정 전환",
      message: `${meta.email} 계정으로 전환할까요?`,
      detail: `실행 중인 Claude Code 세션이 ${procs}개 있습니다.\n이미 열린 세션은 재시작해야 새 계정이 적용됩니다.`,
    })
    if (response !== 0) return false
  }

  syncLiveAuth() // 현재 계정의 최신 토큰을 먼저 저장
  claude.backupLiveFiles(store.BACKUP_DIR)
  claude.applyAuth(target)
  runtime.usageFetchedAt = 0
  await refreshStatus({ forceUsage: true })
  checkIntegrations()
  return true
}

function loginNewAccount() {
  syncLiveAuth()
  claude.backupLiveFiles(store.BACKUP_DIR)
  spawn("cmd.exe", ["/c", "start", '"Claude Login"', "cmd", "/k", "claude auth login"], {
    detached: true,
    windowsVerbatimArguments: true,
  }).unref()
  // 로그인 완료를 빠르게 감지하기 위해 3분간 5초 간격 확인
  let n = 0
  const t = setInterval(() => {
    const before = runtime.activeId
    refreshStatus()
    if (++n > 36 || (runtime.activeId && runtime.activeId !== before)) {
      clearInterval(t)
      checkIntegrations()
    }
  }, 5000)
}

// 인증 필요한 MCP를 터미널에서 순서대로 로그인 (브라우저 열림) → 창 닫히면 다시 확인
// 보이는 터미널 창에서 명령 실행 (프롬프트·브라우저 인증 대응), 창이 닫히면 onExit
function runInTerminal(title, command, onExit) {
  const script = `${command} & echo. & echo Done. Press any key to close. & pause >nul`
  spawn("cmd.exe", ["/c", "start", `"${title}"`, "/wait", "cmd", "/c", `"${script}"`], {
    windowsVerbatimArguments: true,
  }).on("exit", () => onExit?.())
}

function mcpLogin(names) {
  const safe = names.filter((n) => /^[\w .:@/-]+$/.test(n))
  if (!safe.length) return
  const steps = safe.map((n) => `echo. & echo === ${n} === & claude mcp login "${n}"`).join(" & ")
  runInTerminal("MCP Login", steps, () => checkIntegrations())
}

// ---------- 플러그인 스토어 ----------

let storeWin = null
let catalog = null // { items, fetchedAt, error, loading }

async function loadCatalog() {
  if (catalog?.loading) return
  catalog = { ...(catalog ?? { items: [] }), loading: true, error: null }
  sendCatalog()
  try {
    const [items, marketplaces] = await Promise.all([claude.listPluginCatalog(), claude.listMarketplaces()])
    catalog = { items, marketplaces, fetchedAt: Date.now(), error: null, loading: false }
  } catch (err) {
    catalog = { ...catalog, loading: false, error: err instanceof Error ? err.message : "목록을 불러오지 못했습니다" }
  }
  sendCatalog()
}

function sendCatalog() {
  if (storeWin && !storeWin.isDestroyed()) storeWin.webContents.send("catalog", catalog)
}

function afterPluginChange() {
  loadCatalog()
  checkIntegrations()
}

function installPlugin(id) {
  if (!/^[\w.@-]+$/.test(id)) return
  runInTerminal("Plugin Install", `claude plugin install ${id}`, afterPluginChange)
}

async function pluginAction(action, id) {
  try {
    await claude.pluginAction(action, id)
  } finally {
    afterPluginChange()
  }
}

function openStore() {
  if (storeWin && !storeWin.isDestroyed()) return bringToFront(storeWin)
  storeWin = new BrowserWindow({
    width: 760,
    height: 760,
    minWidth: 520,
    title: "플러그인 스토어",
    autoHideMenuBar: true,
    backgroundColor: "#131417",
    show: false,
    icon: APP_ICON,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  })
  storeWin.loadFile(path.join(__dirname, "renderer", "store.html"))
  storeWin.once("ready-to-show", () => bringToFront(storeWin))
  if (!catalog?.items?.length) loadCatalog()
}

function removeProfile(id) {
  if (id === runtime.activeId) return false
  store.deleteSecret(id)
  store.update({ profiles: store.get().profiles.filter((p) => p.id !== id) })
  broadcast()
  return true
}

function updateProfile(id, patch) {
  const allowed = ["avatar", "customAvatar", "label"]
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)))
  store.update({ profiles: store.get().profiles.map((p) => (p.id === id ? { ...p, ...clean } : p)) })
  broadcast()
}

// ---------- 창 ----------

function placeWidget() {
  const size = mini ? SIZE.mini : { w: SIZE.full.w, h: fullHeight }
  const pos = store.get().position
  const { workArea } = pos
    ? screen.getDisplayNearestPoint({ x: Math.round(pos.right - 1), y: Math.round(pos.y) })
    : screen.getPrimaryDisplay()
  // 저장된 위치는 오른쪽 끝 기준으로 저장 → 미니/확장 전환 시 오른쪽 정렬 유지
  let right = pos?.right ?? workArea.x + workArea.width - 16
  let y = pos?.y ?? workArea.y + Math.round(workArea.height * 0.3)
  // 화면 밖으로 잘리지 않게 작업 영역 안으로 보정
  right = Math.min(Math.max(right, workArea.x + size.w), workArea.x + workArea.width)
  y = Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - size.h)
  widget.setBounds({ x: Math.round(right - size.w), y: Math.round(y), width: size.w, height: size.h })
}

function createWidget() {
  widget = new BrowserWindow({
    width: SIZE.full.w,
    height: SIZE.full.h,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    icon: APP_ICON,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  })
  // "screen-saver" 레벨: 테두리 없는 전체화면 게임/앱 위에도 표시
  widget.setAlwaysOnTop(true, "screen-saver")
  widget.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  widget.loadFile(path.join(__dirname, "renderer", "widget.html"))
  placeWidget()
  widget.once("ready-to-show", () => widget.showInactive())
}

// 위젯은 포커스를 받지 않는 창이라 Windows가 새 창을 뒤로 보냄 → 잠깐 최상위로 올려 앞으로 꺼냄
function bringToFront(win) {
  if (win.isMinimized()) win.restore()
  win.setAlwaysOnTop(true, "screen-saver")
  win.show()
  win.moveTop()
  win.focus()
  setTimeout(() => !win.isDestroyed() && win.setAlwaysOnTop(false), 300)
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) return bringToFront(settingsWin)
  settingsWin = new BrowserWindow({
    width: 560,
    height: 720,
    minWidth: 480,
    title: "Claude 위젯 설정",
    autoHideMenuBar: true,
    backgroundColor: "#131417",
    show: false,
    icon: APP_ICON,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  })
  settingsWin.loadFile(path.join(__dirname, "renderer", "settings.html"))
  settingsWin.once("ready-to-show", () => bringToFront(settingsWin))
}

// 아이콘 파일은 scripts/make-icons.js로 생성
const ASSETS = path.join(__dirname, "..", "assets")
const APP_ICON = path.join(ASSETS, "icon.ico")

// tray.png 옆의 tray@2x.png를 Electron이 고배율 화면용으로 자동 사용
function makeTrayIcon() {
  return nativeImage.createFromPath(path.join(ASSETS, "tray.png"))
}

function accountMenuItems(state = buildState()) {
  return state.profiles.map((p) => ({
    label: `${p.label || p.displayName}  (${p.email})`,
    type: "radio",
    checked: p.id === state.activeId,
    click: () => switchAccount(p.id),
  }))
}

function updateTray(state) {
  if (!tray) return
  const active = state.profiles.find((p) => p.id === state.activeId)
  const used = state.usage?.session ? `${Math.round(state.usage.session.used)}%` : "-"
  tray.setToolTip(`Claude: ${active?.email ?? "로그인 안 됨"}\n세션 사용 ${used} · 끊김 ${state.integrations.broken.length}`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...accountMenuItems(state),
      { type: "separator" },
      { label: "위젯 보이기/숨기기", click: () => (widget.isVisible() ? widget.hide() : widget.showInactive()) },
      { label: "MCP 상태 다시 확인", click: () => checkIntegrations() },
      { label: "플러그인 스토어", click: openStore },
      { label: "설정", click: openSettings },
      { type: "separator" },
      { label: "종료", click: () => app.quit() },
    ])
  )
}

// ---------- IPC ----------

let drag = null
ipcMain.on("drag-start", (_e, { x, y }) => {
  const [wx, wy] = widget.getPosition()
  drag = { dx: x - wx, dy: y - wy }
})
ipcMain.on("drag-move", (_e, { x, y }) => {
  if (!drag) return
  const size = widget.getSize()
  widget.setBounds({ x: x - drag.dx, y: y - drag.dy, width: size[0], height: size[1] })
})
ipcMain.on("drag-end", () => {
  if (!drag) return
  drag = null
  const b = widget.getBounds()
  store.update({ position: { right: b.x + b.width, y: b.y } })
  placeWidget() // 화면 밖에 놓으면 안쪽으로 당겨옴
})

ipcMain.handle("get-state", () => buildState())
ipcMain.handle("refresh", async () => {
  await refreshStatus({ forceUsage: true })
  checkIntegrations()
})
ipcMain.handle("check-integrations", () => checkIntegrations())
ipcMain.handle("open-settings", () => openSettings())
ipcMain.handle("switch-account", (_e, id) => switchAccount(id))
ipcMain.handle("login-new", () => loginNewAccount())
ipcMain.handle("mcp-login", (_e, names) => mcpLogin(Array.isArray(names) ? names : [names]))
ipcMain.handle("open-connectors", () => shell.openExternal("https://claude.ai/customize/connectors"))
ipcMain.handle("open-store", () => openStore())
ipcMain.handle("store-catalog", () => catalog)
ipcMain.handle("store-reload", () => loadCatalog())
ipcMain.handle("store-install", (_e, id) => installPlugin(id))
ipcMain.handle("store-action", (_e, action, id) => pluginAction(action, id))
// 에러는 throw 대신 { error }로 돌려줘 화면에 메시지를 그대로 표시
ipcMain.handle("store-marketplace", async (_e, action, value) => {
  try {
    await claude.marketplaceAction(action, value)
    await loadCatalog()
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "작업에 실패했습니다" }
  }
})
ipcMain.handle("open-url", (_e, url) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url)
})
ipcMain.handle("remove-profile", (_e, id) => removeProfile(id))
ipcMain.handle("update-profile", (_e, id, patch) => updateProfile(id, patch))
ipcMain.handle("set-watch", (_e, keys) => {
  store.update({ watch: keys })
  broadcast()
})
ipcMain.handle("set-interval", (_e, min) => {
  store.update({ mcpIntervalMin: Math.max(1, Number(min) || 10) })
  scheduleIntegrations()
  broadcast()
})
ipcMain.handle("set-auto-start", (_e, on) => {
  app.setLoginItemSettings({
    openAtLogin: !!on,
    path: process.execPath,
    args: app.isPackaged ? [] : [path.resolve(app.getAppPath())],
  })
  broadcast()
})
ipcMain.handle("set-mini", (_e, value) => {
  mini = !!value
  placeWidget()
  broadcast()
})
ipcMain.handle("set-height", (_e, h) => {
  fullHeight = Math.min(420, Math.max(120, Math.round(h)))
  if (!mini) placeWidget()
})
ipcMain.handle("account-menu", () => {
  Menu.buildFromTemplate([
    ...accountMenuItems(),
    { type: "separator" },
    { label: "MCP 상태 다시 확인", click: () => checkIntegrations() },
    { label: "플러그인 스토어", click: openStore },
    { label: "설정", click: openSettings },
    { label: "위젯 숨기기 (트레이에서 다시 열기)", click: () => widget.hide() },
    { label: "종료", click: () => app.quit() },
  ]).popup({ window: widget })
})

// ---------- 시작 ----------

let integrationTimer = null
function scheduleIntegrations() {
  clearInterval(integrationTimer)
  integrationTimer = setInterval(checkIntegrations, store.get().mcpIntervalMin * 60_000)
}

app.on("second-instance", () => widget?.showInactive())
app.on("window-all-closed", (e) => e.preventDefault?.())

app.whenReady().then(() => {
  app.setAppUserModelId("claude-widget")
  store = require("./lib/store")
  createWidget()
  tray = new Tray(makeTrayIcon())
  tray.on("click", () => (widget.isVisible() ? widget.hide() : widget.showInactive()))
  refreshStatus({ forceUsage: true })
  checkIntegrations()
  setInterval(() => refreshStatus(), 60_000)
  // 다른 최상위 창(게임 등)에 밀려 가려지는 경우 주기적으로 다시 위로
  setInterval(() => {
    if (widget && !widget.isDestroyed() && widget.isVisible()) widget.moveTop()
  }, 5_000)
  scheduleIntegrations()
  screen.on("display-metrics-changed", placeWidget)
})
