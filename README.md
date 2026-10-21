# Claude Widget

Windows·macOS 화면에 떠 있는 Claude Code 상태 위젯. 사용량을 보고, 계정을 바꾸고, MCP 끊김을 바로 알 수 있습니다.

> 비공식 개인 프로젝트입니다. Anthropic과 관련이 없습니다.

## 기능

- **계정·사용량**: 현재 로그인 계정과 세션(5시간)·주간 사용량 %
- **계정 전환**: 여러 계정을 저장해 두고 클릭으로 전환 (MCP·플러그인·settings는 그대로, 계정 정보만 교체)
- **원격 계정 전환**: Remote Control로 쓰던 세션을 `/switch`로 다른 계정에 넘겨 이어가기 → [쉬운 설명](docs/remote-switch.md)
- **사용량 경고**: 사용량이 기준(기본 90%)을 넘으면 Claude가 세션 안에서 계정 전환을 물어봄 (옵션)
- **MCP·플러그인 상태**: 감시 중인 항목 중 끊어진 개수, 클릭으로 MCP 로그인
- **스킬·플러그인**: 설치된 목록, 플러그인 스토어(마켓플레이스 추가·설치·제거)
- **테마**: 라이트(크림) / 다크 — 위젯과 설정 창에 함께 적용
- **아바타**: 도트 캐릭터 8종(움직임 끄기 가능) 또는 내 이미지·GIF
- **위치**: 드래그한 곳에 두거나 네 모서리 중 한 곳에 고정
- **자동 업데이트**: 새 버전이 나오면 설정·트레이에서 바로 업데이트

## 설치

[Releases](https://github.com/cksrlcks/claude-widget/releases/latest)에서 받습니다.
[Claude Code](https://docs.claude.com/en/docs/claude-code) CLI(`claude`)가 설치되어 있고 PATH에 있어야 합니다.

- **Windows**: `…_x64-setup.exe`를 받아 실행
- **macOS** (11 이상, Apple Silicon·Intel 공용): `…_universal.dmg`를 열어 `Claude Widget`을 응용 프로그램 폴더로 옮김
  - Apple 서명을 하지 않은 앱이라 처음 열면 "확인되지 않은 개발자" 경고가 뜹니다.
    **시스템 설정 → 개인정보 보호 및 보안**에서 "그래도 열기"를 한 번 누르면 이후에는 그냥 열립니다 (자동 업데이트도 그대로 동작)
  - 처음 계정을 읽을 때 키체인 접근을 물으면 "항상 허용"을 누릅니다

## 사용법

### 조작

| 동작 | 결과 |
| --- | --- |
| 드래그 | 위치 이동 (위치 기억, 고정 위치면 모서리로 돌아감) |
| 헤더의 미니 모드 버튼 | 미니 모드(아바타 + 상태등) ↔ 펼치기 |
| 우클릭 | 계정 빠른 전환, 플러그인 스토어, 설정 |
| MCP 영역 클릭 | 즉시 다시 확인 |
| 끊김 항목 클릭 | `claude mcp login` 실행 |
| 트레이 아이콘 | 보이기/숨기기, 계정 전환, 업데이트, 종료 |

### 계정 추가 / 전환

1. 현재 로그인한 계정은 자동 저장됩니다.
2. 설정 → "다른 계정 로그인" → 터미널에서 `claude auth login` 완료 → 자동 등록.
3. 이후 설정이나 우클릭 메뉴에서 전환합니다.

- 이미 실행 중인 Claude Code 세션은 재시작해야 새 계정이 적용됩니다.
- Claude 데스크톱 앱의 로그인은 별개라 바뀌지 않습니다.

### 원격 계정 전환 (`/switch`)

밖에서 Remote Control로 쓰던 세션에서 `/switch <계정 라벨|이메일>`을 입력하면, 계정을 바꾸고 같은 대화를 새 계정으로 다시 띄웁니다 (계정이 2개면 `/switch`만 입력해도 됩니다).
`/switch` 명령은 위젯이 켜질 때 자동으로 설치됩니다. 자세한 내용은 [docs/remote-switch.md](docs/remote-switch.md).

<details>
<summary>동작 세부</summary>

- 위젯이 시작할 때 `~/.claude/commands/switch.md`를 만듭니다 (파일 안의 `claude-widget` 표시 줄을 지우면 더 이상 덮어쓰지 않음).
- 명령은 모델 호출 전에 실행되므로 사용량 한도에 걸린 상태에서도 동작합니다. 직접 실행하려면:

  ```
  "%LOCALAPPDATA%\Claude Widget\claude-widget.exe" switch <계정 라벨|이메일> [--session <세션ID>]
  ```

  macOS: `"/Applications/Claude Widget.app/Contents/MacOS/claude-widget" switch ...`

1. 위젯이 계정을 교체 (확인창 없음)
2. 터미널(CLI) 세션: 5초 뒤 그 Claude Code 프로세스를 종료하고 새 콘솔 창(macOS는 Terminal 창)에서 `claude --resume <세션ID> --remote-control <대화 제목>`으로 같은 대화를 재실행
3. VS Code·데스크톱 앱 세션: 종료하면 패널이 깨지므로 그대로 두고, `--fork-session`으로 대화를 복사한 새 세션을 새 콘솔 창에 띄움
4. 다시 띄울 때 승인 안 된 프로젝트 MCP(`.mcp.json`)는 꺼서, 시작 확인 질문에 막혀 Remote Control이 안 켜지는 일을 막음
5. 30초 안에 새 프로세스가 죽으면 이전 계정으로 롤백

세션 ID를 안 주면 현재 폴더 프로젝트에서 가장 최근 세션을 씁니다. 결과는 데이터 폴더의 `remote-switch.log`에 남습니다.

</details>

### 사용량 기준 전환 물어보기

설정 → 일반에서 켜면 `~/.claude/settings.json`에 위젯 훅(`UserPromptSubmit`, `PostToolUse`)을 등록합니다 (끄면 제거, 다른 훅은 그대로).
현재 계정의 세션·주간 사용량이 기준을 넘으면 Claude가 세션 안에서 다른 계정으로 전환할지 묻고, 동의하면 원격 계정 전환을 실행합니다. 세션·초기화 주기마다 한 번만 묻습니다.

## 데이터와 주의

데이터 폴더: Windows `%APPDATA%/claude-widget`, macOS `~/Library/Application Support/claude-widget`

- `%APPDATA%/claude-widget/store.json` — 프로필 메타, 감시 목록, 위치, 설정
- `%APPDATA%/claude-widget/secrets/*.dpapi` — 계정 토큰 (Windows DPAPI 암호화, 그 PC의 같은 사용자만 열 수 있음). 이전 Electron 버전의 `*.bin`은 첫 실행 때 자동으로 옮겨집니다
- macOS: `secrets/*.enc` — 계정 토큰 (AES-256-GCM, 키는 로그인 키체인의 `Claude Widget` 항목)
- macOS의 Claude Code는 `.credentials.json` 대신 키체인 `Claude Code-credentials` 항목에 토큰을 저장하므로, 전환 시 그 항목을 바꿉니다 (백업은 `~/.claude.json`만, 토큰을 평문 파일로 꺼내지 않음)
- 전환 시 바뀌는 것: `~/.claude/.credentials.json`의 `claudeAiOauth`·`organizationUuid`, `~/.claude.json`의 `oauthAccount`. 그 외(MCP 설정, mcpOAuth, projects, settings.json 등)는 건드리지 않습니다. 전환 직전 두 파일은 `%APPDATA%/claude-widget/backups`에 백업됩니다.
- 로그인 정보 파일을 직접 수정합니다. 자동 백업은 하지만 사용은 본인 책임입니다.
- 사용량은 Claude Code가 내부적으로 쓰는 비공개 API(`/api/oauth/usage`)로 가져옵니다. 예고 없이 바뀌거나 막힐 수 있습니다.

## 개발

[Tauri](https://tauri.app) 2 + Vite + React로 만들어져 OS 내장 웹뷰(Windows WebView2, macOS WKWebView)를 씁니다.
개발에는 Rust(rustup)와 Windows는 Visual Studio Build Tools(C++), macOS는 Xcode Command Line Tools가 필요합니다.

```bash
npm install
npm run dev
```

설치된 위젯이 켜져 있으면 개발 버전이 뜨지 않으니(단일 실행) 트레이에서 먼저 종료합니다.
아이콘은 `npm run icons`로 다시 생성합니다 ([scripts/make-icons.cjs](scripts/make-icons.cjs), macOS용 `icon.icns` 포함).

### 구조

```
src/                        # 화면 (Vite + React + TS, Tailwind, shadcn/ui)
├── entries/                # 창별 진입점 (widget / settings)
├── pages/                  # 창 하나 = 페이지 하나
├── features/
│   ├── widget/             # 위젯: 계정 헤더, 사용량 막대, MCP 상태, 미니 모드
│   ├── accounts/           # 설정 > 계정 카드, 아바타 선택
│   ├── integrations/       # 설정 > 감시할 MCP·플러그인
│   ├── inventory/          # 설정 > 설치된 스킬·플러그인
│   ├── general/            # 설정 > 일반
│   └── store/              # 설정 > 플러그인 스토어
├── shared/
│   ├── api/                # Tauri 명령(commands), Query 훅(queries), 액션(mutations)
│   ├── components/         # 공용 컴포넌트 (아바타, 배지, 섹션)
│   ├── lib/  hooks/        # 포맷 함수, 공용 훅
│   └── types.ts            # 백엔드 JSON 타입
├── components/ui/          # shadcn/ui
└── hooks/use-confirm.tsx
src-tauri/src/              # 백엔드 (Rust)
├── main.rs                 # 창·트레이·메뉴, 프런트에서 부르는 명령, 원격 전환
├── claude.rs               # ~/.claude 읽기/쓰기, claude CLI 호출, 사용량 API, /switch·훅 설치
├── store.rs                # store.json, 토큰 저장
├── crypto.rs               # 토큰 암호화 (Windows DPAPI·Electron 토큰 이전 / macOS AES + 키체인 키)
├── keychain.rs             # macOS 키체인 읽기/쓰기 (/usr/bin/security)
└── updates.rs              # 자동 업데이트
```

백엔드 상태는 Rust가 `state` / `catalog` 이벤트로 보내고, 화면은 React Query 캐시로 받습니다.

### 배포 (자동 업데이트)

v1.2.0부터 앱이 GitHub Release의 `latest.json`을 보고 스스로 업데이트합니다. 업데이트 파일은 서명 키로 서명해야 합니다.
빌드는 GitHub Actions([release.yml](.github/workflows/release.yml))가 Windows·macOS(Universal)에서 함께 합니다.

1. 버전 올리기 (`package.json`, `package-lock.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`)

   ```bash
   node scripts/bump-version.cjs 1.6.0
   ```

2. 커밋 후 태그를 push

   ```bash
   git tag v1.6.0
   git push origin main v1.6.0
   ```

3. Actions가 끝나면 Release 초안에 설치 파일(Windows `.exe`, macOS `.dmg`)·업데이트 파일·`latest.json`이 올라와 있음 → 노트를 적고 **Publish** (Publish해야 기존 사용자에게 업데이트가 감)

처음 한 번, 저장소 Settings → Secrets and variables → Actions에 서명 키를 등록해야 합니다.
`TAURI_SIGNING_PRIVATE_KEY`(키 파일 내용), `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`(비밀번호).
Actions를 쓸 수 없을 때는 Windows에서 예전 방식(`scripts/build-release.ps1` → `scripts/make-latest-json.cjs`)으로 Windows만 배포할 수 있습니다.

개인 키를 잃어버리면 이미 설치된 앱에 더 이상 업데이트를 보낼 수 없으니 따로 백업해 둔다.
