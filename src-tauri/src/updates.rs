// 앱 업데이트: GitHub Release의 latest.json으로 새 버전 확인 → 다운로드·설치 (Windows는 설치 프로그램이 앱을 종료하고 교체)
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

use crate::claude::now_ms;

#[derive(Default)]
pub struct UpdateState {
    /// 새 버전 정보 { version, notes, date }. None이면 최신
    pub available: Option<Value>,
    pub checking: bool,
    pub installing: bool,
    /// 다운로드 진행률 0~100
    pub progress: Option<u8>,
    pub error: Option<String>,
    pub checked_at: Option<f64>,
}

impl UpdateState {
    pub fn to_json(&self, current: &str) -> Value {
        json!({
            "current": current,
            "available": self.available,
            "checking": self.checking,
            "installing": self.installing,
            "progress": self.progress,
            "error": self.error,
            "checkedAt": self.checked_at,
        })
    }
}

fn update_state(app: &AppHandle) -> &Mutex<UpdateState> {
    &app.state::<crate::AppState>().inner().update
}

pub async fn check(app: AppHandle) {
    {
        let mut u = update_state(&app).lock().unwrap();
        if u.checking || u.installing {
            return;
        }
        u.checking = true;
        u.error = None;
    }
    crate::broadcast(&app);

    let result = match app.updater() {
        Ok(updater) => updater.check().await.map_err(|e| e.to_string()),
        Err(e) => Err(e.to_string()),
    };
    {
        let mut u = update_state(&app).lock().unwrap();
        match result {
            Ok(Some(found)) => {
                u.available = Some(json!({
                    "version": found.version,
                    "notes": found.body,
                    "date": found.date.map(|d| d.to_string()),
                }))
            }
            Ok(None) => u.available = None,
            Err(e) => u.error = Some(e),
        }
        u.checking = false;
        u.checked_at = Some(now_ms());
    }
    crate::broadcast(&app);
}

pub async fn install(app: AppHandle) {
    {
        let mut u = update_state(&app).lock().unwrap();
        if u.installing {
            return;
        }
        u.installing = true;
        u.progress = Some(0);
        u.error = None;
    }
    crate::broadcast(&app);

    let result: Result<(), String> = async {
        let found = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
        let found = found.ok_or("이미 최신 버전입니다")?;
        let handle = app.clone();
        let mut downloaded: u64 = 0;
        found
            .download_and_install(
                move |chunk, total| {
                    downloaded += chunk as u64;
                    let Some(total) = total.filter(|t| *t > 0) else { return };
                    let pct = ((downloaded * 100) / total).min(100) as u8;
                    // 1% 단위로만 화면 갱신
                    let changed = {
                        let mut u = update_state(&handle).lock().unwrap();
                        let changed = u.progress != Some(pct);
                        u.progress = Some(pct);
                        changed
                    };
                    if changed {
                        crate::broadcast(&handle);
                    }
                },
                || {},
            )
            .await
            .map_err(|e| e.to_string())
    }
    .await;

    match result {
        // Windows에서는 보통 여기까지 오기 전에 설치 프로그램이 앱을 종료함
        Ok(()) => app.restart(),
        Err(e) => {
            let mut u = update_state(&app).lock().unwrap();
            u.installing = false;
            u.progress = None;
            u.error = Some(e);
        }
    }
    crate::broadcast(&app);
}
