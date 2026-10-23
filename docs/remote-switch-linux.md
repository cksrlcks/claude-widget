# 리눅스에서 Claude Code 원격 계정 전환 — 탐구 노트

Claude Widget은 Windows 전용(DPAPI, 트레이, 콘솔 창)이라 리눅스 서버·WSL에서 Claude Code를 쓰는 경우에는 `/switch`를 쓸 수 없습니다.
위젯이 Windows에서 하는 일을 리눅스에서 어떻게 재현할 수 있는지 정리합니다. 2026-10-24 기준, 실제 리눅스에서 돌려 본 것은 아닙니다.

## 위젯이 하는 일 (리눅스로 옮겨야 할 것)

| 단계 | Windows 위젯 | 리눅스에서 대응 |
| --- | --- | --- |
| 계정 보관 | `secrets/*.dpapi` (DPAPI 암호화) | 파일 평문 + `chmod 600` (Claude Code 자체도 리눅스에서는 `~/.claude/.credentials.json`을 평문으로 둠) |
| 계정 교체 | `~/.claude/.credentials.json`의 `claudeAiOauth`·`organizationUuid`, `~/.claude.json`의 `oauthAccount` 교체 | 같은 파일·같은 키. `python3`로 교체 (jq는 없는 서버가 많음) |
| 호출한 세션 찾기 | 부모 프로세스를 따라 `claude.exe` 찾기 | `/proc/<pid>/status`의 `PPid`를 따라 `comm`이 `claude`(또는 `node` + `claude` 스크립트)인 프로세스 |
| 세션 ID | `~/.claude/projects/<cwd 키>/`의 최신 `.jsonl` | 동일 (키 규칙: 경로의 영숫자 외 문자를 `-`로) |
| 재실행 | 새 콘솔 창에서 `claude --resume <id> --remote-control <이름>` | **PTY가 필요** → tmux (아래) |
| 롤백 | 30초 안에 죽으면 이전 계정 복구 | 동일 |

### 핵심 제약: Remote Control은 PTY가 있어야 함

`claude --remote-control`은 TTY가 없으면(systemd 서비스, `nohup … > log &`) 비대화형 모드로 떨어져 바로 종료된다는 보고가 있습니다
([#77751](https://claudeissues.com/issue/77751-bug-claude-remote-control-collapses-into-an-implicit-print-mode-and-exits-immedi)).
헤드리스 리눅스에서 Remote Control을 쓰는 사실상 표준은 **tmux 안에서 실행**하는 것입니다
([#29479](https://claudeissues.com/issue/29479-docs-remote-control-confirmed-working-on-headless-linux-vm-via-ssh-tmux), [가이드](https://clauderemotecontrol.com/?p=86)).
`--headless`/`--daemon` 플래그는 요청만 있고([#30447](https://claudeissues.com/issue/30447-feature-request-claude-remote-control-headless-daemonizable-remote-control-witho)) 출시 여부는 확인하지 못했습니다.

따라서 리눅스에서 "세션을 다른 계정으로 다시 띄우기"는 다음 중 하나로 해야 합니다.

1. **이미 tmux 안에서 Claude를 쓰고 있다면**: 그 pane(`$TMUX_PANE`, 슬래시 명령의 셸이 환경변수로 물려받음)에서 Claude를 종료하고 `tmux send-keys`로 같은 pane에 `claude --resume … --remote-control`을 입력. 사용자가 보던 자리에서 그대로 이어짐.
2. **tmux가 있지만 밖에서 쓰고 있다면**: `tmux new-session -d -s claude-<라벨> -c <cwd> 'claude --resume … --remote-control'`. 나중에 `tmux attach -t claude-<라벨>`로 볼 수 있음.
3. **tmux가 없다면**: `setsid script -qfc 'claude --resume … --remote-control' /dev/null`로 가짜 PTY 제공. 동작은 하지만 화면을 다시 볼 방법이 없음(원격 전용).

## 방안 비교

### A. 위젯의 `switch`를 셸 스크립트로 이식 (`/switch` 그대로)

- 저장: `~/.claude-switch/<라벨>.json` (현재 로그인 저장: `claude-switch.sh save <라벨>`)
- 전환: 두 파일 교체 → 5초 뒤 호출한 Claude 종료 → tmux로 재실행 → 30초 뒤 생존 확인, 실패 시 롤백
- `~/.claude/commands/switch.md`에 `!`~/.claude-switch/claude-switch.sh $ARGUMENTS`` 를 넣으면 Windows와 같은 `/switch` UX
- 장점: 위젯과 동작·명령이 같음. 사용량 한도에 걸려도 동작(모델 호출 전 실행).
- 단점: 로그인 파일을 직접 고침(위젯과 같은 위험). 토큰 평문 저장. 스크립트가 길다.
- 초안: [scripts/claude-switch.sh](../scripts/claude-switch.sh) — **미검증**. 리눅스에서 `save` → `list` → 전환 순으로 한 번 손으로 돌려 본 뒤 `/switch`에 연결할 것.

### B. 계정별 `CLAUDE_CONFIG_DIR` (파일을 안 고침)

```
~/.claude/            ← 계정 A (기본)
~/.claude-b/          ← 계정 B: CLAUDE_CONFIG_DIR=~/.claude-b claude auth login
  .credentials.json   B 토큰
  .claude.json        B 전용 (MCP 승인·프로젝트 기록이 A와 분리됨)
  projects  -> ~/.claude/projects      심링크: 세션 기록 공유 → 어느 계정에서든 --resume 가능
  settings.json, commands/, skills/, plugins/ -> ~/.claude/… 심링크
```

전환 = `CLAUDE_CONFIG_DIR=~/.claude-b claude --resume <id> --remote-control`로 다시 띄우기만 하면 됨.

- 장점: 로그인 파일을 건드리지 않아 깨질 게 없고 롤백이 필요 없음. 두 계정을 동시에 띄울 수도 있음.
- 단점: `.claude.json`이 분리돼 MCP OAuth(`mcpOAuth`)·프로젝트 승인(`enabledMcpjsonServers`)을 계정마다 다시 해야 함. 세션 재실행 부분(PTY·tmux)은 A와 똑같이 필요.
- 세션 파일 안에는 계정 정보가 없어 다른 계정으로 `--resume`해도 대화는 그대로 이어짐(위젯이 Windows에서 하는 것과 같은 원리).

### C. 기존 도구

- [clauth](https://docs.rs/crate/clauth/latest) (Rust, Linux·macOS·Windows): `clauth capture <이름>`으로 현재 로그인 저장, `clauth <이름>`으로 `.credentials.json`·`settings.json`의 `env` 교체(A와 같은 원리), `clauth start <이름>`은 임시 `CLAUDE_CONFIG_DIR` 미러로 실행(B와 같은 원리), 사용량 기준 자동 전환 데몬(`clauth daemon`)도 있음. **세션 재실행·Remote Control은 다루지 않음** → 전환 뒤 tmux 재실행은 따로 해야 함.
- [ccswitch](https://pkg.go.dev/github.com/binoyPeries/ccswitch) (Go): 여러 계정 동시 실행용. 세부 미확인.
- [ctc](https://awesome.ecosyste.ms/projects/github.com%2Fbadbread%2Fctc): `claude --remote-control`을 tmux 세션으로 띄우고 관리하는 메뉴. 계정 전환은 없음.

### D. WSL이라면: 위젯이 직접 처리

리눅스가 같은 PC의 WSL이라면 Windows 위젯이 WSL 쪽 파일을 직접 고칠 수 있습니다.

- 경로: `\\wsl.localhost\<배포판>\home\<사용자>\.claude\.credentials.json`, `…\.claude.json` (claude.rs의 `cred_path`/`config_path`에 WSL 대상을 추가)
- 재실행: `wsl.exe -d <배포판> -- tmux new-session -d … claude --resume … --remote-control`
- 호출 세션 찾기: WSL 안의 `claude`는 Windows 프로세스 트리에 `wsl.exe`/`wslhost.exe`로만 보여 `--caller` 추적이 안 됨 → 슬래시 명령이 `--session`과 `--wsl <배포판>`을 직접 넘기게 해야 함. 세션 ID는 훅이면 `session_id`를 받지만 슬래시 명령은 못 받으므로, WSL 쪽 `projects/<cwd 키>/` 최신 파일을 `wsl.exe`로 찍어 오는 방식이 필요.
- 토큰은 그대로 DPAPI 보관 → A·B보다 안전. 하지만 위젯 코드 변경이 가장 큼.

## 권장

| 상황 | 권장 |
| --- | --- |
| 리눅스 서버(SSH)에서 Claude Code 사용 | **A** (`/switch` UX 유지). 평문 저장이 싫으면 **B**로 시작해도 전환 부분은 동일 |
| 같은 PC의 WSL | 우선 **A**로 WSL 안에서 해결. 위젯 통합(**D**)은 사용자가 더 생기면 |
| 코드 안 짜고 바로 | **C** clauth로 계정 교체 + 수동으로 tmux에서 `claude --resume … --remote-control` |

## 다음 단계 (검증 필요)

1. 리눅스 박스에서 `scripts/claude-switch.sh save a` → 다른 계정 로그인 → `save b` → `claude-switch.sh a`(세션 없이 전환만) 확인
2. tmux 안에서 Claude를 띄우고 `/switch b` → 같은 pane에서 새 계정으로 다시 뜨는지, 폰의 세션 목록에 같은 제목으로 나오는지 확인
3. `claude` 종료에 SIGTERM이 충분한지(안 죽으면 SIGKILL), 종료 시 자식 프로세스 그룹까지 정리하는지(그래서 스크립트가 `setsid`로 분리돼야 하는지) 확인
4. `--remote-control` 뒤 이름 인자, `--fork-session`이 리눅스 CLI에서도 같은지 `claude --help`로 확인
