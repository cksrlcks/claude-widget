// 위젯 데이터 저장소 (%APPDATA%/claude-widget)
// - store.json: 프로필 메타(이메일, 아바타 등), 감시 목록, 위젯 위치
// - secrets/<accountUuid>.bin: 계정 토큰 (Windows DPAPI로 암호화)
const fs = require("fs")
const path = require("path")
const { app, safeStorage } = require("electron")

const DIR = app.getPath("userData")
const STORE_PATH = path.join(DIR, "store.json")
const SECRET_DIR = path.join(DIR, "secrets")
const BACKUP_DIR = path.join(DIR, "backups")

const DEFAULTS = {
  profiles: [], // { id, email, displayName, orgName, plan, avatar, customAvatar, label, lastUsage }
  watch: null, // 감시할 MCP/플러그인 key 배열. null이면 전체 감시
  knownIntegrations: [], // 마지막으로 발견된 MCP/플러그인 목록 (설정 화면용)
  lastIntegrations: null,
  position: null,
  mcpIntervalMin: 10,
}

let state = load()

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(STORE_PATH, "utf8")) }
  } catch {
    return { ...DEFAULTS }
  }
}

function save() {
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2), "utf8")
}

function get() {
  return state
}

function update(patch) {
  state = { ...state, ...patch }
  save()
  return state
}

function secretPath(id) {
  return path.join(SECRET_DIR, `${id.replace(/[^a-zA-Z0-9-]/g, "")}.bin`)
}

function saveSecret(id, data) {
  fs.mkdirSync(SECRET_DIR, { recursive: true })
  const buf = safeStorage.encryptString(JSON.stringify(data))
  fs.writeFileSync(secretPath(id), buf)
}

function loadSecret(id) {
  const file = secretPath(id)
  if (!fs.existsSync(file)) return null
  return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)))
}

function deleteSecret(id) {
  fs.rmSync(secretPath(id), { force: true })
}

module.exports = { BACKUP_DIR, get, update, saveSecret, loadSecret, deleteSecret }
