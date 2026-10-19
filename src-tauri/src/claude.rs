// Claude Code 로컬 설정(~/.claude) 읽기/쓰기 + 사용량/MCP/플러그인/스킬 조회
use crate::store::{Integration, IntegrationResult};
use serde_json::{json, Value};
use std::{
    fs,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn now_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0)
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var("USERPROFILE").unwrap_or_default())
}
fn cred_path() -> PathBuf {
    home().join(".claude").join(".credentials.json")
}
fn config_path() -> PathBuf {
    home().join(".claude.json")
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

// 임시 파일에 쓰고 rename → 쓰는 도중 Claude Code가 읽어도 깨진 JSON을 보지 않게
fn write_json_atomic(path: &Path, data: &Value) -> Result<(), String> {
    let tmp = path.with_extension("widget-tmp");
    fs::write(&tmp, serde_json::to_string_pretty(data).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// 현재 로그인 상태 스냅샷: { accountUuid, oauth, organizationUuid, oauthAccount, cachedUsage }
pub fn read_live_auth() -> Option<Value> {
    let cred = read_json(&cred_path())?;
    let config = read_json(&config_path())?;
    let oauth = cred.get("claudeAiOauth")?.clone();
    let account = config.get("oauthAccount")?.clone();
    let uuid = account.get("accountUuid")?.as_str()?.to_string();
    let org = cred.get("organizationUuid").or_else(|| account.get("organizationUuid")).cloned().unwrap_or(Value::Null);
    Some(json!({
        "accountUuid": uuid,
        "oauth": oauth,
        "organizationUuid": org,
        "oauthAccount": account,
        "cachedUsage": config.get("cachedUsageUtilization").cloned().unwrap_or(Value::Null),
    }))
}

/// 계정 정보만 교체하고 나머지 설정(mcpOAuth, projects, settings 등)은 그대로 유지
pub fn apply_auth(auth: &Value) -> Result<(), String> {
    let mut cred = read_json(&cred_path()).unwrap_or_else(|| json!({}));
    let obj = cred.as_object_mut().ok_or("credentials 형식 오류")?;
    obj.insert("claudeAiOauth".into(), auth["oauth"].clone());
    match auth.get("organizationUuid").filter(|v| !v.is_null()) {
        Some(org) => obj.insert("organizationUuid".into(), org.clone()),
        None => obj.remove("organizationUuid"),
    };
    write_json_atomic(&cred_path(), &cred)?;

    let mut config = read_json(&config_path()).ok_or(".claude.json 읽기 실패")?;
    config.as_object_mut().ok_or(".claude.json 형식 오류")?.insert("oauthAccount".into(), auth["oauthAccount"].clone());
    write_json_atomic(&config_path(), &config)
}

pub fn backup_live_files(dir: &Path) {
    let _ = fs::create_dir_all(dir);
    let stamp = format!("{}", now_ms() as u64);
    for f in [cred_path(), config_path()] {
        if f.exists() {
            let name = f.file_name().unwrap().to_string_lossy().to_string();
            let _ = fs::copy(&f, dir.join(format!("{stamp}_{name}")));
        }
    }
    // 최근 20개(10회분)만 유지
    if let Ok(entries) = fs::read_dir(dir) {
        let mut files: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
        files.sort();
        let excess = files.len().saturating_sub(20);
        for f in files.into_iter().take(excess) {
            let _ = fs::remove_file(f);
        }
    }
}

pub async fn fetch_usage(token: &str) -> Result<Value, String> {
    let res = reqwest::Client::new()
        .get("https://api.anthropic.com/api/oauth/usage")
        .bearer_auth(token)
        .header("anthropic-beta", "oauth-2025-04-20")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("usage {}", res.status().as_u16()));
    }
    res.json().await.map_err(|e| e.to_string())
}

/// 사용량 응답 → 위젯에서 쓰는 형태로 축약
pub fn summarize_usage(u: &Value) -> Value {
    let pick = |w: &Value| {
        if w.is_object() {
            json!({ "used": w["utilization"].as_f64().unwrap_or(0.0), "resetsAt": w["resets_at"] })
        } else {
            Value::Null
        }
    };
    json!({ "session": pick(&u["five_hour"]), "weekly": pick(&u["seven_day"]) })
}

/// claude CLI 실행 (창 없이). strict면 종료 코드 실패 시 출력이 있어도 에러
pub fn run_claude(args: &[&str], strict: bool) -> Result<String, String> {
    let out = Command::new("cmd")
        .arg("/C")
        .arg("claude")
        .args(args)
        .current_dir(home())
        .stdin(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    if !out.status.success() && (strict || stdout.trim().is_empty()) {
        let msg = if !stderr.trim().is_empty() { stderr } else { stdout };
        return Err(msg.trim().to_string());
    }
    Ok(stdout)
}

/// 보이는 터미널 창에서 명령 실행 (프롬프트·브라우저 인증용). 창이 닫힐 때까지 대기
pub fn run_in_terminal(title: &str, command: &str) {
    let script = format!("{command} & echo. & echo Done. Press any key to close. & pause >nul");
    let _ = Command::new("cmd.exe")
        .raw_arg(format!("/c start \"{title}\" /wait cmd /c \"{script}\""))
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

// "name: target - ✓ Connected" 형식 파싱
fn parse_mcp_list(out: &str) -> Vec<Integration> {
    let mut items = vec![];
    for raw in out.lines() {
        let line = raw.trim();
        let (Some(sep), Some(dash)) = (line.find(": "), line.rfind(" - ")) else { continue };
        if sep < 1 || dash < sep {
            continue;
        }
        let name = &line[..sep];
        let status_text = line[dash + 3..].trim_start_matches(|c: char| !c.is_ascii_alphabetic()).trim().to_string();
        let lower = status_text.to_lowercase();
        let status = if lower.contains("connected") && !lower.contains("fail") && !lower.contains("not") {
            "ok"
        } else if lower.contains("auth") {
            "auth"
        } else if lower.contains("pending") || lower.contains("disabled") {
            "off"
        } else {
            "fail"
        };
        items.push(Integration {
            key: format!("mcp:{name}"),
            kind: "mcp".into(),
            name: name.into(),
            status: Some(status.into()),
            status_text: Some(status_text),
        });
    }
    items
}

fn parse_plugin_list(out: &str) -> Vec<Integration> {
    let Ok(v) = serde_json::from_str::<Value>(out) else { return vec![] };
    let list = v.as_array().cloned().or_else(|| v["plugins"].as_array().cloned()).unwrap_or_default();
    list.iter()
        .map(|p| {
            let name = p["id"].as_str().or(p["pluginId"].as_str()).or(p["name"].as_str()).unwrap_or("?").to_string();
            let (status, text) = if p["enabled"] == Value::Bool(false) { ("off", "꺼짐") } else { ("ok", "사용 중") };
            Integration {
                key: format!("plugin:{name}"),
                kind: "plugin".into(),
                name,
                status: Some(status.into()),
                status_text: Some(text.into()),
            }
        })
        .collect()
}

pub fn check_integrations() -> IntegrationResult {
    let mcp = run_claude(&["mcp", "list"], false);
    let plugins = run_claude(&["plugin", "list", "--json"], false).map(|o| parse_plugin_list(&o)).unwrap_or_default();
    let (mut items, error) = match mcp {
        Ok(o) => (parse_mcp_list(&o), None),
        Err(e) => (vec![], Some(e)),
    };
    items.extend(plugins);
    IntegrationResult { items, error, checked_at: now_ms() }
}

/// 마켓플레이스 전체 플러그인 + 설치 여부
pub fn list_plugin_catalog() -> Result<Vec<Value>, String> {
    let j: Value = serde_json::from_str(&run_claude(&["plugin", "list", "--json", "--available"], false)?).map_err(|e| e.to_string())?;
    let installed = j["installed"].as_array().cloned().unwrap_or_default();
    let installed_id = |p: &Value| p["pluginId"].as_str().or(p["id"].as_str()).unwrap_or("").to_string();

    let mut items: Vec<Value> = j["available"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|p| {
            json!({
                "id": p["pluginId"], "name": p["name"],
                "description": p["description"].as_str().unwrap_or(""),
                "marketplace": p["marketplaceName"].as_str().unwrap_or(""),
                "version": p["version"].as_str().unwrap_or(""),
                "url": p["source"]["url"].as_str().or(p["homepage"].as_str()).unwrap_or(""),
                "installed": false, "enabled": false,
            })
        })
        .collect();

    // 설치된 플러그인은 available에 없으므로 설치 폴더의 plugin.json에서 정보를 읽어 추가
    for p in &installed {
        let id = installed_id(p);
        let enabled = p["enabled"] != Value::Bool(false);
        if let Some(item) = items.iter_mut().find(|i| i["id"] == id.as_str()) {
            item["installed"] = json!(true);
            item["enabled"] = json!(enabled);
            continue;
        }
        let manifest = p["installPath"]
            .as_str()
            .and_then(|dir| read_json(&Path::new(dir).join(".claude-plugin").join("plugin.json")))
            .unwrap_or(Value::Null);
        let repo = manifest["repository"].as_str().or(manifest["repository"]["url"].as_str()).unwrap_or("");
        let homepage = manifest["homepage"].as_str().unwrap_or("");
        let url = [homepage, repo].into_iter().find(|u| u.starts_with("https://")).unwrap_or("");
        let mut parts = id.splitn(2, '@');
        let short = parts.next().unwrap_or("").to_string();
        let market = parts.next().unwrap_or("").to_string();
        items.push(json!({
            "id": id, "name": manifest["name"].as_str().unwrap_or(&short),
            "description": manifest["description"].as_str().unwrap_or(""),
            "marketplace": market, "version": p["version"].as_str().unwrap_or(""),
            "url": url, "installed": true, "enabled": enabled,
        }));
    }
    Ok(items)
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || "_.@-".contains(c))
}

/// 제거/활성화/비활성화는 확인 프롬프트가 없어 바로 실행
pub fn plugin_action(action: &str, id: &str) -> Result<(), String> {
    if !["uninstall", "enable", "disable"].contains(&action) {
        return Err("unknown action".into());
    }
    if !valid_id(id) {
        return Err("invalid plugin id".into());
    }
    run_claude(&["plugin", action, id], true).map(|_| ())
}

pub fn valid_plugin_id(id: &str) -> bool {
    valid_id(id)
}

pub fn list_marketplaces() -> Result<Vec<Value>, String> {
    let list: Value = serde_json::from_str(&run_claude(&["plugin", "marketplace", "list", "--json"], false)?).map_err(|e| e.to_string())?;
    Ok(list
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let repo = m["repo"].as_str().or(m["url"].as_str()).or(m["path"].as_str()).unwrap_or("");
            json!({ "name": m["name"], "repo": repo, "source": m["source"].as_str().unwrap_or("") })
        })
        .collect())
}

// source: GitHub "owner/repo" 또는 https URL
pub fn marketplace_action(action: &str, value: &str) -> Result<(), String> {
    match action {
        "add" => {
            let github = value.split('/').count() == 2
                && value.chars().all(|c| c.is_ascii_alphanumeric() || "_.-/".contains(c));
            let url = value.starts_with("https://") && !value.chars().any(|c| c.is_whitespace() || "\"&|<>^%".contains(c));
            if !github && !url {
                return Err("GitHub owner/repo 또는 https 주소를 입력하세요".into());
            }
            run_claude(&["plugin", "marketplace", "add", value], true).map(|_| ())
        }
        "remove" => {
            if !valid_id(value) {
                return Err("invalid marketplace name".into());
            }
            run_claude(&["plugin", "marketplace", "remove", value], true).map(|_| ())
        }
        _ => Err("unknown action".into()),
    }
}

// SKILL.md 앞부분(frontmatter)에서 name/description 추출
fn read_skill_meta(dir: &Path) -> Option<Value> {
    let text = fs::read_to_string(dir.join("SKILL.md")).ok()?;
    let text = text.replace("\r\n", "\n");
    let fm = text.strip_prefix("---\n").and_then(|t| t.split("\n---").next()).unwrap_or("");
    let field = |k: &str| {
        fm.lines()
            .find_map(|l| l.strip_prefix(&format!("{k}:")))
            .map(|v| v.trim().trim_matches(|c| c == '"' || c == '\'').to_string())
            .unwrap_or_default()
    };
    let name = field("name");
    let name = if name.is_empty() { dir.file_name()?.to_string_lossy().to_string() } else { name };
    Some(json!({ "name": name, "description": field("description") }))
}

fn sub_dirs(p: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(p)
        .map(|r| {
            r.flatten()
                .filter(|e| e.path().is_dir() && !e.file_name().to_string_lossy().starts_with('.'))
                .map(|e| e.path())
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

/// 설치된 스킬: 직접 넣은 스킬(~/.claude/skills) + 현재 계정에서 동기화된 스킬(skills/synced/<org>_<account>)
pub fn list_skills(org: Option<&str>, account: Option<&str>) -> Value {
    let root = home().join(".claude").join("skills");
    let local: Vec<Value> = sub_dirs(&root)
        .iter()
        .filter(|d| d.file_name().map(|n| n != "synced").unwrap_or(false))
        .filter_map(|d| read_skill_meta(d))
        .collect();

    let mut synced: Vec<Value> = vec![];
    if let (Some(org), Some(acc)) = (org, account) {
        let dir = root.join("synced").join(format!("{org}_{acc}"));
        synced = match read_json(&dir.join("manifest.json")) {
            Some(m) => m["skills"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|s| json!({ "name": s["name"], "description": s["description"].as_str().unwrap_or("") }))
                .collect(),
            None => sub_dirs(&dir).iter().filter_map(|d| read_skill_meta(d)).collect(),
        };
    }
    json!({ "local": local, "synced": synced })
}

// 실행 중인 Claude Code 세션 수 (데스크톱 앱 본체 Claude.exe는 제외)
pub fn count_claude_processes() -> usize {
    let ps = "@(Get-Process claude -ErrorAction SilentlyContinue | ? { $_.Path -and $_.Path -notlike '*\\WindowsApps\\*' }).Count";
    Command::new("powershell")
        .args(["-NoProfile", "-Command", ps])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()
        .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse().ok())
        .unwrap_or(0)
}

// ---------- 원격 세션 전환 ----------

/// pid부터 부모를 따라 올라가며 가장 가까운 Claude Code(claude.exe) pid를 찾음 (데스크톱 앱 Claude.exe 제외)
pub fn find_claude_ancestor(pid: u32) -> Option<u32> {
    let ps = format!(
        "$all=@{{}}; Get-CimInstance Win32_Process | % {{ $all[[int]$_.ProcessId]=$_ }}; $id={pid}; \
         for($i=0;$i -lt 16;$i++){{ $p=$all[[int]$id]; if(!$p){{break}}; \
         if($p.Name -eq 'claude.exe' -and $p.ExecutablePath -notlike '*\\WindowsApps\\*'){{ $p.ProcessId; break }}; \
         $id=$p.ParentProcessId }}"
    );
    let out = Command::new("powershell")
        .args(["-NoProfile", "-Command", &ps])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    String::from_utf8_lossy(&out.stdout).trim().parse().ok()
}

pub fn valid_session_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// cwd 프로젝트에서 가장 최근에 기록된 세션 (= 지금 명령을 실행 중인 세션)
pub fn newest_session(cwd: &Path) -> Option<String> {
    let key: String = cwd.to_string_lossy().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    let dir = home().join(".claude").join("projects").join(key);
    fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("jsonl"))
        .max_by_key(|e| e.metadata().and_then(|m| m.modified()).ok())
        .and_then(|e| e.path().file_stem().map(|s| s.to_string_lossy().to_string()))
        .filter(|s| valid_session_id(s))
}

pub fn kill_tree(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

/// 새 콘솔 창에서 `claude --resume <id> --remote-control --name <name>` 실행
pub fn launch_remote(cwd: &Path, session: &str, name: &str) -> Result<std::process::Child, String> {
    const CREATE_NEW_CONSOLE: u32 = 0x10;
    // cmd /c로 실행되므로 이름에서 셸 특수문자 제거
    let name: String = name.chars().filter(|c| c.is_alphanumeric() || " _.@-".contains(*c)).collect();
    Command::new("cmd")
        .args(["/c", "claude", "--resume", session, "--remote-control", "--name", name.trim()])
        .current_dir(cwd)
        .creation_flags(CREATE_NEW_CONSOLE)
        .spawn()
        .map_err(|e| e.to_string())
}

const SWITCH_MARK: &str = "<!-- claude-widget: 이 줄을 지우면 위젯이 이 파일을 다시 쓰지 않습니다 -->";

/// ~/.claude/commands/switch.md 설치 (없거나 위젯이 만든 파일이면 현재 exe 경로로 갱신)
pub fn install_switch_command() {
    let Ok(exe) = std::env::current_exe() else { return };
    let path = home().join(".claude").join("commands").join("switch.md");
    let old = fs::read_to_string(&path).ok();
    if old.as_ref().is_some_and(|t| !t.contains(SWITCH_MARK)) {
        return;
    }
    // Bash 도구(Git Bash)에서 실행되므로 / 경로 사용
    let exe = exe.to_string_lossy().replace('\\', "/");
    let log = crate::store::data_dir().join("remote-switch.log").to_string_lossy().replace('\\', "/");
    // 위젯은 창 없는 앱이라 출력이 없음 → 위젯이 남긴 로그를 읽어 결과를 보여줌
    let body = format!(
        "---\ndescription: Claude Widget으로 계정 전환 후 이 세션을 새 계정으로 원격 재실행 (예: /switch personal, 비우면 다른 계정)\n\
         argument-hint: [계정 라벨|이메일]\nallowed-tools: Bash\n---\n{SWITCH_MARK}\n\
         !`rm -f \"{log}\"; \"{exe}\" switch $ARGUMENTS; sleep 3; cat \"{log}\" 2>/dev/null || echo \"위젯 응답 없음 (위젯이 켜져 있는지 확인)\"`\n\n\
         위는 Claude Widget의 계정 전환 결과입니다. 결과를 사용자에게 한 줄로 그대로 전하세요. \
         \"전환 시작\"이면 잠시 뒤 이 세션이 종료되고 새 계정으로 다시 뜬다고 덧붙이세요. 다른 작업은 하지 마세요.\n"
    );
    if old.as_deref() != Some(body.as_str()) {
        let _ = fs::create_dir_all(path.parent().unwrap());
        let _ = fs::write(&path, body);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn switch_command_respects_user_edits() {
        let dir = std::env::temp_dir().join("cw-switch-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::env::set_var("USERPROFILE", &dir);
        let path = dir.join(".claude/commands/switch.md");
        super::install_switch_command();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains(" switch $ARGUMENTS") && !text.contains('\\'));
        std::fs::write(&path, "user edit").unwrap();
        super::install_switch_command();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "user edit");

        // 같은 테스트에서: USERPROFILE을 바꾸므로 병렬로 돌면 서로 간섭함
        let settings = dir.join(".claude/settings.json");
        let other = serde_json::json!({ "matcher": "Bash", "hooks": [{ "type": "command", "command": "gk hook" }] });
        std::fs::write(&settings, serde_json::json!({ "model": "opus", "hooks": { "PostToolUse": [other] } }).to_string()).unwrap();
        super::sync_usage_hook(true).unwrap();
        super::sync_usage_hook(true).unwrap(); // 두 번 켜도 하나만
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&settings).unwrap()).unwrap();
        assert_eq!(v["hooks"]["PostToolUse"].as_array().unwrap().len(), 2);
        assert_eq!(v["hooks"]["UserPromptSubmit"].as_array().unwrap().len(), 1);
        super::sync_usage_hook(false).unwrap();
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&settings).unwrap()).unwrap();
        assert_eq!(v, serde_json::json!({ "model": "opus", "hooks": { "PostToolUse": [other] } }));
    }
}

// ---------- 사용량 경고 훅 (UserPromptSubmit / PostToolUse) ----------

const HOOK_ARG: &str = "usage-hook";

fn settings_path() -> PathBuf {
    home().join(".claude").join("settings.json")
}

fn is_our_hook(group: &Value) -> bool {
    group["hooks"].as_array().is_some_and(|hs| {
        hs.iter().any(|h| h["command"].as_str().is_some_and(|c| c.contains("claude-widget") && c.ends_with(HOOK_ARG)))
    })
}

/// ~/.claude/settings.json에 위젯 훅을 넣거나 뺌 (다른 훅·설정은 그대로)
pub fn sync_usage_hook(enabled: bool) -> Result<(), String> {
    let path = settings_path();
    let mut settings = match fs::read_to_string(&path) {
        Ok(t) => serde_json::from_str::<Value>(&t).map_err(|_| "settings.json 형식 오류 — 건드리지 않음")?,
        Err(_) if !enabled => return Ok(()),
        Err(_) => json!({}),
    };
    let exe = std::env::current_exe().map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/");
    let ours = |matcher: Option<&str>| {
        let mut g = json!({ "hooks": [{ "type": "command", "command": format!("\"{exe}\" {HOOK_ARG}"), "timeout": 10 }] });
        if let Some(m) = matcher {
            g["matcher"] = json!(m);
        }
        g
    };
    let before = settings.clone();
    let hooks = settings.as_object_mut().ok_or("settings.json 형식 오류")?.entry("hooks").or_insert_with(|| json!({}));
    let hooks = hooks.as_object_mut().ok_or("settings.json hooks 형식 오류")?;
    for (event, matcher) in [("UserPromptSubmit", None), ("PostToolUse", Some("*"))] {
        let list = hooks.entry(event).or_insert_with(|| json!([]));
        let Some(arr) = list.as_array_mut() else { continue };
        arr.retain(|g| !is_our_hook(g));
        if enabled {
            arr.push(ours(matcher));
        }
        if arr.is_empty() {
            hooks.remove(event);
        }
    }
    if hooks.is_empty() {
        settings.as_object_mut().unwrap().remove("hooks");
    }
    if settings == before {
        return Ok(());
    }
    let _ = fs::create_dir_all(path.parent().unwrap());
    write_json_atomic(&path, &settings)
}

/// 훅 본체: 현재 계정 사용량이 기준을 넘었으면 Claude에게 전환을 물어보라고 알림. 세션·초기화 주기당 한 번
pub fn run_usage_hook() {
    use std::io::Read;
    let mut input = String::new();
    let _ = std::io::stdin().read_to_string(&mut input);
    let input: Value = serde_json::from_str(&input).unwrap_or(Value::Null);
    if let Some(msg) = usage_hook_message(&input, &crate::store::Store::load()) {
        let event = input["hook_event_name"].as_str().unwrap_or("UserPromptSubmit");
        println!("{}", json!({ "hookSpecificOutput": { "hookEventName": event, "additionalContext": msg } }));
    }
}

fn usage_hook_message(input: &Value, s: &crate::store::Store) -> Option<String> {
    if !s.switch_prompt {
        return None;
    }
    let active = read_live_auth()?["accountUuid"].as_str()?.to_string();
    let me = s.profiles.iter().find(|p| p.id == active)?;
    let usage = me.last_usage.as_ref()?;
    let limit = s.switch_prompt_at as f64;
    let (label, window) = [("세션(5시간)", &usage["session"]), ("주간", &usage["weekly"])]
        .into_iter()
        .find(|(_, w)| w["used"].as_f64().is_some_and(|u| u >= limit))?;
    let others: Vec<String> = s
        .profiles
        .iter()
        .filter(|p| p.id != active)
        .map(|p| if p.label.is_empty() { p.email.clone() } else { format!("{} ({})", p.label, p.email) })
        .collect();
    if others.is_empty() {
        return None;
    }

    // 같은 세션에서 같은 초기화 주기에는 한 번만
    let key = format!("{}|{label}|{}", input["session_id"].as_str().unwrap_or(""), window["resetsAt"].as_str().unwrap_or(""));
    let seen_path = crate::store::data_dir().join("usage-hook-seen.json");
    let mut seen: Vec<String> = read_json(&seen_path).and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
    if seen.contains(&key) {
        return None;
    }
    seen.push(key);
    // shortcut: 최근 200개만 보관, 세션이 아주 많아지면 오래된 기록부터 잊음(그 세션에서 한 번 더 물어볼 수 있음)
    let drop = seen.len().saturating_sub(200);
    seen.drain(..drop);
    let _ = fs::write(&seen_path, json!(seen).to_string());

    let exe = std::env::current_exe().ok()?.to_string_lossy().replace('\\', "/");
    Some(format!(
        "[Claude Widget] 현재 계정({})의 {label} 사용량이 {:.0}%로 기준({limit:.0}%)을 넘었습니다. \
         지금 하던 일을 계속하기 전에 사용자에게 다른 계정으로 전환할지 짧게 물어보세요. 전환 가능한 계정: {}. \
         사용자가 동의하면 Bash로 `\"{exe}\" switch <라벨|이메일>`을 실행하세요 (계정이 2개면 인자 없이 실행해도 다른 계정으로 전환). \
         실행하면 몇 초 뒤 이 세션이 종료되고 같은 대화가 새 계정으로 다시 뜹니다. 사용자가 원하지 않으면 하던 일을 계속하세요.",
        me.email,
        window["used"].as_f64().unwrap_or(0.0),
        others.join(", ")
    ))
}
