const $ = (id) => document.getElementById(id)
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c])

// 사용률 기준 색상
function color(used) {
  if (used >= 90) return "var(--bad)"
  if (used >= 70) return "var(--warn)"
  return "var(--ok)"
}

function formatReset(iso) {
  if (!iso) return ""
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return "곧 초기화"
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h >= 24) return `${Math.floor(h / 24)}일 ${h % 24}시간 후 초기화`
  return h > 0 ? `${h}시간 ${m}분 후 초기화` : `${m}분 후 초기화`
}

function setMeter(key, win, source) {
  if (!win) {
    $(`${key}-val`).textContent = "-"
    $(`${key}-bar`).style.width = "0"
    $(`${key}-reset`).textContent = ""
    return null
  }
  const used = Math.min(100, Math.max(0, Math.round(win.used)))
  $(`${key}-val`).textContent = `${used}%`
  $(`${key}-bar`).style.width = `${used}%`
  $(`${key}-bar`).style.background = color(used)
  $(`${key}-reset`).textContent = formatReset(win.resetsAt) + (source && source !== "live" ? " · 캐시" : "")
  return used
}

let lastHeight = 0
function fitHeight() {
  if (document.body.classList.contains("mini")) return
  const h = Math.ceil($("card").getBoundingClientRect().height) + 12
  if (h !== lastHeight) {
    lastHeight = h
    window.api.setHeight(h)
  }
}

function render(s) {
  document.body.classList.toggle("mini", s.mini)
  const p = s.profiles.find((x) => x.id === s.activeId)

  $("avatar").innerHTML = window.avatarHtml(p)
  $("bubble-avatar").innerHTML = window.avatarHtml(p)
  $("name").textContent = p ? p.label || p.displayName : "로그인 안 됨"
  $("email").textContent = p ? `${p.email}${p.plan ? ` · ${p.plan}` : ""}` : "설정에서 로그인하세요"

  setMeter("session", s.usage?.session, s.usageSource)
  setMeter("weekly", s.usage?.weekly, s.usageSource)
  if (!s.usage && s.usageError) $("session-reset").textContent = s.usageError

  // 미니 링 = 세션 사용량
  const used = s.usage?.session ? Math.min(100, Math.max(0, s.usage.session.used)) : 0
  const ring = $("ring")
  ring.style.strokeDashoffset = String(213.6 * (1 - used / 100))
  ring.style.stroke = color(used)

  const { broken, total, checking, checkedAt, error } = s.integrations
  const dot = $("mcp-dot")
  const btn = $("mcp")
  dot.className = "dot"
  btn.classList.remove("bad")
  if (checking && !checkedAt) {
    dot.classList.add("checking")
    $("mcp-text").textContent = "MCP 확인 중…"
  } else if (error && !total) {
    dot.classList.add("bad")
    $("mcp-text").textContent = "MCP 확인 실패"
  } else if (broken.length) {
    dot.classList.add(checking ? "checking" : "bad")
    btn.classList.add("bad")
    $("mcp-text").textContent = `${total}개 중 ${broken.length}개 끊어짐`
  } else {
    dot.classList.add(checking ? "checking" : "ok")
    $("mcp-text").textContent = total ? `MCP·플러그인 ${total}개 정상` : "감시 중인 항목 없음"
  }
  btn.title = checkedAt ? `마지막 확인 ${new Date(checkedAt).toLocaleTimeString()} · 클릭해서 다시 확인` : ""
  const REASON = { auth: "인증 필요 · 클릭해서 로그인", missing: "계정에 없음 · claude.ai에서 추가" }
  $("mcp-list").innerHTML =
    broken
      .slice(0, 6)
      .map((i) => {
        const act = i.status === "auth" ? `data-login="${esc(i.name)}"` : i.status === "missing" ? "data-connectors" : ""
        const isConnector = i.name.startsWith("claude.ai ")
        const kind = i.type === "plugin" ? "플러그인" : isConnector ? "커넥터" : "로컬"
        const name = isConnector ? i.name.slice(10) : i.name
        return `<div class="${act ? "act" : ""}" ${act} title="${esc(i.statusText)}">✕ <span class="kind">${kind}</span> ${esc(name)} — ${REASON[i.status] ?? "연결 실패"}</div>`
      })
      .join("") + (broken.length > 6 ? `<div class="more">외 ${broken.length - 6}개 · 설정에서 확인</div>` : "")

  const badge = $("badge")
  badge.textContent = String(broken.length)
  badge.classList.toggle("show", broken.length > 0)

  requestAnimationFrame(fitHeight)
}

// 드래그(창 이동)와 클릭 구분
let down = null
document.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || e.target.closest("button")) return
  down = { x: e.screenX, y: e.screenY, moved: false, target: e.target }
  window.api.dragStart({ x: e.screenX, y: e.screenY })
})
document.addEventListener("mousemove", (e) => {
  if (!down) return
  if (Math.abs(e.screenX - down.x) + Math.abs(e.screenY - down.y) > 3) down.moved = true
  if (down.moved) window.api.dragMove({ x: e.screenX, y: e.screenY })
})
document.addEventListener("mouseup", () => {
  if (!down) return
  const { moved, target } = down
  down = null
  window.api.dragEnd()
  if (moved) return
  const login = target.closest("[data-login]")
  if (login) return window.api.mcpLogin([login.dataset.login])
  if (target.closest("[data-connectors]")) return window.api.openConnectors()
  if (target.closest(".more")) return window.api.openSettings()
  // 아바타 클릭: 미니 ↔ 확장
  if (target.closest("#avatar")) window.api.setMini(true)
  else if (target.closest("#bubble")) window.api.setMini(false)
})
document.addEventListener("contextmenu", (e) => {
  e.preventDefault()
  window.api.accountMenu()
})

$("btn-settings").addEventListener("click", () => window.api.openSettings())
$("mcp").addEventListener("click", () => window.api.checkIntegrations())

window.api.onState(render)
window.api.getState().then(render)
setInterval(() => window.api.getState().then(render), 30_000) // 초기화 시간 표시 갱신
