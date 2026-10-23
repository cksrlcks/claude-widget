// 위젯 데이터 저장소 — Electron 버전과 같은 파일·형식을 그대로 사용
// (Windows: %APPDATA%/claude-widget, macOS: ~/Library/Application Support/claude-widget)
// - store.json: 프로필 메타, 감시 목록, 위젯 위치
// - secrets/<accountUuid>.dpapi(macOS는 .enc): 계정 토큰 (crypto.rs로 암호화)
use crate::crypto;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, path::PathBuf};

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Profile {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub org_name: String,
    pub plan: String,
    pub refresh_expires_at: Option<f64>,
    pub avatar: String,
    pub custom_avatar: Option<String>,
    pub label: String,
    pub last_usage: Option<Value>,
    /// last_usage를 확인한 시각(ms)
    pub last_usage_at: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Position {
    pub right: f64,
    pub y: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Integration {
    pub key: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, rename = "statusText", skip_serializing_if = "Option::is_none")]
    pub status_text: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationResult {
    pub items: Vec<Integration>,
    pub error: Option<String>,
    pub checked_at: f64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Store {
    pub profiles: Vec<Profile>,
    /// 감시할 key 목록. None이면 전체 감시
    pub watch: Option<Vec<String>>,
    pub known_integrations: Vec<Integration>,
    pub last_integrations: Option<IntegrationResult>,
    pub position: Option<Position>,
    pub mcp_interval_min: u64,
    /// 아바타 애니메이션 켜기
    pub avatar_motion: bool,
    /// 고정 위치: "" (자유, 드래그한 곳) | "tl" | "tr" | "bl" | "br"
    pub anchor: String,
    /// 사용량이 switch_prompt_at% 넘으면 Claude Code 세션 안에서 계정 전환을 물어봄 (훅)
    pub switch_prompt: bool,
    pub switch_prompt_at: u64,
}

impl Default for Store {
    fn default() -> Self {
        Store {
            profiles: vec![],
            watch: None,
            known_integrations: vec![],
            last_integrations: None,
            position: None,
            mcp_interval_min: 10,
            avatar_motion: true,
            anchor: String::new(),
            switch_prompt: false,
            switch_prompt_at: 90,
        }
    }
}

#[cfg(windows)]
pub fn data_dir() -> PathBuf {
    PathBuf::from(std::env::var("APPDATA").unwrap_or_default()).join("claude-widget")
}

#[cfg(not(windows))]
pub fn data_dir() -> PathBuf {
    crate::claude::home().join("Library").join("Application Support").join("claude-widget")
}

pub fn backup_dir() -> PathBuf {
    data_dir().join("backups")
}

fn store_path() -> PathBuf {
    data_dir().join("store.json")
}

impl Store {
    /// 읽기·파싱에 실패하면 기본값. 파일이 있는데 실패한 거면 덮어쓰기 전에 store.json.bad로 남겨 복구할 수 있게 함
    pub fn load() -> Store {
        let path = store_path();
        if !path.exists() {
            return Store::default();
        }
        let parsed = fs::read_to_string(&path).map_err(|e| e.to_string()).and_then(|s| serde_json::from_str(&s).map_err(|e| e.to_string()));
        parsed.unwrap_or_else(|e| {
            log(&format!("store.json 읽기 실패, store.json.bad로 보관: {e}"));
            let _ = fs::rename(&path, path.with_extension("json.bad"));
            Store::default()
        })
    }

    pub fn save(&self) {
        let _ = fs::create_dir_all(data_dir());
        let r = serde_json::to_value(self).map_err(|e| e.to_string()).and_then(|v| crate::claude::write_json_atomic(&store_path(), &v));
        if let Err(e) = r {
            log(&format!("store.json 저장 실패: {e}"));
        }
    }
}

/// 오류 기록: <data_dir>/widget.log (1MB 넘으면 widget.log.1로 넘기고 새로 시작). 시각은 UTC
pub fn log(msg: &str) {
    let path = data_dir().join("widget.log");
    if fs::metadata(&path).map(|m| m.len() > 1_000_000).unwrap_or(false) {
        let _ = fs::rename(&path, path.with_extension("log.1"));
    }
    let t = time::OffsetDateTime::now_utc();
    let line = format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}Z {}\n",
        t.year(), t.month() as u8, t.day(), t.hour(), t.minute(), t.second(), msg
    );
    let _ = fs::create_dir_all(data_dir());
    let _ = fs::OpenOptions::new().create(true).append(true).open(&path).and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()));
}

fn secret_path(id: &str, ext: &str) -> PathBuf {
    let safe: String = id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    data_dir().join("secrets").join(format!("{safe}.{ext}"))
}

pub fn save_secret(id: &str, data: &Value) -> Result<(), String> {
    let path = secret_path(id, crypto::SECRET_EXT);
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let enc = crypto::protect(data.to_string().as_bytes())?;
    fs::write(path, enc).map_err(|e| e.to_string())
}

pub fn load_secret(id: &str) -> Option<Value> {
    let enc = fs::read(secret_path(id, crypto::SECRET_EXT)).ok()?;
    serde_json::from_slice(&crypto::unprotect(&enc).ok()?).ok()
}

pub fn delete_secret(id: &str) {
    let _ = fs::remove_file(secret_path(id, crypto::SECRET_EXT));
    let _ = fs::remove_file(secret_path(id, "bin"));
}

#[cfg(test)]
mod tests {
    use super::{data_dir, Profile, Store};

    #[test]
    fn broken_store_is_kept_and_save_round_trips() {
        let dir = std::env::temp_dir().join("cw-store-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::env::set_var("APPDATA", &dir); // Windows data_dir
        std::env::set_var("HOME", &dir); // macOS data_dir (~/Library/…)
        std::fs::create_dir_all(data_dir()).unwrap();
        std::fs::write(data_dir().join("store.json"), "{ not json").unwrap();

        assert!(Store::load().profiles.is_empty());
        assert!(data_dir().join("store.json.bad").exists());
        assert!(std::fs::read_to_string(data_dir().join("widget.log")).unwrap().contains("store.json 읽기 실패"));

        let mut s = Store::default();
        s.profiles.push(Profile { id: "x".into(), plan: "max".into(), ..Default::default() });
        s.save();
        assert_eq!(Store::load().profiles[0].plan, "max");
        assert!(!data_dir().join("store.widget-tmp").exists());
    }
}

/// Electron 버전이 남긴 secrets/*.bin을 DPAPI(.dpapi)로 복사 (.bin은 Electron 버전으로 돌아갈 때를 위해 남김)
#[cfg(windows)]
pub fn migrate_electron_secrets() {
    let dir = data_dir().join("secrets");
    let local_state = data_dir().join("Local State");
    let Ok(entries) = fs::read_dir(&dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("bin") {
            continue;
        }
        let target = path.with_extension("dpapi");
        if target.exists() {
            continue;
        }
        let Ok(data) = fs::read(&path) else { continue };
        let Ok(plain) = crypto::decrypt_electron(&local_state, &data) else { continue };
        if let Ok(enc) = crypto::protect(&plain) {
            let _ = fs::write(&target, enc);
        }
    }
}
