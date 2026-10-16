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
