// Claude Code 로컬 설정(~/.claude) 읽기/쓰기 + 사용량/MCP 상태 조회
const fs = require("fs")
const os = require("os")
const path = require("path")
const { execFile } = require("child_process")

const HOME = os.homedir()
const CRED_PATH = path.join(HOME, ".claude", ".credentials.json")
const CONFIG_PATH = path.join(HOME, ".claude.json")

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"))
}

// 임시 파일에 쓰고 rename → 쓰는 도중 Claude Code가 읽어도 깨진 JSON을 보지 않게
function writeJsonAtomic(file, data) {
  const tmp = `${file}.widget-tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8")
  fs.renameSync(tmp, file)
}

// 현재 로그인 상태 스냅샷 (프로필 저장용)
function readLiveAuth() {
  let cred = null
  let config = null
  try { cred = readJson(CRED_PATH) } catch {}
  try { config = readJson(CONFIG_PATH) } catch {}
  const account = config?.oauthAccount ?? null
  if (!cred?.claudeAiOauth || !account?.accountUuid) return null
  return {
    accountUuid: account.accountUuid,
    oauth: cred.claudeAiOauth,
    organizationUuid: cred.organizationUuid ?? account.organizationUuid ?? null,
    oauthAccount: account,
    cachedUsage: config.cachedUsageUtilization ?? null,
  }
}

// 계정 정보만 교체하고 나머지 설정(mcpOAuth, projects, settings 등)은 그대로 유지
function applyAuth(auth) {
  const cred = fs.existsSync(CRED_PATH) ? readJson(CRED_PATH) : {}
  cred.claudeAiOauth = auth.oauth
  if (auth.organizationUuid) cred.organizationUuid = auth.organizationUuid
  else delete cred.organizationUuid
  writeJsonAtomic(CRED_PATH, cred)

  const config = readJson(CONFIG_PATH)
  config.oauthAccount = auth.oauthAccount
  writeJsonAtomic(CONFIG_PATH, config)
}

function backupLiveFiles(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  for (const f of [CRED_PATH, CONFIG_PATH]) {
    if (fs.existsSync(f)) fs.copyFileSync(f, path.join(dir, `${stamp}_${path.basename(f)}`))
  }
  // 최근 20개(10회분)만 유지
  const files = fs.readdirSync(dir).sort()
  for (const f of files.slice(0, Math.max(0, files.length - 20))) fs.rmSync(path.join(dir, f))
}

async function fetchUsage(accessToken) {
  const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
    },
  })
  if (!res.ok) throw new Error(`usage ${res.status}`)
  return res.json()
}

// 사용량 응답 → 위젯에서 쓰는 형태로 축약
function summarizeUsage(u) {
  if (!u) return null
  const pick = (w) => (w ? { used: w.utilization ?? 0, resetsAt: w.resets_at ?? null } : null)
  return { session: pick(u.five_hour), weekly: pick(u.seven_day) }
}

// strict: 종료 코드가 실패면 출력이 있어도 에러로 처리 (설치·추가 같은 작업용)
function runClaude(args, timeout = 90_000, strict = false) {
  return new Promise((resolve, reject) => {
    execFile(
      "claude",
      args,
      { cwd: HOME, timeout, windowsHide: true, shell: true, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && (strict || !stdout)) reject(new Error((stderr || stdout || err.message).trim()))
        else resolve(stdout)
      }
    )
  })
}

// "name: target - ✓ Connected" 형식 파싱
function parseMcpList(out) {
  const items = []
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim()
    const sep = line.indexOf(": ")
    const dash = line.lastIndexOf(" - ")
    if (sep < 1 || dash < sep) continue
    const name = line.slice(0, sep)
    const statusText = line.slice(dash + 3).replace(/^[^A-Za-z]+/, "").trim()
    let status = "fail"
    if (/connected/i.test(statusText) && !/fail|not/i.test(statusText)) status = "ok"
    else if (/auth/i.test(statusText)) status = "auth"
    else if (/pending|disabled/i.test(statusText)) status = "off"
    items.push({ key: `mcp:${name}`, type: "mcp", name, status, statusText })
  }
  return items
}

function parsePluginList(out) {
  let list = []
  try { list = JSON.parse(out) } catch { return [] }
  if (!Array.isArray(list)) list = list.plugins ?? []
  return list.map((p) => {
    const name = p.id ?? p.name ?? String(p)
    const errors = p.errors ?? p.loadErrors ?? (p.error ? [p.error] : [])
    let status = "ok"
    let statusText = "사용 중"
    if (errors?.length) { status = "fail"; statusText = String(errors[0]?.message ?? errors[0]) }
    else if (p.enabled === false) { status = "off"; statusText = "꺼짐" }
    return { key: `plugin:${name}`, type: "plugin", name, status, statusText }
  })
}

async function checkIntegrations() {
  const [mcpOut, pluginOut] = await Promise.allSettled([
    runClaude(["mcp", "list"]),
    runClaude(["plugin", "list", "--json"], 30_000),
  ])
  const mcp = mcpOut.status === "fulfilled" ? parseMcpList(mcpOut.value) : []
  const plugins = pluginOut.status === "fulfilled" ? parsePluginList(pluginOut.value) : []
  return {
    items: [...mcp, ...plugins],
    error: mcpOut.status === "rejected" ? String(mcpOut.reason?.message ?? mcpOut.reason) : null,
    checkedAt: Date.now(),
  }
}

// 마켓플레이스 전체 플러그인 + 설치 여부
async function listPluginCatalog() {
  const out = await runClaude(["plugin", "list", "--json", "--available"], 120_000)
  const j = JSON.parse(out)
  const installed = new Map(
    (j.installed ?? []).map((p) => [
      p.pluginId ?? p.id ?? p.name,
      { enabled: p.enabled !== false, version: p.version ?? "", installPath: p.installPath },
    ])
  )
  const available = (j.available ?? []).map((p) => ({
    id: p.pluginId,
    name: p.name,
    description: p.description ?? "",
    marketplace: p.marketplaceName ?? "",
    version: p.version ?? "",
    url: p.source?.url ?? p.homepage ?? "",
  }))
  // 설치된 플러그인은 available에 없으므로 설치 폴더의 plugin.json에서 정보를 읽어 추가
  for (const [id, info] of installed) {
    if (available.some((p) => p.id === id)) continue
    let manifest = {}
    try { manifest = readJson(path.join(info.installPath ?? "", ".claude-plugin", "plugin.json")) } catch {}
    const repo = typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url
    available.push({
      id,
      name: manifest.name ?? id.split("@")[0],
      description: manifest.description ?? "",
      marketplace: id.split("@")[1] ?? "",
      version: info.version,
      url: /^https:\/\//.test(manifest.homepage ?? "") ? manifest.homepage : /^https:\/\//.test(repo ?? "") ? repo : "",
    })
  }
  return available.map((p) => ({ ...p, installed: installed.has(p.id), enabled: installed.get(p.id)?.enabled ?? false }))
}

// 제거/활성화/비활성화는 확인 프롬프트가 없어 바로 실행
async function pluginAction(action, id) {
  if (!["uninstall", "enable", "disable"].includes(action)) throw new Error("unknown action")
  if (!/^[\w.@-]+$/.test(id)) throw new Error("invalid plugin id")
  return runClaude(["plugin", action, id], 120_000, true)
}

async function listMarketplaces() {
  const list = JSON.parse(await runClaude(["plugin", "marketplace", "list", "--json"], 30_000))
  return list.map((m) => ({ name: m.name, repo: m.repo ?? m.url ?? m.path ?? "", source: m.source ?? "" }))
}

// source: GitHub "owner/repo" 또는 https URL
async function marketplaceAction(action, value) {
  if (action === "add") {
    if (!/^[\w.-]+\/[\w.-]+$|^https:\/\/[^\s"&|<>^%]+$/.test(value)) throw new Error("GitHub owner/repo 또는 https 주소를 입력하세요")
    return runClaude(["plugin", "marketplace", "add", value], 180_000, true)
  }
  if (action === "remove") {
    if (!/^[\w.-]+$/.test(value)) throw new Error("invalid marketplace name")
    return runClaude(["plugin", "marketplace", "remove", value], 60_000, true)
  }
  throw new Error("unknown action")
}

// SKILL.md 앞부분(frontmatter)에서 name/description 추출
function readSkillMeta(dir) {
  try {
    const text = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8")
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ""
    const field = (k) => fm.match(new RegExp(`^${k}:\\s*(.*)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "") ?? ""
    return { name: field("name") || path.basename(dir), description: field("description") }
  } catch {
    return null
  }
}

// 설치된 스킬: 직접 넣은 스킬(~/.claude/skills) + 현재 계정에서 동기화된 스킬(skills/synced/<org>_<account>)
function listSkills(orgUuid, accountUuid) {
  const root = path.join(HOME, ".claude", "skills")
  const dirs = (p) => {
    try {
      return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("."))
    } catch {
      return []
    }
  }
  const local = dirs(root)
    .filter((d) => d.name !== "synced")
    .map((d) => readSkillMeta(path.join(root, d.name)))
    .filter(Boolean)

  let synced = []
  if (orgUuid && accountUuid) {
    const dir = path.join(root, "synced", `${orgUuid}_${accountUuid}`)
    try {
      const manifest = readJson(path.join(dir, "manifest.json"))
      synced = (manifest.skills ?? []).map((s) => ({ name: s.name, description: s.description ?? "", source: s.source ?? "" }))
    } catch {
      synced = dirs(dir).map((d) => readSkillMeta(path.join(dir, d.name))).filter(Boolean)
    }
  }
  return { local, synced }
}

// 실행 중인 Claude Code 세션 수 (데스크톱 앱 본체 Claude.exe는 제외)
function listClaudeProcesses() {
  const ps = "@(Get-Process claude -ErrorAction SilentlyContinue | ? { $_.Path -and $_.Path -notlike '*\\WindowsApps\\*' }).Count"
  return new Promise((resolve) => {
    execFile("powershell", ["-NoProfile", "-Command", ps], { windowsHide: true }, (err, out) => {
      resolve(err ? 0 : Number.parseInt(out.trim(), 10) || 0)
    })
  })
}

module.exports = {
  CRED_PATH,
  CONFIG_PATH,
  readLiveAuth,
  applyAuth,
  backupLiveFiles,
  fetchUsage,
  summarizeUsage,
  checkIntegrations,
  listSkills,
  listPluginCatalog,
  pluginAction,
  listMarketplaces,
  marketplaceAction,
  listClaudeProcesses,
}
