const $ = (id) => document.getElementById(id)
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])
const STATUS_LABEL = { ok: "정상", fail: "연결 실패", auth: "인증 필요", off: "비활성" }

const KIND_LABEL = { connector: "커넥터", local: "로컬 MCP", plugin: "플러그인" }
const kindOf = (k) => (k.type === "plugin" ? "plugin" : k.name.startsWith("claude.ai ") ? "connector" : "local")
const displayName = (k) => (kindOf(k) === "connector" ? k.name.slice(10) : k.name)

let state = null
let uploadTarget = null

function renderProfiles(s) {
  // 라벨 편집 중이면 다시 그리지 않음 (포커스 유지)
  if ($("profiles").contains(document.activeElement) && document.activeElement.tagName === "INPUT") return
  if (!s.profiles.length) {
    $("profiles").innerHTML = `<div class="empty">로그인된 계정이 없습니다. “다른 계정 로그인”으로 로그인하세요.</div>`
    return
  }
  $("profiles").innerHTML = s.profiles
    .map((p) => {
      const active = p.id === s.activeId
      const picks = Object.entries(window.AVATARS)
        .map(([k, a]) => `<button class="pick ${p.avatar === k ? "on" : ""}" data-avatar="${k}" title="${a.name}">${a.svg}</button>`)
        .join("")
      const custom = p.customAvatar
        ? `<button class="pick ${p.avatar === "custom" ? "on" : ""}" data-avatar="custom" title="내 이미지"><img src="${p.customAvatar}" alt="" /></button>`
        : ""
      const usage = p.lastUsage?.session ? ` · 마지막 세션 사용 ${Math.round(p.lastUsage.session.used)}%` : ""
      return `
      <div class="profile ${active ? "active" : ""}" data-id="${p.id}">
        <div class="p-top">
          <div class="p-avatar">${window.avatarHtml(p)}</div>
          <div class="p-info">
            <input class="label" value="${esc(p.label)}" placeholder="${esc(p.displayName)} (이름 지정)" />
            <div class="p-meta"><span>${esc(p.email)}</span>${active ? '<span class="p-tag">사용 중</span>' : ""}</div>
            <div class="p-meta"><span>${esc(p.orgName)}${p.plan ? ` · ${esc(p.plan)}` : ""}${usage}</span></div>
          </div>
          <div class="p-actions">
            <button class="btn primary act-switch" ${active ? "disabled" : ""}>${active ? "사용 중" : "전환"}</button>
            <button class="btn danger act-remove" ${active ? "disabled" : ""}>삭제</button>
          </div>
        </div>
        ${p.refreshExpired ? '<div class="p-warn">저장된 로그인이 만료됐습니다. 이 계정으로 다시 로그인해 주세요.</div>' : ""}
        <div class="picks">${picks}${custom}<button class="pick upload" data-upload title="내 이미지 업로드">+</button></div>
      </div>`
    })
    .join("")
}

function renderWatch(s) {
  const { known, watch, checkedAt, checking, error } = s.integrations
  const statusMap = new Map((s.integrations.items ?? []).map((i) => [i.key, i]))
  $("watch-all").checked = watch === null
  $("check-info").textContent = checking
    ? "확인 중… (claude mcp list 실행)"
    : checkedAt
      ? `마지막 확인 ${new Date(checkedAt).toLocaleString()}${error ? ` · 오류: ${error}` : ""}`
      : "아직 확인하지 않았습니다."
  if (!known.length) {
    $("watch").innerHTML = `<div class="empty">발견된 MCP·플러그인이 없습니다.</div>`
    return
  }
  $("watch").innerHTML = known
    .map((k) => {
      const cur = statusMap.get(k.key)
      const st = cur?.status ?? "off"
      const label = cur ? STATUS_LABEL[st] : "현재 계정에 없음"
      const checked = watch === null || watch.includes(k.key)
      let action = ""
      if (cur?.status === "auth") action = `<button class="w-act" data-login="${esc(k.name)}">로그인</button>`
      else if (!cur && k.name.startsWith("claude.ai ")) action = `<button class="w-act" data-connectors>claude.ai에서 추가</button>`
      return `<label class="w-item">
        <input type="checkbox" data-key="${esc(k.key)}" ${checked ? "checked" : ""} ${watch === null ? "disabled" : ""} />
        <span class="w-name" title="${esc(cur?.statusText ?? "")}">${esc(displayName(k))}</span>
        <span class="w-type ${kindOf(k)}">${KIND_LABEL[kindOf(k)]}</span>
        <span class="w-status ${cur ? st : "off"}">${label}</span>
        ${action}
      </label>`
    })
    .join("")
}

const openGroups = new Set()

function renderInventory(s) {
  const groups = [
    { id: "local", title: "내 스킬", hint: "~/.claude/skills · 모든 계정 공통", items: s.skills.local },
    { id: "synced", title: "계정 동기화 스킬", hint: "현재 계정에서 내려받은 스킬", items: s.skills.synced },
    {
      id: "plugins",
      title: "플러그인",
      hint: "claude plugin list",
      items: s.plugins.map((p) => ({ name: p.name, description: p.statusText, status: p.status })),
    },
  ]
  $("inventory").innerHTML = groups
    .map(
      (g) => `<details data-group="${g.id}" ${openGroups.has(g.id) ? "open" : ""}>
        <summary><span>${g.title}</span><span class="inv-count">${g.items.length}</span><span class="inv-hint">${g.hint}</span></summary>
        ${
          g.items.length
            ? g.items
                .map(
                  (i) => `<div class="inv-item" title="${esc(i.description)}">
                    <span class="inv-name">${esc(i.name)}</span>
                    ${i.status && i.status !== "ok" ? `<span class="w-status ${i.status}">${STATUS_LABEL[i.status]}</span>` : ""}
                    <span class="inv-desc">${esc(i.description)}</span>
                  </div>`
                )
                .join("")
            : `<div class="empty">없음</div>`
        }
      </details>`
    )
    .join("")
}

$("inventory").addEventListener(
  "toggle",
  (e) => {
    const id = e.target.dataset?.group
    if (!id) return
    e.target.open ? openGroups.add(id) : openGroups.delete(id)
  },
  true
)

function render(s) {
  state = s
  renderProfiles(s)
  renderWatch(s)
  renderInventory(s)
  if (document.activeElement !== $("interval")) $("interval").value = s.mcpIntervalMin
  $("autostart").checked = s.autoStart
  $("btn-check").disabled = s.integrations.checking
}

$("profiles").addEventListener("click", async (e) => {
  const card = e.target.closest(".profile")
  if (!card) return
  const id = card.dataset.id
  const pick = e.target.closest("[data-avatar]")
  if (pick) return window.api.updateProfile(id, { avatar: pick.dataset.avatar })
  if (e.target.closest("[data-upload]")) {
    uploadTarget = id
    return $("file").click()
  }
  if (e.target.closest(".act-switch")) return window.api.switchAccount(id)
  if (e.target.closest(".act-remove")) {
    const p = state.profiles.find((x) => x.id === id)
    if (confirm(`${p.email} 계정을 위젯에서 삭제할까요?\n(다시 쓰려면 재로그인 필요)`)) window.api.removeProfile(id)
  }
})

$("profiles").addEventListener("change", (e) => {
  if (!e.target.classList.contains("label")) return
  window.api.updateProfile(e.target.closest(".profile").dataset.id, { label: e.target.value.trim() })
})
$("profiles").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.classList.contains("label")) e.target.blur()
})

// 업로드 이미지는 128px로 줄여 data URL로 저장
$("file").addEventListener("change", async () => {
  const file = $("file").files[0]
  $("file").value = ""
  if (!file || !uploadTarget) return
  const img = await createImageBitmap(file)
  const size = 128
  const canvas = Object.assign(document.createElement("canvas"), { width: size, height: size })
  const scale = Math.max(size / img.width, size / img.height)
  const w = img.width * scale
  const h = img.height * scale
  canvas.getContext("2d").drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
  window.api.updateProfile(uploadTarget, { avatar: "custom", customAvatar: canvas.toDataURL("image/png") })
})

$("btn-login").addEventListener("click", () => window.api.loginNew())
$("btn-store").addEventListener("click", () => window.api.openStore())
$("btn-check").addEventListener("click", () => window.api.checkIntegrations())

$("watch-all").addEventListener("change", (e) => {
  window.api.setWatch(e.target.checked ? null : state.integrations.known.map((k) => k.key))
})
$("watch").addEventListener("click", (e) => {
  const login = e.target.closest("[data-login]")
  const connectors = e.target.closest("[data-connectors]")
  if (!login && !connectors) return
  e.preventDefault()
  if (login) window.api.mcpLogin([login.dataset.login])
  else window.api.openConnectors()
})
$("watch").addEventListener("change", () => {
  const keys = [...document.querySelectorAll("#watch input:checked")].map((i) => i.dataset.key)
  window.api.setWatch(keys)
})

$("interval").addEventListener("change", (e) => window.api.setInterval(e.target.value))
$("autostart").addEventListener("change", (e) => window.api.setAutoStart(e.target.checked))

window.api.onState(render)
window.api.getState().then(render)
