// 배포용 파일 준비: 설치 파일을 공백 없는 이름으로 복사하고, 업데이터가 읽는 latest.json 생성
// 사용: node scripts/make-latest-json.cjs "릴리스 노트 한 줄"
// 결과: release/<버전>/ 에 Claude-Widget-Setup-<버전>.exe, latest.json
const fs = require("fs")
const path = require("path")

const root = path.join(__dirname, "..")
const conf = JSON.parse(fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"))
const version = conf.version
const nsis = path.join(root, "src-tauri", "target", "release", "bundle", "nsis")
const setup = path.join(nsis, `${conf.productName}_${version}_x64-setup.exe`)
const sig = `${setup}.sig`
if (!fs.existsSync(setup) || !fs.existsSync(sig)) {
  console.error(`서명된 설치 파일이 없습니다: ${setup}(.sig) — 서명 빌드를 먼저 하세요`)
  process.exit(1)
}

const repo = "cksrlcks/claude-widget"
const asset = `Claude-Widget-Setup-${version}.exe`
const out = path.join(root, "release", version)
fs.mkdirSync(out, { recursive: true })
fs.copyFileSync(setup, path.join(out, asset))
fs.writeFileSync(
  path.join(out, "latest.json"),
  JSON.stringify(
    {
      version,
      notes: process.argv[2] ?? "",
      pub_date: new Date().toISOString(),
      platforms: {
        "windows-x86_64": {
          signature: fs.readFileSync(sig, "utf8").trim(),
          url: `https://github.com/${repo}/releases/download/v${version}/${asset}`,
        },
      },
    },
    null,
    2,
  ),
)
console.log(`release/${version}/${asset}\nrelease/${version}/latest.json`)
