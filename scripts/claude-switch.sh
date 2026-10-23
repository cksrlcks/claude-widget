#!/usr/bin/env bash
# Claude Code 계정 전환 — Claude Widget의 `switch`를 리눅스 셸로 옮긴 초안 (미검증, docs/remote-switch-linux.md 참고)
#
#   claude-switch.sh save <라벨>              현재 로그인 계정을 저장 (~/.claude-switch/<라벨>.json, 0600)
#   claude-switch.sh list                     저장된 계정
#   claude-switch.sh <라벨> [--session <id>]  전환. Claude Code 안(/switch)에서 불리면 그 세션을 새 계정으로 다시 띄움
#
# ~/.claude/commands/switch.md 예:
#   ---
#   description: 다른 계정으로 전환 후 이 세션을 새 계정으로 원격 재실행
#   allowed-tools: Bash
#   ---
#   !`~/.claude-switch/claude-switch.sh $ARGUMENTS`
#   위 결과 문장을 사용자에게 그대로 전하세요.
set -euo pipefail

DIR="${CLAUDE_SWITCH_DIR:-$HOME/.claude-switch}"
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
CRED="$CFG/.credentials.json"
CLAUDE_JSON="${CLAUDE_CONFIG_DIR:+$CLAUDE_CONFIG_DIR/.claude.json}"
CLAUDE_JSON="${CLAUDE_JSON:-$HOME/.claude.json}"
mkdir -p "$DIR" && chmod 700 "$DIR"
log() { echo "$(date '+%F %T') $*" >> "$DIR/switch.log"; }

# 현재 로그인 → $1 파일 (이메일 출력)
save_current() {
  python3 - "$CRED" "$CLAUDE_JSON" "$1" <<'PY'
import json, os, sys
cred = json.load(open(sys.argv[1])); cfg = json.load(open(sys.argv[2]))
out = {"oauth": cred["claudeAiOauth"], "organizationUuid": cred.get("organizationUuid"), "oauthAccount": cfg["oauthAccount"]}
fd = os.open(sys.argv[3], os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
os.write(fd, json.dumps(out).encode()); os.close(fd)
print(out["oauthAccount"].get("emailAddress", "?"))
PY
}

# 저장된 계정($1) → 로그인 파일 (임시 파일 + rename, Claude Code가 읽는 중에도 깨진 JSON을 보지 않게)
apply() {
  python3 - "$CRED" "$CLAUDE_JSON" "$1" <<'PY'
import json, os, sys
acc = json.load(open(sys.argv[3]))
def swap(path, edit):
    d = json.load(open(path)); edit(d); tmp = path + ".switch-tmp"
    with open(tmp, "w") as f: json.dump(d, f, indent=2)
    os.chmod(tmp, 0o600); os.replace(tmp, path)
def cred(d):
    d["claudeAiOauth"] = acc["oauth"]
    if acc.get("organizationUuid"): d["organizationUuid"] = acc["organizationUuid"]
    else: d.pop("organizationUuid", None)
swap(sys.argv[1], cred)
swap(sys.argv[2], lambda d: d.__setitem__("oauthAccount", acc["oauthAccount"]))
PY
}

current_uuid() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["oauthAccount"]["accountUuid"])' "$CLAUDE_JSON"; }
file_uuid() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["oauthAccount"]["accountUuid"])' "$1"; }

# 지금 계정이 저장돼 있으면 그 파일을 최신 토큰으로 덮어씀 (토큰이 회전됐을 수 있음). 없으면 .current로 보관(롤백용)
refresh_current() {
  local me; me=$(current_uuid)
  for f in "$DIR"/*.json; do
    [ -e "$f" ] && [ "$(file_uuid "$f")" = "$me" ] && { save_current "$f" >/dev/null; echo "$f"; return; }
  done
  save_current "$DIR/.current" >/dev/null; echo "$DIR/.current"
}

# 부모를 따라 올라가 이 스크립트를 부른 Claude Code pid (native 바이너리 `claude` 또는 `node …/claude`)
find_claude() {
  local p=$PPID comm
  for _ in 1 2 3 4 5 6 7 8; do
    [ "$p" -le 1 ] && return 1
    comm=$(cat "/proc/$p/comm" 2>/dev/null || true)
    if [ "$comm" = claude ] || { [ "$comm" = node ] && tr '\0' ' ' < "/proc/$p/cmdline" | grep -q '/claude '; }; then echo "$p"; return; fi
    p=$(awk '/^PPid:/{print $2}' "/proc/$p/status")
  done
  return 1
}

# cwd 프로젝트의 최신 세션 (= 지금 명령을 실행 중인 세션)
newest_session() {
  local key; key=$(printf '%s' "$PWD" | sed 's/[^A-Za-z0-9]/-/g')
  ls -t "$CFG/projects/$key/"*.jsonl 2>/dev/null | head -1 | xargs -r basename | sed 's/\.jsonl$//'
}

# PTY가 있어야 Remote Control이 켜짐 → tmux 우선, 없으면 script로 가짜 PTY
relaunch() { # $1 세션 $2 라벨
  local cmd="claude --resume $1 --remote-control"
  if [ -n "${TMUX_PANE:-}" ] && tmux has-session 2>/dev/null; then
    tmux send-keys -t "$TMUX_PANE" "$cmd" Enter
  elif command -v tmux >/dev/null; then
    tmux new-session -d -s "claude-$2" -c "$PWD" "$cmd"
  else
    setsid nohup script -qfc "$cmd" /dev/null > "$DIR/relaunch.log" 2>&1 < /dev/null &
  fi
}

# 전환 본체. 부른 Claude가 종료되면서 자식까지 정리할 수 있어 setsid로 떼어낸 뒤 실행됨
worker() { # $1 대상 파일 $2 라벨 $3 caller pid $4 세션 $5 이전 계정 파일
  apply "$1"; log "전환됨: $2"
  [ -z "$4" ] && return
  sleep 5; kill "$3" 2>/dev/null || true; sleep 2
  relaunch "$4" "$2"
  sleep 30
  if pgrep -f "claude --resume $4" >/dev/null; then log "재실행됨: $2 / 세션 $4"; return; fi
  apply "$5"; relaunch "$4" prev; log "실패: $2 계정으로 실행되지 않아 이전 계정으로 롤백"
}

case "${1:-}" in
  --worker) shift; worker "$@"; exit ;;
  save) [ -n "${2:-}" ] || { echo "사용: claude-switch.sh save <라벨>"; exit 1; }
        echo "저장됨: $2 ($(save_current "$DIR/$2.json"))"; exit ;;
  list|"") for f in "$DIR"/*.json; do [ -e "$f" ] && echo "$(basename "$f" .json)  $(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["oauthAccount"].get("emailAddress",""))' "$f")"; done; exit ;;
esac

LABEL=$1; TARGET="$DIR/$LABEL.json"; SESSION=""
[ "${2:-}" = --session ] && SESSION=${3:-}
[ -f "$TARGET" ] || { echo "계정 없음: $LABEL (claude-switch.sh list)"; exit 1; }
[ "$(file_uuid "$TARGET")" = "$(current_uuid)" ] && { echo "이미 $LABEL 계정입니다"; exit; }
PREV=$(refresh_current)
CALLER=$(find_claude || true)
if [ -n "$CALLER" ]; then
  SESSION=${SESSION:-$(newest_session)}
  [ -n "$SESSION" ] || { echo "세션을 찾지 못함: $PWD"; exit 1; }
  echo "전환 시작: $LABEL — 잠시 뒤 이 세션이 종료되고 새 계정으로 다시 뜹니다 (원격에서는 새 계정으로 로그인해 같은 제목의 세션을 여세요)"
else
  echo "전환됨: $LABEL (실행 중인 Claude Code 세션은 다시 시작해야 적용)"
fi
setsid nohup bash "$0" --worker "$TARGET" "$LABEL" "${CALLER:-0}" "$SESSION" "$PREV" > /dev/null 2>&1 < /dev/null &
