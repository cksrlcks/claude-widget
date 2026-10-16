const $ = (id) => document.getElementById(id)
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])
const OFFICIAL = "claude-plugins-official"

let catalog = null
let tab = "all"
const busy = new Set() // 작업 중인 플러그인 id

function filtered() {
  const q = $("q").value.trim().toLowerCase()
  const market = $("market").value
  return (catalog?.items ?? [])
    .filter((p) => tab === "all" || p.installed)
    .filter((p) => !market || p.marketplace === market)
    .filter((p) => !q || `${p.name} ${p.description}`.toLowerCase().includes(q))
    .sort((a, b) => b.installed - a.installed || (b.marketplace === OFFICIAL) - (a.marketplace === OFFICIAL) || a.name.localeCompare(b.name))
}

function card(p) {
  const working = busy.has(p.id)
  const actions = p.installed
    ? `<button class="btn" data-act="${p.enabled ? "disable" : "enable"}" ${working ? "disabled" : ""}>${p.enabled ? "비활성화" : "활성화"}</button>
       <button class="btn danger" data-act="uninstall" ${working ? "disabled" : ""}>제거</button>`
    : `<button class="btn primary" data-act="install" ${working ? "disabled" : ""}>${working ? "설치 중…" : "설치"}</button>`
  return `<div class="card ${p.installed ? "installed" : ""}" data-id="${esc(p.id)}">
    <div class="c-body">
      <div class="c-top">
        <span class="c-name">${esc(p.name)}</span>
        ${p.version ? `<span class="c-ver">v${esc(p.version)}</span>` : ""}
        <span class="badge ${p.marketplace === OFFICIAL ? "official" : ""}">${p.marketplace === OFFICIAL ? "공식" : esc(p.marketplace)}</span>
        ${p.installed ? `<span class="badge ${p.enabled ? "on" : "off"}">${p.enabled ? "사용 중" : "꺼짐"}</span>` : ""}
        ${p.url ? `<button class="c-link" data-url="${esc(p.url)}">소스 보기 ↗</button>` : ""}
      </div>
      <div class="c-desc" title="${esc(p.description)}">${esc(p.description) || "설명 없음"}</div>
    </div>
    <div class="c-actions">${actions}</div>
  </div>`
}

function render() {
  const items = catalog?.items ?? []
  $("c-all").textContent = items.length || ""
  $("c-installed").textContent = items.filter((p) => p.installed).length || ""
  $("status").textContent = catalog?.loading
    ? "목록 불러오는 중…"
    : catalog?.error
      ? `오류: ${catalog.error}`
      : catalog?.fetchedAt
        ? `업데이트 ${new Date(catalog.fetchedAt).toLocaleTimeString()}`
        : ""
  $("reload").disabled = !!catalog?.loading

  const markets = [...new Set(items.map((p) => p.marketplace))].sort()
  const cur = $("market").value
  $("market").innerHTML =
    `<option value="">모든 마켓플레이스</option>` +
    markets.map((m) => `<option value="${esc(m)}">${m === OFFICIAL ? "공식 (claude-plugins-official)" : esc(m)}</option>`).join("")
  $("market").value = markets.includes(cur) ? cur : ""

  renderMarkets()
  const list = filtered()
  $("list").innerHTML = list.length
    ? list.map(card).join("")
    : `<div class="empty">${catalog?.loading && !items.length ? "불러오는 중…" : "플러그인이 없습니다."}</div>`
}

function renderMarkets() {
  const list = catalog?.marketplaces ?? []
  $("market-list").innerHTML = list
    .map(
      (m) => `<div class="m-item">
        <span class="m-name">${m.name === OFFICIAL ? "공식" : esc(m.name)}</span>
        <span class="m-repo">${esc(m.repo)}</span>
        ${m.name === OFFICIAL ? "" : `<button class="btn danger" data-remove="${esc(m.name)}">제거</button>`}
      </div>`
    )
    .join("")
}

function setMsg(text, kind = "") {
  $("add-msg").textContent = text
  $("add-msg").className = `add-msg ${kind}`
}

$("btn-markets").addEventListener("click", () => {
  $("markets").hidden = !$("markets").hidden
  if (!$("markets").hidden) $("add-src").focus()
})

$("add-form").addEventListener("submit", async (e) => {
  e.preventDefault()
  const src = $("add-src").value.trim().replace(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(\.git)?\/?$/, "$1")
  if (!src) return
  const before = new Set((catalog?.marketplaces ?? []).map((m) => m.name))
  $("add-btn").disabled = true
  setMsg("추가 중… (저장소를 내려받는 중)")
  const res = await window.api.marketplaceAction("add", src)
  $("add-btn").disabled = false
  if (res.error) return setMsg(res.error, "err")
  // 새로 생긴 마켓으로 필터 → 바로 플러그인이 보이게
  const added = (catalog?.marketplaces ?? []).find((m) => !before.has(m.name))
  $("add-src").value = ""
  setMsg(added ? `“${added.name}” 마켓플레이스를 추가했습니다.` : "추가했습니다.", "ok")
  if (added) {
    $("q").value = ""
    render()
    $("market").value = added.name
    render()
  }
})

$("market-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-remove]")
  if (!btn) return
  const name = btn.dataset.remove
  if (!confirm(`“${name}” 마켓플레이스를 제거할까요?\n여기서 설치한 플러그인도 함께 제거될 수 있습니다.`)) return
  btn.disabled = true
  const res = await window.api.marketplaceAction("remove", name)
  setMsg(res.error ?? `“${name}”을(를) 제거했습니다.`, res.error ? "err" : "ok")
})

$("list").addEventListener("click", async (e) => {
  const link = e.target.closest("[data-url]")
  if (link) return window.api.openUrl(link.dataset.url)
  const btn = e.target.closest("[data-act]")
  if (!btn) return
  const id = btn.closest(".card").dataset.id
  const act = btn.dataset.act
  if (act === "uninstall" && !confirm(`${id} 플러그인을 제거할까요?`)) return
  busy.add(id)
  render()
  try {
    if (act === "install") await window.api.installPlugin(id) // 터미널에서 진행, 닫히면 목록 갱신
    else await window.api.pluginAction(act, id)
  } catch (err) {
    alert(err instanceof Error ? err.message : "작업에 실패했습니다")
  } finally {
    if (act !== "install") busy.delete(id)
    render()
  }
})

document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    tab = t.dataset.tab
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("on", x === t))
    render()
  })
)
$("q").addEventListener("input", render)
$("market").addEventListener("change", render)
$("reload").addEventListener("click", () => window.api.reloadCatalog())

window.api.onCatalog((c) => {
  catalog = c
  // 새 목록이 오면 설치 진행 표시 해제
  if (!c?.loading) busy.clear()
  render()
})
window.api.getCatalog().then((c) => {
  catalog = c
  render()
})
