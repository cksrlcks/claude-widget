#!/usr/bin/env python3
"""Claude Code 계정 전환 (리눅스 서버용, 위젯 없이 동작)

설치: cp switch.py ~/.claude/switch.py; cp switch.md ~/.claude/commands/switch.md
등록: 각 계정으로 로그인한 상태에서 /switch --save <라벨> 한 번씩
전환: /switch <라벨>  (계정이 둘이면 /switch 만으로 다른 쪽)
동작: 현재 토큰 저장 → 대상 계정으로 교체 → 5초 뒤 이 세션의 claude 종료 →
      같은 세션을 `claude remote-control --session-id`로 새 계정에서 재실행 → 30초 안에 죽으면 이전 계정으로 롤백
결과: ~/.claude/switch.log
"""
import glob
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time


def init_paths():
    global CONFIG_DIR, CRED, CONFIG, PROFILES, LOG
    home = os.path.expanduser("~")
    custom = os.environ.get("CLAUDE_CONFIG_DIR")
    CONFIG_DIR = custom or os.path.join(home, ".claude")
    CRED = os.path.join(CONFIG_DIR, ".credentials.json")
    # CLAUDE_CONFIG_DIR을 쓰면 .claude.json도 그 안에 있음
    CONFIG = os.path.join(CONFIG_DIR, ".claude.json") if custom else os.path.join(home, ".claude.json")
    PROFILES = os.path.join(CONFIG_DIR, "switch-profiles")
    LOG = os.path.join(CONFIG_DIR, "switch.log")


def read_json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def write_json(path, data):
    # 임시 파일에 쓰고 교체 → 쓰는 도중 claude가 읽어도 깨진 JSON을 보지 않음
    tmp = path + ".switch-tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def log(msg):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(LOG, "a") as f:
        f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + msg + "\n")


def fail(msg):
    print(msg)
    return 1


# ---------- 계정 정보 ----------

def live_auth():
    """현재 로그인 상태: {email, oauth, organizationUuid, oauthAccount}. 로그인 안 돼 있으면 None"""
    cred, config = read_json(CRED) or {}, read_json(CONFIG) or {}
    oauth, account = cred.get("claudeAiOauth"), config.get("oauthAccount")
    if not oauth or not account or not account.get("emailAddress"):
        return None
    return {
        "email": account["emailAddress"],
        "oauth": oauth,
        "organizationUuid": cred.get("organizationUuid") or account.get("organizationUuid"),
        "oauthAccount": account,
    }


def apply_auth(auth):
    """계정 정보만 교체하고 나머지 설정(mcpOAuth, projects 등)은 그대로 유지"""
    cred = read_json(CRED) or {}
    cred["claudeAiOauth"] = auth["oauth"]
    if auth.get("organizationUuid"):
        cred["organizationUuid"] = auth["organizationUuid"]
    else:
        cred.pop("organizationUuid", None)
    write_json(CRED, cred)
    config = read_json(CONFIG)
    if config is None:
        raise RuntimeError(CONFIG + " 읽기 실패")
    config["oauthAccount"] = auth["oauthAccount"]
    write_json(CONFIG, config)


def profiles():
    out = {}
    for p in glob.glob(os.path.join(PROFILES, "*.json")):
        data = read_json(p)
        if data and data.get("oauth") and data.get("email"):
            out[os.path.basename(p)[:-5]] = data
    return out


def save_profile(label, auth):
    os.makedirs(PROFILES, exist_ok=True)
    os.chmod(PROFILES, 0o700)
    write_json(os.path.join(PROFILES, label + ".json"), auth)


def find_profile(query, profs):
    q = query.lower()
    for label, p in profs.items():
        if q in (label.lower(), p["email"].lower()):
            return label, p
    return None


# ---------- 세션·프로세스 ----------

def newest_session(cwd):
    """cwd 프로젝트에서 가장 최근에 기록된 세션 (= 지금 이 명령을 실행 중인 세션)"""
    key = re.sub(r"[^A-Za-z0-9]", "-", cwd)
    files = glob.glob(os.path.join(CONFIG_DIR, "projects", key, "*.jsonl"))
    if not files:
        return None
    sid = os.path.basename(max(files, key=os.path.getmtime))[:-6]
    return sid if re.fullmatch(r"[A-Za-z0-9-]{1,64}", sid) else None


def proc_info(pid):
    """(ppid, pgid, argv) — /proc에서. 없으면 None"""
    try:
        with open("/proc/%d/stat" % pid) as f:
            stat = f.read()
        with open("/proc/%d/cmdline" % pid, "rb") as f:
            argv = [a.decode(errors="replace") for a in f.read().split(b"\0") if a]
    except OSError:
        return None
    fields = stat[stat.rindex(")") + 2:].split()  # comm 뒤: state ppid pgrp ...
    return int(fields[1]), int(fields[2]), argv


def is_claude(argv):
    # 네이티브 설치(.../bin/claude)와 npm 설치(node .../claude-code/cli.js) 둘 다
    return any(os.path.basename(a) == "claude" or "claude-code/cli.js" in a for a in argv[:2])


def claude_ancestors(pid):
    """나를 부른 claude 프로세스들 [(pid, pgid)], 가까운 순.
    remote-control 서버가 세션을 자식으로 띄우는 구조면 세션과 서버 둘 다 잡힘"""
    found = []
    for _ in range(16):
        info = proc_info(pid)
        if not info or pid <= 1:
            break
        if is_claude(info[2]):
            found.append((pid, info[1]))
        pid = info[0]
    return found


def kill_claude(procs):
    """프로세스 그룹째 종료 (세션이 띄운 도구 자식들 포함). TERM 2초 뒤 KILL"""
    for sig in (signal.SIGTERM, signal.SIGKILL):
        for pid, pgid in procs:
            for fn, target in ((os.killpg, pgid), (os.kill, pid)):
                if target > 1:
                    try:
                        fn(target, sig)
                    except OSError:
                        pass
        time.sleep(2)


def launch(cwd, session):
    out = open(os.path.join(CONFIG_DIR, "remote-control.log"), "ab")
    # shortcut: TTY 없이 뜨는지 미검증, 실패하면 ["script", "-qfc", "claude remote-control --session-id " + session, "/dev/null"]로 감쌀 것
    return subprocess.Popen(
        ["claude", "remote-control", "--session-id", session],
        cwd=cwd, stdin=subprocess.DEVNULL, stdout=out, stderr=out, start_new_session=True,
    )


def daemonize():
    """부모는 바로 끝나 /switch 출력이 즉시 나가고, 자식은 claude를 죽여도 같이 죽지 않게 세션을 분리"""
    sys.stdout.flush()
    if os.fork():
        os._exit(0)
    os.setsid()
    devnull = os.open(os.devnull, os.O_RDWR)
    for fd in (0, 1, 2):
        os.dup2(devnull, fd)


def do_switch(prev, target, procs, session, cwd):
    apply_auth(target)
    time.sleep(5)  # 원격 화면에 "전환 시작" 답이 전달될 시간
    kill_claude(procs)
    child = launch(cwd, session)
    time.sleep(30)
    if child.poll() is None:
        log("전환됨: %s / 세션 %s" % (target["email"], session))
        return
    apply_auth(prev)
    launch(cwd, session)
    log("%s 계정으로 실행 실패(종료 코드 %s) → %s 으로 롤백하고 다시 띄움. 자세한 내용: remote-control.log"
        % (target["email"], child.returncode, prev["email"]))


# ---------- 진입점 ----------

def main(args):
    init_paths()
    if args[:1] == ["--selftest"]:
        return selftest()
    profs = profiles()
    cur = live_auth()
    if args[:1] == ["--list"]:
        if not profs:
            return fail("저장된 계정 없음. 먼저 /switch --save <라벨>")
        for label, p in sorted(profs.items()):
            print("- %s: %s%s" % (label, p["email"], " (현재)" if cur and p["email"] == cur["email"] else ""))
        return 0
    if cur is None:
        return fail("현재 로그인 정보 없음 (claude에 로그인된 상태여야 합니다)")
    if args[:1] == ["--save"]:
        label = args[1] if len(args) > 1 else cur["email"]
        if not re.fullmatch(r"[\w.@-]+", label) or label.startswith("-"):
            return fail("라벨에 쓸 수 없는 문자: " + label)
        save_profile(label, cur)
        print("저장됨: %s (%s)" % (label, cur["email"]))
        return 0

    query = " ".join(args).strip()
    others = {l: p for l, p in profs.items() if p["email"] != cur["email"]}
    if query:
        hit = find_profile(query, profs)
        if not hit:
            return fail("계정 없음: %s — /switch --list 로 확인" % query)
        label, target = hit
        if target["email"] == cur["email"]:
            return fail("이미 %s 입니다" % cur["email"])
    elif len(others) == 1:
        (label, target), = others.items()
    else:
        return fail("전환할 계정을 지정하세요: /switch <라벨|이메일> — "
                    + ", ".join("%s (%s)" % (l, p["email"]) for l, p in sorted(profs.items())))

    cwd = os.getcwd()
    procs = claude_ancestors(os.getppid())
    session = newest_session(cwd)
    if not procs or not session:
        return fail("이 세션을 찾지 못함 (claude 안에서 /switch 로 실행해야 합니다): " + cwd)
    # 현재 계정의 최신 토큰을 먼저 저장 (라벨이 있으면 그 라벨에, 없으면 이메일로)
    cur_label = next((l for l, p in profs.items() if p["email"] == cur["email"]), cur["email"])
    save_profile(cur_label, cur)
    msg = ("전환 시작: %s — 잠시 뒤 이 세션이 종료되고 새 계정으로 다시 뜹니다. "
           "claude.ai에서 %s 계정으로 들어가 세션 목록에서 이어가세요. 결과: %s") % (target["email"], target["email"], LOG)
    print(msg)
    log(msg)
    daemonize()
    try:
        do_switch(cur, target, procs, session, cwd)
    except Exception as e:  # 데몬이라 출력이 없음 → 로그로
        log("실패: %r" % (e,))
    return 0


def selftest():
    tmp = tempfile.mkdtemp()
    os.environ["CLAUDE_CONFIG_DIR"] = tmp
    init_paths()
    write_json(CRED, {"claudeAiOauth": {"accessToken": "A"}, "organizationUuid": "org-a", "mcpOAuth": {"keep": 1}})
    write_json(CONFIG, {"oauthAccount": {"emailAddress": "a@x.com", "accountUuid": "ua"}, "projects": {"keep": 1}})
    a = live_auth()
    assert a["email"] == "a@x.com" and a["organizationUuid"] == "org-a"
    save_profile("work", a)
    b = {"email": "b@x.com", "oauth": {"accessToken": "B"}, "organizationUuid": None, "oauthAccount": {"emailAddress": "b@x.com"}}
    save_profile("personal", b)
    apply_auth(b)
    cred, cfg = read_json(CRED), read_json(CONFIG)
    assert cred["claudeAiOauth"]["accessToken"] == "B" and "organizationUuid" not in cred and cred["mcpOAuth"] == {"keep": 1}
    assert cfg["oauthAccount"]["emailAddress"] == "b@x.com" and cfg["projects"] == {"keep": 1}
    assert find_profile("WORK", profiles())[1]["email"] == "a@x.com"
    assert find_profile("a@x.com", profiles())[0] == "work"
    assert find_profile("nope", profiles()) is None
    apply_auth(a)
    assert read_json(CRED)["organizationUuid"] == "org-a"
    # 세션 탐색: cwd → 프로젝트 키 변환 + 최신 jsonl
    proj = os.path.join(tmp, "projects", "-srv-my-app")
    os.makedirs(proj)
    for name, t in (("old-1", 1), ("new-2", 2)):
        p = os.path.join(proj, name + ".jsonl")
        open(p, "w").close()
        os.utime(p, (t, t))
    assert newest_session("/srv/my.app") == "new-2"
    assert newest_session("/srv/none") is None
    assert is_claude(["/home/u/.local/bin/claude", "--resume"])
    assert is_claude(["node", "/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js"])
    assert not is_claude(["bash", "-c", "claude"])
    print("selftest ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
