---
description: 저장해둔 다른 Claude 계정으로 전환하고 이 세션을 새 계정으로 다시 띄움 (예: /switch work, 비우면 다른 계정, --save 라벨, --list)
argument-hint: [라벨|이메일] | --save [라벨] | --list
allowed-tools: Bash
---
!`python3 "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/switch.py" $ARGUMENTS`

위는 계정 전환 결과입니다. 결과 문장을 사용자에게 그대로 전하세요. 다른 작업은 하지 마세요.
