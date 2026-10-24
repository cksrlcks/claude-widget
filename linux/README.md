# 리눅스 서버용 /switch

위젯 없이 Claude Code 안에서 저장해둔 다른 계정으로 전환하고, 같은 세션을 새 계정으로 다시 띄운다.
헤드리스 서버(SSH, tmux 없음)용. python3 외에 필요한 것 없음.

## 설치

```bash
cp switch.py ~/.claude/switch.py && mkdir -p ~/.claude/commands && cp switch.md ~/.claude/commands/switch.md
```

## 계정 등록 (계정마다 한 번)

1. `claude` 안에서 `/login` 으로 A 계정 로그인 → `/switch --save work`
2. `/login` 으로 B 계정 로그인 → `/switch --save personal`

## 사용

- `/switch work` : work 계정으로 전환. 계정이 둘이면 `/switch` 만으로 다른 쪽
- `/switch --list` : 저장된 계정
- 전환하면 5초 뒤 이 세션의 claude가 종료되고 `claude remote-control --session-id <세션>` 으로 새 계정에서 백그라운드 재실행된다.
  claude.ai 에서 새 계정으로 로그인해 세션 목록에서 이어간다. 30초 안에 죽으면 이전 계정으로 롤백한다.
- 결과: `~/.claude/switch.log`, 재실행된 프로세스 출력: `~/.claude/remote-control.log`
- 백그라운드로 뜬 세션을 끝내려면 `pkill -f "claude remote-control"`

## 주의

- 전환 순간 진행 중이던 작업이 끊긴다. 같은 프로세스 그룹의 다른 remote-control 세션도 함께 종료된다.
- 저장한 토큰은 `~/.claude/switch-profiles/` 에 평문(600)으로 둔다. Claude Code 자체의 `.credentials.json` 과 같은 수준이다.
- 저장해둔 계정의 토큰이 다른 기기에서 갱신되면 만료될 수 있다. 롤백되면 그 계정으로 다시 로그인해 `--save` 한다.
