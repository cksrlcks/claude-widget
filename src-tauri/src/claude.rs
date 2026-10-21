// Claude Code 로컬 설정(~/.claude) 읽기/쓰기 + 사용량/MCP/플러그인/스킬 조회
use crate::store::{Integration, IntegrationResult};
use serde_json::{json, Value};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// macOS의 Claude Code는 토큰(.credentials.json 내용)을 파일 대신 이 키체인 항목에 저장
#[cfg(target_os = "macos")]
const KEYCHAIN_SERVICE: &str = "Claude Code-credentials";

pub fn now_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0)
}

#[cfg(windows)]
pub fn home() -> PathBuf {
    PathBuf::from(std::env::var("USERPROFILE").unwrap_or_default())
}
#[cfg(not(windows))]
pub fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
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

// macOS는 키체인 우선, 항목이 없으면 파일(설정에 따라 파일을 쓰는 경우)
fn read_cred() -> Option<Value> {
    #[cfg(target_os = "macos")]
    if let Ok(Some(s)) = crate::keychain::read(KEYCHAIN_SERVICE) {
        return serde_json::from_str(&s).ok();
    }
    read_json(&cred_path())
}

fn write_cred(cred: &Value) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if matches!(crate::keychain::read(KEYCHAIN_SERVICE), Ok(Some(_))) || !cred_path().exists() {
        let account = crate::keychain::account(KEYCHAIN_SERVICE)
            .unwrap_or_else(|| std::env::var("USER").unwrap_or_default());
        return crate::keychain::write(KEYCHAIN_SERVICE, &account, &cred.to_string(), true);
    }
    write_json_atomic(&cred_path(), cred)
}

/// 현재 로그인 상태 스냅샷: { accountUuid, oauth, organizationUuid, oauthAccount, cachedUsage }
pub fn read_live_auth() -> Option<Value> {
    let cred = read_cred()?;
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
    let mut cred = read_cred().unwrap_or_else(|| json!({}));
    let obj = cred.as_object_mut().ok_or("credentials 형식 오류")?;
    obj.insert("claudeAiOauth".into(), auth["oauth"].clone());
    match auth.get("organizationUuid").filter(|v| !v.is_null()) {
        Some(org) => obj.insert("organizationUuid".into(), org.clone()),
        None => obj.remove("organizationUuid"),
    };
    write_cred(&cred)?;

    let mut config = read_json(&config_path()).ok_or(".claude.json 읽기 실패")?;
    config.as_object_mut().ok_or(".claude.json 형식 오류")?.insert("oauthAccount".into(), auth["oauthAccount"].clone());
    write_json_atomic(&config_path(), &config)
}

pub fn backup_live_files(dir: &Path) {
    let _ = fs::create_dir_all(dir);
    let stamp = format!("{}", now_ms() as u64);
    // macOS 키체인에 있는 토큰은 평문 파일로 꺼내 두지 않음 (파일로 쓰는 경우만 백업)
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

#[cfg(windows)]
fn claude_command() -> Command {
    let mut cmd = Command::new("cmd");
    cmd.arg("/C").arg("claude").creation_flags(CREATE_NO_WINDOW);
    cmd
}
#[cfg(not(windows))]
fn claude_command() -> Command {
    Command::new("claude")
}

/// claude CLI 실행 (창 없이). strict면 종료 코드 실패 시 출력이 있어도 에러
pub fn run_claude(args: &[&str], strict: bool) -> Result<String, String> {
    let out = claude_command()
        .args(args)
        .current_dir(home())
        .stdin(Stdio::null())
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

/// 설치된 Claude Code 버전 ("2.1.153 (Claude Code)" → "2.1.153")
pub fn claude_version() -> Result<String, String> {
    let out = run_claude(&["--version"], true)?;
    out.split_whitespace().next().map(String::from).filter(|v| !v.is_empty()).ok_or_else(|| "버전을 읽지 못했습니다".into())
}

/// Claude Code 업데이트 명령: Homebrew로 설치했으면 brew(claude update는 brew 설치를 갱신하지 않음), 아니면 자체 업데이트
pub fn claude_update_command() -> &'static str {
    #[cfg(not(windows))]
    {
        let installed = std::env::var("PATH").unwrap_or_default().split(':').map(|d| Path::new(d).join("claude")).find(|p| p.exists());
        if installed.and_then(|p| fs::canonicalize(p).ok()).is_some_and(|p| p.to_string_lossy().contains("/Caskroom/")) {
            return "brew upgrade --cask claude-code";
        }
    }
    "claude update"
}

/// 보이는 터미널 창에서 명령 실행 (프롬프트·브라우저 인증용). 창이 닫힐 때까지 대기
#[cfg(windows)]
pub fn run_in_terminal(title: &str, command: &str) {
    let script = format!("{command} & echo. & echo Done. Press any key to close. & pause >nul");
    let _ = Command::new("cmd.exe")
        .raw_arg(format!("/c start \"{title}\" /wait cmd /c \"{script}\""))
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

/// 셸 인자용 작은따옴표 감싸기
#[cfg(not(windows))]
fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// macOS: zsh 스크립트를 Terminal.app 새 창에서 실행 (대화형 셸 창이라 사용자 PATH(nvm·homebrew 등)가 그대로 적용됨)
/// 성공하면 그 창의 id
#[cfg(not(windows))]
fn open_in_terminal(body: &str) -> Option<String> {
    let script = std::env::temp_dir().join(format!("claude-widget-{}-{}.sh", std::process::id(), now_ms() as u64));
    // 스크립트는 시작하자마자 자기 파일을 지움
    if fs::write(&script, format!("#!/bin/zsh\nrm -f \"$0\"\n{body}")).is_err() {
        return None;
    }
    // do script는 새 창의 셸에 명령을 "입력"하는 방식이라, 셸 시작 중에 키 입력을 읽는 설정(oh-my-zsh 업데이트 질문 등)이
    // 첫 글자를 가져가 버림 → 앞에 공백을 붙여 그 질문에는 공백(=아니오)이 가고 명령은 그대로 남게 함 (zsh는 앞 공백 무시)
    let apple = format!(
        "tell application \"Terminal\"\nactivate\ndo script \" exec /bin/zsh '{}'\"\nreturn id of front window\nend tell",
        script.display()
    );
    let id = Command::new("osascript")
        .args(["-e", &apple])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    if id.is_none() {
        let _ = fs::remove_file(&script);
    }
    id
}

/// macOS: 위젯이 연 Terminal 창 닫기. Terminal 설정이 "셸 종료 시 윈도우 닫지 않음"이면 [프로세스 완료됨]으로 남기 때문
/// (이미 닫혔으면 아무 일 없음)
#[cfg(not(windows))]
fn close_terminal_window(id: &str) {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
        return;
    }
    let apple = format!("tell application \"Terminal\" to close (every window whose id is {id})");
    let _ = Command::new("osascript").args(["-e", &apple]).output();
}

/// macOS: Terminal.app 새 창에서 실행. 스크립트가 끝나면(키 입력·창 닫기) 표시 파일을 남기고, 그때까지 대기
#[cfg(not(windows))]
pub fn run_in_terminal(title: &str, command: &str) {
    use std::time::{Duration, Instant};
    let done = std::env::temp_dir().join(format!("claude-widget-{}-{}.done", std::process::id(), now_ms() as u64));
    let touch = format!("touch {}", sh_quote(&done.to_string_lossy()));
    let body = format!(
        "trap {} EXIT\ntrap 'exit 1' HUP INT TERM\nprintf '\\e]0;%s\\a' {}\nclear\n{command}\necho\necho 'Done. Press any key to close.'\nread -sk 1\n",
        sh_quote(&touch),
        sh_quote(title),
    );
    if let Some(window) = open_in_terminal(&body) {
        let deadline = Instant::now() + Duration::from_secs(30 * 60);
        while !done.exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(500));
        }
        if done.exists() {
            // 표시 파일은 셸이 끝나기 직전(EXIT trap)에 생김 → 셸이 완전히 끝난 뒤 닫아야 "종료할까요?"를 묻지 않음
            std::thread::sleep(Duration::from_millis(500));
            close_terminal_window(&window);
        }
    }
    let _ = fs::remove_file(&done);
}

/// Finder·로그인 항목으로 실행된 앱은 PATH가 /usr/bin:/bin 정도라 claude를 못 찾음
/// → 로그인 셸의 PATH를 가져와 적용 (스레드를 만들기 전, 시작할 때 한 번 호출)
#[cfg(not(windows))]
pub fn fix_path_env() {
    use std::time::{Duration, Instant};
    const MARK: &str = "__CLAUDE_WIDGET_PATH__";
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut path = String::new();
    if let Ok(mut child) = Command::new(&shell)
        .args(["-ilc", &format!("printf '{MARK}%s{MARK}' \"$PATH\"")])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        // 셸 설정이 멈춰도 앱 시작이 막히지 않게 5초 제한
        let deadline = Instant::now() + Duration::from_secs(5);
        while matches!(child.try_wait(), Ok(None)) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = child.kill();
        if let Ok(out) = child.wait_with_output() {
            let text = String::from_utf8_lossy(&out.stdout).to_string();
            if let Some(v) = text.split(MARK).nth(1) {
                path = v.to_string();
            }
        }
    }
    if path.is_empty() {
        path = std::env::var("PATH").unwrap_or_default();
    }
    // 셸 설정에서 못 가져온 경우를 위해 Claude Code·Homebrew 기본 설치 위치 추가
    let mut parts: Vec<String> = path.split(':').filter(|p| !p.is_empty()).map(String::from).collect();
    for extra in [home().join(".local/bin").display().to_string(), "/opt/homebrew/bin".into(), "/usr/local/bin".into()] {
        if !parts.contains(&extra) {
            parts.push(extra);
        }
    }
    std::env::set_var("PATH", parts.join(":"));
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
#[cfg(windows)]
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

// macOS: 이름이 정확히 claude인 프로세스 (데스크톱 앱 본체는 "Claude"라 제외됨)
#[cfg(not(windows))]
pub fn count_claude_processes() -> usize {
    Command::new("pgrep")
        .args(["-x", "claude"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().filter(|l| !l.trim().is_empty()).count())
        .unwrap_or(0)
}

// ---------- 원격 세션 전환 ----------

/// pid부터 부모를 따라 올라가며 가장 가까운 Claude Code(claude.exe) pid를 찾음 (데스크톱 앱 Claude.exe 제외)
#[cfg(windows)]
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

/// macOS: (pid, ppid, 실행 파일 경로) 목록
#[cfg(not(windows))]
fn process_table() -> Vec<(u32, u32, String)> {
    let Ok(out) = Command::new("ps").args(["-A", "-o", "pid=,ppid=,comm="]).output() else { return vec![] };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| {
            let mut it = l.trim_start().splitn(2, char::is_whitespace);
            let pid = it.next()?.parse().ok()?;
            let mut it = it.next()?.trim_start().splitn(2, char::is_whitespace);
            let ppid = it.next()?.parse().ok()?;
            Some((pid, ppid, it.next().unwrap_or("").trim().to_string()))
        })
        .collect()
}

/// macOS: 실행 파일 이름이 claude인 가장 가까운 조상 (데스크톱 앱 본체는 "Claude"라 제외됨)
#[cfg(not(windows))]
pub fn find_claude_ancestor(pid: u32) -> Option<u32> {
    let table = process_table();
    let mut id = pid;
    for _ in 0..16 {
        let (_, ppid, comm) = table.iter().find(|p| p.0 == id)?;
        if Path::new(comm).file_name().is_some_and(|n| n == "claude") {
            return Some(id);
        }
        id = *ppid;
    }
    None
}

pub fn valid_session_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// cwd 프로젝트에서 가장 최근에 기록된 세션 (= 지금 명령을 실행 중인 세션)
fn project_dir(cwd: &Path) -> PathBuf {
    let key: String = cwd.to_string_lossy().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    home().join(".claude").join("projects").join(key)
}

pub fn newest_session(cwd: &Path) -> Option<String> {
    fs::read_dir(project_dir(cwd))
        .ok()?
        .flatten()
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("jsonl"))
        .max_by_key(|e| e.metadata().and_then(|m| m.modified()).ok())
        .and_then(|e| e.path().file_stem().map(|s| s.to_string_lossy().to_string()))
        .filter(|s| valid_session_id(s))
}

#[cfg(windows)]
pub fn kill_tree(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

/// macOS: pid와 모든 자식 프로세스를 강제 종료 (taskkill /T /F와 같게)
#[cfg(not(windows))]
pub fn kill_tree(pid: u32) {
    // 0·1은 프로세스 그룹·launchd라 절대 보내면 안 됨
    if pid <= 1 {
        return;
    }
    let table = process_table();
    let mut tree = vec![pid];
    let mut i = 0;
    while i < tree.len() {
        let parent = tree[i];
        tree.extend(table.iter().filter(|p| p.1 == parent && p.0 > 1).map(|p| p.0));
        i += 1;
    }
    let _ = Command::new("/bin/kill").arg("-KILL").args(tree.iter().map(|p| p.to_string())).status();
}

/// 다시 띄운 세션 (롤백 판단용으로 살아 있는지 확인)
pub struct RemoteProcess {
    #[cfg(windows)]
    child: std::process::Child,
    /// macOS: Terminal 창의 스크립트가 exec 직전에 남기는 claude pid
    #[cfg(not(windows))]
    pid_file: PathBuf,
}

impl RemoteProcess {
    #[cfg(windows)]
    pub fn running(&mut self) -> bool {
        self.child.try_wait().ok().flatten().is_none()
    }

    #[cfg(not(windows))]
    pub fn running(&mut self) -> bool {
        let Some(pid) = fs::read_to_string(&self.pid_file).ok().and_then(|s| s.trim().parse::<u32>().ok()) else { return false };
        Command::new("/bin/kill").args(["-0", &pid.to_string()]).status().is_ok_and(|s| s.success())
    }
}

#[cfg(not(windows))]
impl Drop for RemoteProcess {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.pid_file);
    }
}

/// 새 콘솔 창에서 `claude --resume <id> --remote-control` 실행. fork면 대화를 복사한 새 세션으로
/// (--name은 붙이지 않음: 같은 세션을 이어갈 때 원래 대화 제목을 덮어씀)
#[cfg(windows)]
pub fn launch_remote(cwd: &Path, session: &str, fork: bool) -> Result<RemoteProcess, String> {
    const CREATE_NEW_CONSOLE: u32 = 0x10;
    // 시작 시 확인 질문이 뜨면 아무도 답할 수 없어 Remote Control 등록 전에 멈춤 → 질문을 띄우는 설정을 미리 꺼 둠
    let settings = unattended_settings(cwd);
    // 원격 목록 이름: 없으면 PC 이름으로 뜸. --remote-control <이름>은 원격 쪽 이름만 정하고 대화 제목은 그대로 둠
    let title = fs::read_to_string(project_dir(cwd).join(format!("{session}.jsonl"))).ok().and_then(|t| session_title(&t));
    Command::new("cmd")
        .args(["/c", "claude", "--resume", session, "--remote-control"])
        .args(title)
        .args(fork.then_some("--fork-session"))
        .args(settings.iter().flat_map(|p| ["--settings".into(), p.to_string_lossy().to_string()]))
        .current_dir(cwd)
        .creation_flags(CREATE_NEW_CONSOLE)
        .spawn()
        .map(|child| RemoteProcess { child })
        .map_err(|e| e.to_string())
}

/// macOS: Terminal.app 새 창에서 실행 (Windows의 새 콘솔 창과 같은 역할)
#[cfg(not(windows))]
pub fn launch_remote(cwd: &Path, session: &str, fork: bool) -> Result<RemoteProcess, String> {
    let settings = unattended_settings(cwd);
    let title = fs::read_to_string(project_dir(cwd).join(format!("{session}.jsonl"))).ok().and_then(|t| session_title(&t));
    let mut args: Vec<String> = ["claude", "--resume", session, "--remote-control"].map(String::from).to_vec();
    args.extend(title);
    if fork {
        args.push("--fork-session".into());
    }
    if let Some(p) = settings {
        args.extend(["--settings".into(), p.to_string_lossy().to_string()]);
    }
    let pid_file = std::env::temp_dir().join(format!("claude-widget-remote-{session}-{}.pid", now_ms() as u64));
    let command = args.iter().map(|a| sh_quote(a)).collect::<Vec<_>>().join(" ");
    // exec로 claude가 이 셸의 pid를 그대로 이어받음 → pid 파일로 생존 확인
    let body = format!(
        "cd {} || exit 1\necho $$ > {}\nexec {command}\n",
        sh_quote(&cwd.to_string_lossy()),
        sh_quote(&pid_file.to_string_lossy())
    );
    // 원격으로 이어 쓰는 세션 창이라 위젯이 닫지 않음
    if open_in_terminal(&body).is_none() {
        return Err("터미널 실행 실패".into());
    }
    Ok(RemoteProcess { pid_file })
}

/// 대화 기록(jsonl)의 제목: 마지막 custom-title(직접 지정), 없으면 마지막 ai-title. cmd /c로 넘기므로 셸 특수문자 제거
/// (macOS는 sh_quote로 감싸므로 그대로 써도 됨)
fn session_title(jsonl: &str) -> Option<String> {
    let (mut custom, mut ai, mut first) = (None, None, None);
    for line in jsonl.lines().filter(|l| l.contains("-title\"") || l.contains("\"type\":\"user\"")) {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        match v["type"].as_str() {
            Some("custom-title") => custom = v["customTitle"].as_str().map(String::from),
            Some("ai-title") => ai = v["aiTitle"].as_str().map(String::from),
            // 짧은 대화는 제목이 아직 없음 → 첫 질문 내용 (도구 결과·명령 래퍼(<command-...>)·메타 메시지는 제외)
            Some("user") if first.is_none() && v["isMeta"] != Value::Bool(true) => {
                first = v["message"]["content"].as_str().filter(|t| !t.trim_start().starts_with('<')).map(|t| {
                    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
                    if t.chars().count() > 40 { format!("{}…", t.chars().take(40).collect::<String>()) } else { t }
                });
            }
            _ => {}
        }
    }
    let t: String = custom.or(ai).or(first)?.chars().filter(|c| !c.is_control() && !"\"&|<>^%!".contains(*c)).take(60).collect();
    let t = t.trim().to_string();
    (!t.is_empty()).then_some(t)
}

/// 다시 띄울 세션용 설정 파일: 아직 승인 안 한 프로젝트 MCP 서버(.mcp.json)를 꺼서 "새 MCP 서버 발견" 질문을 막음.
/// 원래 세션에서도 승인 전이라 안 쓰던 서버들이므로 동작은 같음
fn unattended_settings(cwd: &Path) -> Option<PathBuf> {
    let mcp = read_json(&cwd.join(".mcp.json"))?;
    let off = unapproved_mcp(&mcp, &read_json(&config_path()).unwrap_or(Value::Null), cwd);
    if off.is_empty() {
        return None;
    }
    let path = crate::store::data_dir().join("relaunch-settings.json");
    fs::write(&path, json!({ "disabledMcpjsonServers": off }).to_string()).ok()?;
    Some(path)
}

fn unapproved_mcp(mcp_json: &Value, claude_json: &Value, cwd: &Path) -> Vec<String> {
    let norm = |p: &str| p.replace('\\', "/").trim_end_matches('/').to_lowercase();
    let here = norm(&cwd.to_string_lossy());
    let project = claude_json["projects"]
        .as_object()
        .and_then(|ps| ps.iter().find(|(k, _)| norm(k) == here).map(|(_, v)| v.clone()))
        .unwrap_or(Value::Null);
    if project["enableAllProjectMcpServers"] == Value::Bool(true) {
        return vec![];
    }
    let approved: Vec<&str> = project["enabledMcpjsonServers"].as_array().map(|a| a.iter().filter_map(|v| v.as_str()).collect()).unwrap_or_default();
    mcp_json["mcpServers"]
        .as_object()
        .map(|m| m.keys().filter(|k| !approved.contains(&k.as_str())).cloned().collect())
        .unwrap_or_default()
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
         위는 Claude Widget의 계정 전환 결과입니다. 결과 문장을 사용자에게 그대로 전하세요. 다른 작업은 하지 마세요.\n"
    );
    if old.as_deref() != Some(body.as_str()) {
        let _ = fs::create_dir_all(path.parent().unwrap());
        let _ = fs::write(&path, body);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn session_title_prefers_custom() {
        let ai = r#"{"type":"ai-title","aiTitle":"자동 제목"}"#;
        let custom = r#"{"type":"custom-title","customTitle":"내 제목 & 100%"}"#;
        assert_eq!(super::session_title(ai).as_deref(), Some("자동 제목"));
        assert_eq!(super::session_title(&format!("{ai}
{custom}
{ai}")).as_deref(), Some("내 제목  100"));
        assert_eq!(super::session_title(r#"{"type":"user"}"#), None);
        // 제목이 없으면 첫 질문 (명령 래퍼·도구 결과는 건너뜀), 제목이 생기면 제목 우선
        let cmd = r#"{"type":"user","message":{"content":"<command-name>/remote-control</command-name>"}}"#;
        let tool = r#"{"type":"user","message":{"content":[{"type":"tool_result"}]}}"#;
        let hi = r#"{"type":"user","message":{"content":"안녕\n반가워"}}"#;
        assert_eq!(super::session_title(&[cmd, tool, hi].join("\n")).as_deref(), Some("안녕 반가워"));
        assert_eq!(super::session_title(&[hi, ai].join("\n")).as_deref(), Some("자동 제목"));
    }

    #[test]
    fn unapproved_mcp_skips_approved() {
        use serde_json::json;
        let mcp = json!({ "mcpServers": { "a": {}, "b": {} } });
        let cfg = json!({ "projects": { "D:/proj": { "enabledMcpjsonServers": ["a"] } } });
        assert_eq!(super::unapproved_mcp(&mcp, &cfg, std::path::Path::new("D:\\proj")), vec!["b"]);
        let all = json!({ "projects": { "D:/proj": { "enableAllProjectMcpServers": true } } });
        assert!(super::unapproved_mcp(&mcp, &all, std::path::Path::new("D:\\proj")).is_empty());
        assert_eq!(super::unapproved_mcp(&mcp, &json!({}), std::path::Path::new("D:\\proj")).len(), 2);
    }

    #[test]
    fn switch_command_respects_user_edits() {
        let dir = std::env::temp_dir().join("cw-switch-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::env::set_var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }, &dir);
        let path = dir.join(".claude/commands/switch.md");
        super::install_switch_command();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains(" switch $ARGUMENTS") && !text.contains('\\'));
        std::fs::write(&path, "user edit").unwrap();
        super::install_switch_command();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "user edit");

        // 같은 테스트에서: USERPROFILE(macOS는 HOME)을 바꾸므로 병렬로 돌면 서로 간섭함
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
    let log = crate::store::data_dir().join("remote-switch.log").to_string_lossy().replace('\\', "/");
    Some(format!(
        "[Claude Widget] 현재 계정({})의 {label} 사용량이 {:.0}%로 기준({limit:.0}%)을 넘었습니다. \
         지금 하던 일을 계속하기 전에 사용자에게 다른 계정으로 전환할지 짧게 물어보세요. 전환 가능한 계정: {}. \
         사용자가 동의하면 Bash로 `\"{exe}\" switch <라벨|이메일>; sleep 3; cat \"{log}\"`을 실행하고 \
         (계정이 2개면 <라벨|이메일>을 비워도 다른 계정으로 전환) 출력된 결과 문장을 사용자에게 그대로 전하세요. \
         사용자가 원하지 않으면 하던 일을 계속하세요.",
        me.email,
        window["used"].as_f64().unwrap_or(0.0),
        others.join(", ")
    ))
}
