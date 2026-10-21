// 버전 한 번에 올리기: package.json, package-lock.json, tauri.conf.json, Cargo.toml, Cargo.lock
// 사용: node scripts/bump-version.cjs 1.6.0
const fs = require("fs")
const path = require("path")

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("사용: node scripts/bump-version.cjs <x.y.z>")
  process.exit(1)
}
const root = path.join(__dirname, "..")
const file = (p) => path.join(root, p)

function editJson(p, fn) {
  const json = JSON.parse(fs.readFileSync(file(p), "utf8"))
  fn(json)
  fs.writeFileSync(file(p), JSON.stringify(json, null, 2) + "\n")
}

// 정규식이 정확히 한 번 맞아야 함 (형식이 바뀌어 엉뚱한 곳을 고치지 않게)
function editText(p, re, replace) {
  const text = fs.readFileSync(file(p), "utf8")
  const hits = text.match(new RegExp(re.source, re.flags.replace("g", "") + "g")) ?? []
  if (hits.length !== 1) throw new Error(`${p}: 버전 위치를 찾지 못했습니다 (${hits.length}곳)`)
  fs.writeFileSync(file(p), text.replace(re, replace))
}

editJson("package.json", (j) => (j.version = version))
editJson("package-lock.json", (j) => {
  j.version = version
  j.packages[""].version = version
})
editJson("src-tauri/tauri.conf.json", (j) => (j.version = version))
editText("src-tauri/Cargo.toml", /^(\[package\]\nname = "claude-widget"\nversion = )"[^"]+"/m, `$1"${version}"`)
editText("src-tauri/Cargo.lock", /(\[\[package\]\]\nname = "claude-widget"\nversion = )"[^"]+"/, `$1"${version}"`)
console.log(`v${version}: package.json, package-lock.json, tauri.conf.json, Cargo.toml, Cargo.lock`)
