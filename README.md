# Claude Widget

Windows 화면 오른쪽에 떠 있는 Claude Code 상태 위젯.

> 비공식 개인 프로젝트입니다. Anthropic과 관련이 없습니다.

- 현재 로그인 계정 + 아바타(기본 5종 / 내 이미지)
- 세션(5시간)·주간 사용량 %
- 감시 중인 MCP·플러그인 중 끊어진 개수, 클릭으로 MCP 로그인
- 계정 전환 (MCP·플러그인·settings는 그대로, 계정 정보만 교체)
- 설치된 스킬·플러그인 목록, 플러그인 스토어(마켓플레이스 추가·설치·제거)

## 실행

[Claude Code](https://docs.claude.com/en/docs/claude-code) CLI(`claude`)가 PATH에 있어야 합니다.
[Tauri](https://tauri.app) 2 + Vite + React로 만들어져 Windows 내장 WebView2를 씁니다 (설치 파일 약 2MB).

개발에는 Rust(rustup)와 Visual Studio Build Tools(C++)가 필요합니다.

```bash
npm install
npm run dev
```

빌드 (`src-tauri/target/release/bundle/nsis/`에 설치 파일 생성):

```bash
npm run build
```

## 원격 세션 계정 전환

Remote Control로 보고 있는 세션을 다른 계정으로 이어가기. 원격 세션에서 `/switch <계정 라벨|이메일>`을 입력한다 (계정이 2개면 `/switch`만 입력해도 다른 계정으로).

> 쉬운 설명: [docs/remote-switch.md](docs/remote-switch.md)

위젯이 시작할 때 `~/.claude/commands/switch.md`를 자동으로 만든다 (파일 안의 `claude-widget` 표시 줄을 지우면 더 이상 덮어쓰지 않음).
명령은 모델 호출 전에 실행되므로 사용량 한도에 걸린 상태에서도 동작할 가능성이 높다. 직접 실행하려면:

```
"%LOCALAPPDATA%\Claude Widget\claude-widget.exe" switch <계정 라벨|이메일> [--session <세션ID>]
```

1. 위젯이 계정을 교체 (확인창 없음)
2. 터미널(CLI) 세션: 5초 뒤 그 Claude Code 프로세스를 종료하고 새 콘솔 창에서 `claude --resume <세션ID> --remote-control`로 같은 대화를 재실행
3. VS Code·데스크톱 앱 세션: 종료하면 패널이 깨지므로 그대로 두고, `--fork-session`으로 대화를 복사한 새 세션을 새 콘솔 창에 띄움 (기존 세션·대화 기록은 그대로 남음)
4. 새 계정의 claude.ai/code·앱에서 그 세션으로 이어감. 30초 안에 프로세스가 죽으면 이전 계정으로 롤백

### 사용량 기준 전환 물어보기

설정 → 일반에서 켜면 `~/.claude/settings.json`에 위젯 훅(`UserPromptSubmit`, `PostToolUse`)을 등록한다 (끄면 제거, 다른 훅은 그대로).
현재 계정의 세션·주간 사용량이 기준(기본 90%)을 넘으면 Claude가 세션 안에서 다른 계정으로 전환할지 묻고, 동의하면 위 전환을 실행한다. 세션·초기화 주기마다 한 번만 묻는다.

세션 ID를 안 주면 현재 폴더 프로젝트에서 가장 최근 세션을 쓴다. 결과는 `%APPDATA%\claude-widget\remote-switch.log`에 남는다.
전역 크리덴셜을 바꾸므로 그 PC의 다른 세션도 재시작하면 새 계정이 된다.

## 구조

```
src/                        # 화면 (Vite + React + TS, Tailwind, shadcn/ui)
├── entries/                # 창별 진입점 (widget / settings / store)
├── pages/                  # 창 하나 = 페이지 하나
├── features/
│   ├── widget/             # 위젯: 계정 헤더, 사용량 막대, MCP 상태, 미니 모드
│   ├── accounts/           # 설정 > 계정 카드, 아바타 선택
│   ├── integrations/       # 설정 > 감시할 MCP·플러그인
│   ├── inventory/          # 설정 > 설치된 스킬·플러그인
│   ├── general/            # 설정 > 일반
│   └── store/              # 플러그인 스토어
├── shared/
│   ├── api/                # Tauri 명령(commands), Query 훅(queries), 액션(mutations)
│   ├── components/         # 공용 컴포넌트 (아바타, 배지, 섹션)
│   ├── lib/  hooks/        # 포맷 함수, 공용 훅
│   └── types.ts            # 백엔드 JSON 타입
├── components/ui/          # shadcn/ui
└── hooks/use-confirm.tsx
src-tauri/src/              # 백엔드 (Rust)
├── main.rs                 # 창·트레이·메뉴, 프런트에서 부르는 명령
├── claude.rs               # ~/.claude 읽기/쓰기, claude CLI 호출, 사용량 API
├── store.rs                # store.json, 토큰 저장
└── crypto.rs               # DPAPI 암호화, Electron 토큰 이전
```

백엔드 상태는 Rust가 `state` / `catalog` 이벤트로 보내고, 화면은 React Query 캐시로 받습니다.

## 배포 (자동 업데이트)

v1.2.0부터 앱이 GitHub Release의 `latest.json`을 보고 스스로 업데이트합니다. 업데이트 파일은 서명 키로 서명해야 합니다.

1. `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`의 버전을 올린다
2. 서명 빌드 — 개인 키(`%USERPROFILE%\.tauri\claude-widget.key`) 비밀번호를 물어봄

   ```bash
   powershell -ExecutionPolicy Bypass -File scripts/build-release.ps1
   ```

3. 배포 파일 준비 → `release/<버전>/`에 설치 파일과 `latest.json` 생성

   ```bash
   node scripts/make-latest-json.cjs "릴리스 노트"
   ```

4. 두 파일을 GitHub Release `v<버전>`에 올린다 (Latest로 지정)

개인 키를 잃어버리면 이미 설치된 앱에 더 이상 업데이트를 보낼 수 없으니 따로 백업해 둔다.

## 조작

| 동작 | 결과 |
| --- | --- |
| 드래그 | 위치 이동 (위치 기억) |
| 아바타 클릭 | 미니 모드(아바타 + 사용량 링 + 끊김 뱃지) ↔ 확장 |
| 우클릭 | 계정 빠른 전환, 플러그인 스토어, 설정 |
| MCP 영역 클릭 | 즉시 다시 확인 |
| 끊김 항목 클릭 | `claude mcp login` 실행 |
| 트레이 아이콘 | 보이기/숨기기, 전환, 종료 |

## 계정 추가 / 전환

1. 현재 로그인한 계정은 자동 저장된다.
2. 설정 → “다른 계정 로그인” → 터미널에서 `claude auth login` 완료 → 자동 등록.
3. 이후 설정이나 우클릭 메뉴에서 전환.

전환 시 바뀌는 것: `~/.claude/.credentials.json`의 `claudeAiOauth`·`organizationUuid`, `~/.claude.json`의 `oauthAccount`.
그 외(MCP 설정, mcpOAuth, projects, settings.json 등)는 건드리지 않는다. 전환 직전 두 파일은 `%APPDATA%/claude-widget/backups`에 백업된다.
이미 실행 중인 Claude Code 세션은 재시작해야 새 계정이 적용된다.
Claude 데스크톱 앱의 로그인은 별개라 바뀌지 않는다.

## 주의

- 로그인 정보 파일을 직접 수정합니다. 자동 백업은 하지만 사용은 본인 책임입니다.
- 사용량은 Claude Code가 내부적으로 쓰는 비공개 API(`/api/oauth/usage`)로 가져옵니다. 예고 없이 바뀌거나 막힐 수 있습니다.

## 데이터

- `%APPDATA%/claude-widget/store.json` — 프로필 메타, 감시 목록, 위치
- `%APPDATA%/claude-widget/secrets/*.dpapi` — 계정 토큰 (Windows DPAPI 암호화). 이전 Electron 버전의 `*.bin`은 첫 실행 때 자동으로 옮겨진다

아이콘은 `npm run icons`로 다시 생성합니다 ([scripts/make-icons.js](scripts/make-icons.js)).
