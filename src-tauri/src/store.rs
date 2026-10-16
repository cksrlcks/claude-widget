// 위젯 데이터 저장소 (%APPDATA%/claude-widget) — Electron 버전과 같은 파일·형식을 그대로 사용
// - store.json: 프로필 메타, 감시 목록, 위젯 위치
// - secrets/<accountUuid>.dpapi: 계정 토큰 (DPAPI 암호화)
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
        }
    }
}

pub fn data_dir() -> PathBuf {
    PathBuf::from(std::env::var("APPDATA").unwrap_or_default()).join("claude-widget")
}

pub fn backup_dir() -> PathBuf {
    data_dir().join("backups")
}

fn store_path() -> PathBuf {
    data_dir().join("store.json")
}

impl Store {
    pub fn load() -> Store {
        fs::read_to_string(store_path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }

    pub fn save(&self) {
        let _ = fs::create_dir_all(data_dir());
        if let Ok(s) = serde_json::to_string_pretty(self) {
            let _ = fs::write(store_path(), s);
        }
    }
}

fn secret_path(id: &str, ext: &str) -> PathBuf {
    let safe: String = id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    data_dir().join("secrets").join(format!("{safe}.{ext}"))
}

pub fn save_secret(id: &str, data: &Value) -> Result<(), String> {
    let path = secret_path(id, "dpapi");
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let enc = crypto::protect(data.to_string().as_bytes())?;
    fs::write(path, enc).map_err(|e| e.to_string())
}

pub fn load_secret(id: &str) -> Option<Value> {
    let enc = fs::read(secret_path(id, "dpapi")).ok()?;
    serde_json::from_slice(&crypto::unprotect(&enc).ok()?).ok()
}

pub fn delete_secret(id: &str) {
    let _ = fs::remove_file(secret_path(id, "dpapi"));
    let _ = fs::remove_file(secret_path(id, "bin"));
}

/// Electron 버전이 남긴 secrets/*.bin을 DPAPI(.dpapi)로 복사 (.bin은 Electron 버전으로 돌아갈 때를 위해 남김)
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
