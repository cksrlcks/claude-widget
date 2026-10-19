#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod claude;
mod crypto;
mod store;
mod updates;

use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use std::time::Duration;
use store::{Integration, Profile, Store};
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

// 새 계정에 아직 안 쓴 아바타부터 배정 (src/shared/lib/pixel-sprites.ts의 키와 맞춤)
const AVATAR_KEYS: [&str; 8] = ["a1", "slime", "ghost", "cat", "frog", "chick", "bunny", "dino"];
const FULL_W: f64 = 236.0;
const MINI: f64 = 60.0;

struct Runtime {
    active_id: Option<String>,
    org_id: Option<String>,
    logged_in: bool,
    usage: Value,
    usage_source: Option<String>,
    usage_error: Option<String>,
    /// 토큰이 서버에서 거부됨 → 다시 로그인 필요
    auth_problem: Option<String>,
    usage_fetched_at: f64,
    checking: bool,
    mini: bool,
    full_height: f64,
}

struct AppState {
    store: Mutex<Store>,
    rt: Mutex<Runtime>,
    catalog: Mutex<Value>,
    move_gen: AtomicU64,
    update: Mutex<updates::UpdateState>,
}

fn state(app: &AppHandle) -> tauri::State<'_, AppState> {
    app.state::<AppState>()
}

// ---------- 상태 ----------

// 같은 이름의 로컬 MCP가 있으면 claude.ai 커넥터는 중복이므로 목록에서 제외
fn visible_known(s: &Store) -> Vec<Integration> {
    let locals: Vec<String> = s
        .last_integrations
        .as_ref()
        .map(|r| {
            r.items
                .iter()
                .filter(|i| i.kind == "mcp" && !i.name.starts_with("claude.ai "))
                .map(|i| i.name.to_lowercase())
                .collect()
        })
        .unwrap_or_default();
    s.known_integrations
        .iter()
        .filter(|k| !(k.name.starts_with("claude.ai ") && locals.contains(&k.name[10..].to_lowercase())))
        .cloned()
        .collect()
}

// 예전에 발견됐는데 지금 계정 목록에 없는 항목도 "끊어짐"(missing)으로 포함
fn watched_items(s: &Store) -> Vec<Integration> {
    let Some(last) = &s.last_integrations else { return vec![] };
    visible_known(s)
        .into_iter()
        .filter(|k| s.watch.as_ref().map(|w| w.contains(&k.key)).unwrap_or(true))
        .map(|k| {
            last.items.iter().find(|i| i.key == k.key).cloned().unwrap_or(Integration {
                status: Some("missing".into()),
                status_text: Some("현재 계정에 없음".into()),
                ..k
            })
        })
        .collect()
}

fn build_state(app: &AppHandle) -> Value {
    let st = state(app);
    let s = st.store.lock().unwrap().clone();
    let rt = st.rt.lock().unwrap();
    let items = watched_items(&s);
    let broken: Vec<&Integration> =
        items.iter().filter(|i| !matches!(i.status.as_deref(), Some("ok") | Some("off"))).collect();
    let now = claude::now_ms();
    let profiles: Vec<Value> = s
        .profiles
        .iter()
        .map(|p| {
            let mut v = serde_json::to_value(p).unwrap();
            v["refreshExpired"] = json!(p.refresh_expires_at.map(|t| t < now).unwrap_or(false));
            v
        })
        .collect();
    let all_items = s.last_integrations.as_ref().map(|r| r.items.clone()).unwrap_or_default();
    json!({
        "profiles": profiles,
        "activeId": rt.active_id,
        "loggedIn": rt.logged_in,
        "usage": rt.usage,
        "usageSource": rt.usage_source,
        "usageError": rt.usage_error,
        "authProblem": rt.auth_problem,
        "integrations": {
            "checking": rt.checking,
            "checkedAt": s.last_integrations.as_ref().map(|r| r.checked_at),
            "error": s.last_integrations.as_ref().and_then(|r| r.error.clone()),
            "total": items.len(),
            "broken": broken,
            "items": all_items,
            "known": visible_known(&s),
            "watch": s.watch,
        },
        "skills": claude::list_skills(rt.org_id.as_deref(), rt.active_id.as_deref()),
        "plugins": all_items.iter().filter(|i| i.kind == "plugin").collect::<Vec<_>>(),
        "mcpIntervalMin": s.mcp_interval_min,
        "avatarMotion": s.avatar_motion,
        "anchor": s.anchor,
        "autoStart": app.autolaunch().is_enabled().unwrap_or(false),
        "mini": rt.mini,
        "update": st.update.lock().unwrap().to_json(&app.package_info().version.to_string()),
    })
}

fn broadcast(app: &AppHandle) {
    let s = build_state(app);
    let _ = app.emit("state", &s);
    update_tray(app, &s);
}

fn profile_from_auth(live: &Value, existing: Option<&Profile>, all: &[Profile]) -> Profile {
    let a = &live["oauthAccount"];
    let o = &live["oauth"];
    let s = |v: &Value| v.as_str().unwrap_or("").to_string();
    let email = s(&a["emailAddress"]);
    let display = [s(&a["displayName"]), s(&a["fullName"]), email.clone()].into_iter().find(|x| !x.is_empty()).unwrap_or_default();
    let avatar = existing.map(|e| e.avatar.clone()).filter(|x| !x.is_empty()).unwrap_or_else(|| {
        AVATAR_KEYS.iter().find(|k| !all.iter().any(|p| p.avatar == **k)).unwrap_or(&"a1").to_string()
    });
    Profile {
        id: s(&live["accountUuid"]),
        email,
        display_name: display,
        org_name: s(&a["organizationName"]),
        plan: s(&o["subscriptionType"]),
        refresh_expires_at: o["refreshTokenExpiresAt"].as_f64(),
        avatar,
        custom_avatar: existing.and_then(|e| e.custom_avatar.clone()),
        label: existing.map(|e| e.label.clone()).unwrap_or_default(),
        last_usage: existing.and_then(|e| e.last_usage.clone()),
    }
}

// 현재 로그인 계정을 읽어 프로필과 동기화. 토큰이 갱신(회전)됐을 수 있어 매번 덮어쓴다
fn sync_live_auth(app: &AppHandle) -> Option<Value> {
    let st = state(app);
    let live = claude::read_live_auth();
    {
        let mut rt = st.rt.lock().unwrap();
        rt.logged_in = live.is_some();
        rt.active_id = live.as_ref().and_then(|l| l["accountUuid"].as_str().map(String::from));
        rt.org_id = live.as_ref().and_then(|l| {
            l["oauthAccount"]["organizationUuid"].as_str().or(l["organizationUuid"].as_str()).map(String::from)
        });
    }
    let live = live?;
    let id = live["accountUuid"].as_str()?.to_string();
    let _ = store::save_secret(
        &id,
        &json!({
            "accountUuid": id, "oauth": live["oauth"],
            "organizationUuid": live["organizationUuid"], "oauthAccount": live["oauthAccount"],
        }),
    );
    let mut s = st.store.lock().unwrap();
    let existing = s.profiles.iter().find(|p| p.id == id).cloned();
    let meta = profile_from_auth(&live, existing.as_ref(), &s.profiles);
    match s.profiles.iter_mut().find(|p| p.id == id) {
        Some(p) => *p = meta,
        None => s.profiles.push(meta),
    }
    s.save();
    Some(live)
}

async fn refresh_status(app: AppHandle, force: bool) {
    let Some(live) = sync_live_auth(&app) else {
        let st = state(&app);
        let mut rt = st.rt.lock().unwrap();
        rt.usage = Value::Null;
        rt.usage_source = None;
        rt.auth_problem = None;
        drop(rt);
        return broadcast(&app);
    };
    let id = live["accountUuid"].as_str().unwrap_or("").to_string();
    let need = {
        let st = state(&app);
        let rt = st.rt.lock().unwrap();
        force || claude::now_ms() - rt.usage_fetched_at > 180_000.0 || rt.usage_source.as_deref() != Some("live")
    };
    if need {
        let expired = live["oauth"]["expiresAt"].as_f64().map(|t| t < claude::now_ms()).unwrap_or(false);
        let result = if expired {
            Err("토큰 만료 (Claude Code 실행 시 자동 갱신)".to_string())
        } else {
            claude::fetch_usage(live["oauth"]["accessToken"].as_str().unwrap_or("")).await
        };
        let st = state(&app);
        let mut rt = st.rt.lock().unwrap();
        match result {
            Ok(u) => {
                rt.usage = claude::summarize_usage(&u);
                rt.usage_source = Some("live".into());
                rt.usage_error = None;
                rt.usage_fetched_at = claude::now_ms();
            }
            Err(e) => {
                rt.usage_error = Some(e);
                let cached = &live["cachedUsage"];
                if cached["accountUuid"].as_str() == Some(id.as_str()) {
                    rt.usage = claude::summarize_usage(&cached["utilization"]);
                    rt.usage_source = Some("cache".into());
                } else {
                    let stored = st.store.lock().unwrap().profiles.iter().find(|p| p.id == id).and_then(|p| p.last_usage.clone());
                    rt.usage_source = stored.as_ref().map(|_| "stored".to_string());
                    rt.usage = stored.unwrap_or(Value::Null);
                }
            }
        }
        // 파일에 토큰이 있어도 서버가 거부(401/403)하거나 리프레시 토큰까지 만료면 실제로는 로그아웃 상태
        let refresh_expired =
            live["oauth"]["refreshTokenExpiresAt"].as_f64().map(|t| t < claude::now_ms()).unwrap_or(false);
        let rejected = matches!(rt.usage_error.as_deref(), Some("usage 401" | "usage 403"));
        rt.auth_problem = (refresh_expired || rejected).then(|| "로그인이 풀렸습니다".to_string());
    }
    {
        let st = state(&app);
        let usage = st.rt.lock().unwrap().usage.clone();
        if !usage.is_null() {
            let mut s = st.store.lock().unwrap();
            if let Some(p) = s.profiles.iter_mut().find(|p| p.id == id) {
                p.last_usage = Some(usage);
            }
            s.save();
        }
    }
    broadcast(&app);
}

async fn check_integrations(app: AppHandle) {
    {
        let st = state(&app);
        let mut rt = st.rt.lock().unwrap();
        if rt.checking {
            return;
        }
        rt.checking = true;
    }
    broadcast(&app);
    let result = tauri::async_runtime::spawn_blocking(claude::check_integrations).await;
    {
        let st = state(&app);
        if let Ok(result) = result {
            let mut s = st.store.lock().unwrap();
            for i in &result.items {
                if !s.known_integrations.iter().any(|k| k.key == i.key) {
                    s.known_integrations.push(Integration { status: None, status_text: None, ..i.clone() });
                }
            }
            s.last_integrations = Some(result);
            s.save();
        }
        st.rt.lock().unwrap().checking = false;
    }
    broadcast(&app);
}

fn spawn_check(app: &AppHandle) {
    tauri::async_runtime::spawn(check_integrations(app.clone()));
}

// ---------- 계정 전환 ----------

async fn switch_account_inner(app: AppHandle, id: String) -> bool {
    if state(&app).rt.lock().unwrap().active_id.as_deref() == Some(id.as_str()) {
        return true;
    }
    let target = store::load_secret(&id);
    let meta = state(&app).store.lock().unwrap().profiles.iter().find(|p| p.id == id).cloned();
    let (Some(target), Some(meta)) = (target, meta) else {
        app.dialog()
            .message("저장된 계정 정보가 없습니다. 해당 계정으로 다시 로그인해 주세요.")
            .title("전환 실패")
            .kind(MessageDialogKind::Error)
            .blocking_show();
        return false;
    };

    let procs = tauri::async_runtime::spawn_blocking(claude::count_claude_processes).await.unwrap_or(0);
    if procs > 0 {
        let ok = app
            .dialog()
            .message(format!(
                "{} 계정으로 전환할까요?\n\n실행 중인 Claude Code 세션이 {procs}개 있습니다.\n이미 열린 세션은 재시작해야 새 계정이 적용됩니다.",
                meta.email
            ))
            .title("계정 전환")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom("전환".into(), "취소".into()))
            .blocking_show();
        if !ok {
            return false;
        }
    }

    if let Err(e) = apply_switch(&app, &target).await {
        app.dialog().message(e).title("전환 실패").kind(MessageDialogKind::Error).blocking_show();
        return false;
    }
    true
}

async fn apply_switch(app: &AppHandle, target: &Value) -> Result<(), String> {
    sync_live_auth(app); // 현재 계정의 최신 토큰을 먼저 저장
    claude::backup_live_files(&store::backup_dir());
    claude::apply_auth(target)?;
    state(app).rt.lock().unwrap().usage_fetched_at = 0.0;
    refresh_status(app.clone(), true).await;
    spawn_check(app);
    Ok(())
}

// ---------- 원격 세션 전환 (CLI: claude-widget switch <계정> [--session <id>]) ----------
// Remote Control 세션 안의 Claude가 실행 → 계정 교체 → 그 Claude 종료 → 같은 대화를 새 계정으로 --remote-control 재실행

struct SwitchRequest {
    profile: String,
    session: Option<String>,
    caller: u32,
}

fn parse_switch(args: &[String]) -> Option<SwitchRequest> {
    let i = args.iter().position(|a| a == "switch")?;
    let flag = |name: &str| args.iter().position(|a| a == name).and_then(|j| args.get(j + 1)).cloned();
    Some(SwitchRequest {
        profile: args.get(i + 1).filter(|a| !a.starts_with("--"))?.clone(),
        session: flag("--session"),
        caller: flag("--caller").and_then(|p| p.parse().ok()).unwrap_or(0),
    })
}

fn remote_log(msg: &str) {
    let _ = std::fs::create_dir_all(store::data_dir());
    let _ = std::fs::write(store::data_dir().join("remote-switch.log"), format!("{} {msg}\n", claude::now_ms() as u64));
}

fn find_profile(app: &AppHandle, q: &str) -> Option<Profile> {
    let q = q.to_lowercase();
    state(app).store.lock().unwrap().profiles.iter().find(|p| {
        [&p.label, &p.email, &p.id].iter().any(|v| v.to_lowercase() == q)
    }).cloned()
}

async fn remote_switch(app: AppHandle, req: SwitchRequest, cwd: std::path::PathBuf) {
    if let Err(e) = remote_switch_inner(&app, req, cwd).await {
        remote_log(&format!("실패: {e}"));
    }
}

async fn remote_switch_inner(app: &AppHandle, req: SwitchRequest, cwd: std::path::PathBuf) -> Result<(), String> {
    let prev = sync_live_auth(app).ok_or("현재 로그인 정보 없음")?;
    let meta = find_profile(app, &req.profile).ok_or(format!("계정 없음: {}", req.profile))?;
    let target = store::load_secret(&meta.id).ok_or("저장된 계정 정보 없음")?;
    let session = match req.session {
        Some(s) if claude::valid_session_id(&s) => Some(s),
        Some(s) => return Err(format!("잘못된 세션 ID: {s}")),
        None if req.caller > 0 => claude::newest_session(&cwd),
        None => None,
    };
    if req.caller > 0 && session.is_none() {
        return Err(format!("세션을 찾지 못함: {}", cwd.display()));
    }
    apply_switch(app, &target).await?;
    let (Some(session), true) = (session, req.caller > 0) else {
        remote_log(&format!("전환됨: {}", meta.email));
        return Ok(());
    };

    // 원격 화면에 Claude의 답이 전달될 시간을 준 뒤 종료
    tokio::time::sleep(Duration::from_secs(5)).await;
    claude::kill_tree(req.caller);
    tokio::time::sleep(Duration::from_secs(2)).await;
    let name = |p: &Profile| if p.label.is_empty() { p.email.clone() } else { p.label.clone() };
    let mut child = claude::launch_remote(&cwd, &session, &name(&meta))?;

    // shortcut: 프로세스가 30초 안에 죽은 경우만 롤백, Remote Control 등록 실패(프로세스는 살아 있음)는 감지 못 함
    tokio::time::sleep(Duration::from_secs(30)).await;
    if child.try_wait().ok().flatten().is_none() {
        remote_log(&format!("전환됨: {} / 세션 {session}", meta.email));
        return Ok(());
    }
    apply_switch(app, &prev).await?;
    let prev_meta = find_profile(app, prev["accountUuid"].as_str().unwrap_or("")).unwrap_or_default();
    claude::launch_remote(&cwd, &session, &name(&prev_meta))?;
    Err(format!("{} 계정으로 실행 실패 → 이전 계정으로 롤백", meta.email))
}

fn switch_account(app: &AppHandle, id: String) {
    tauri::async_runtime::spawn(switch_account_inner(app.clone(), id));
}

// ---------- 플러그인 스토어 ----------

async fn load_catalog(app: AppHandle) {
    {
        let st = state(&app);
        let mut c = st.catalog.lock().unwrap();
        if c["loading"] == true {
            return;
        }
        c["loading"] = json!(true);
        c["error"] = Value::Null;
        if c.get("items").is_none() {
            c["items"] = json!([]);
        }
    }
    let _ = app.emit("catalog", state(&app).catalog.lock().unwrap().clone());
    let result = tauri::async_runtime::spawn_blocking(|| {
        let items = claude::list_plugin_catalog()?;
        let markets = claude::list_marketplaces()?;
        Ok::<_, String>((items, markets))
    })
    .await
    .unwrap_or_else(|e| Err(e.to_string()));
    {
        let st = state(&app);
        let mut c = st.catalog.lock().unwrap();
        c["loading"] = json!(false);
        match result {
            Ok((items, markets)) => {
                c["items"] = json!(items);
                c["marketplaces"] = json!(markets);
                c["fetchedAt"] = json!(claude::now_ms());
            }
            Err(e) => c["error"] = json!(e),
        }
    }
    let _ = app.emit("catalog", state(&app).catalog.lock().unwrap().clone());
}

fn after_plugin_change(app: &AppHandle) {
    tauri::async_runtime::spawn(load_catalog(app.clone()));
    spawn_check(app);
}

// ---------- 창 ----------

fn widget(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("widget")
}

// 위젯 크기·위치(px) 계산
fn widget_target(app: &AppHandle, w: &WebviewWindow) -> Option<(PhysicalSize<u32>, PhysicalPosition<i32>)> {
    let (mini, full_h, pos, anchor) = {
        let st = state(app);
        let s = st.store.lock().unwrap();
        let rt = st.rt.lock().unwrap();
        (rt.mini, rt.full_height, s.position.clone(), s.anchor.clone())
    };
    let monitor = pos
        .as_ref()
        .and_then(|p| app.monitor_from_point(p.right - 1.0, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())?;
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let (ax, ay) = (area.position.x as f64, area.position.y as f64);
    let (aw, ah) = (area.size.width as f64, area.size.height as f64);
    let (w_px, h_px) = if mini { (MINI * scale, MINI * scale) } else { (FULL_W * scale, full_h * scale) };
    let margin = 16.0 * scale;

    let (right, y) = match anchor.as_str() {
        // 고정 위치: 모서리 기준이라 미니/확장 전환해도 그 모서리에 붙어 있음
        "tl" | "tr" | "bl" | "br" => (
            if anchor.ends_with('l') { ax + margin + w_px } else { ax + aw - margin },
            if anchor.starts_with('t') { ay + margin } else { ay + ah - margin - h_px },
        ),
        // 저장된 위치는 "보이는 카드의 오른쪽 끝" 기준 → 미니/확장 전환 시 오른쪽 정렬 유지. 화면 밖이면 안쪽으로 보정
        _ => (
            pos.as_ref().map(|p| p.right).unwrap_or(ax + aw - margin).clamp(ax + w_px, ax + aw),
            pos.as_ref().map(|p| p.y).unwrap_or(ay + ah * 0.3).clamp(ay, (ay + ah - h_px).max(ay)),
        ),
    };
    Some((
        PhysicalSize::new(w_px.round() as u32, h_px.round() as u32),
        PhysicalPosition::new((right - w_px - frame_border(w)).round() as i32, y.round() as i32),
    ))
}

fn place_widget(app: &AppHandle) {
    let Some(w) = widget(app) else { return };
    let Some((size, pos)) = widget_target(app, &w) else { return };
    let _ = w.set_size(size);
    let _ = w.set_position(pos);
}

/// Windows가 창 좌우에 두는 보이지 않는 테두리 폭(px). set_position은 이 테두리 바깥 기준이라 보정에 필요
fn frame_border(w: &WebviewWindow) -> f64 {
    match (w.outer_size(), w.inner_size()) {
        (Ok(o), Ok(i)) => (o.width.saturating_sub(i.width) as f64) / 2.0,
        _ => 0.0,
    }
}

fn create_widget(app: &AppHandle) -> tauri::Result<()> {
    let w = WebviewWindowBuilder::new(app, "widget", WebviewUrl::App("widget.html".into()))
        .title("Claude Widget")
        .inner_size(FULL_W, 210.0)
        // 투명 창: 둥근 카드·원형 미니 모드의 가장자리를 부드럽게 (모양은 CSS가 그림)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build()?;
    place_widget(app);
    let _ = w.show();

    // 드래그로 옮긴 위치 저장 (이동 이벤트가 연속으로 오므로 0.4초 뒤 마지막 위치만 저장)
    let handle = app.clone();
    w.on_window_event(move |e| {
        if let WindowEvent::Moved(p) = e {
            let gen = state(&handle).move_gen.fetch_add(1, Ordering::SeqCst) + 1;
            let (app, p) = (handle.clone(), *p);
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(400)).await;
                if state(&app).move_gen.load(Ordering::SeqCst) != gen {
                    return;
                }
                let Some(w) = widget(&app) else { return };
                // place_widget과 같은 기준(보이는 카드의 오른쪽 끝)으로 저장해야 전환할 때마다 위치가 밀리지 않음
                let width = w.inner_size().map(|s| s.width as f64).unwrap_or(0.0);
                let right = p.x as f64 + frame_border(&w) + width;
                let anchored = {
                    let st = state(&app);
                    let mut s = st.store.lock().unwrap();
                    s.position = Some(store::Position { right, y: p.y as f64 });
                    s.save();
                    !s.anchor.is_empty()
                };
                // 고정 위치면 놓은 모니터의 모서리로 되돌림 (이미 그 자리면 그대로 → 이동 이벤트 반복 방지)
                if anchored && widget_target(&app, &w).is_some_and(|(_, t)| t != p) {
                    place_widget(&app);
                }
            });
        }
    });
    Ok(())
}

// 위젯은 포커스를 받지 않는 창이라 새 창이 뒤로 갈 수 있음 → 잠깐 최상위로 올려 앞으로 꺼냄
fn bring_to_front(w: &WebviewWindow) {
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_always_on_top(true);
    let _ = w.set_focus();
    let w2 = w.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        let _ = w2.set_always_on_top(false);
    });
}

// 위젯이 있는 모니터의 작업 영역 정중앙으로 이동
fn center_on_widget_monitor(app: &AppHandle, w: &WebviewWindow) {
    let monitor = widget(app)
        .and_then(|wd| wd.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let (Some(m), Ok(size)) = (monitor, w.outer_size()) else { return };
    let area = m.work_area();
    let x = area.position.x + (area.size.width as i32 - size.width as i32) / 2;
    let y = area.position.y + (area.size.height as i32 - size.height as i32) / 2;
    let _ = w.set_position(PhysicalPosition::new(x, y.max(area.position.y)));
}

fn open_window(app: &AppHandle, label: &str, file: &str, title: &str, size: (f64, f64)) {
    if let Some(w) = app.get_webview_window(label) {
        center_on_widget_monitor(app, &w);
        return bring_to_front(&w);
    }
    if let Ok(w) = WebviewWindowBuilder::new(app, label, WebviewUrl::App(file.into()))
        .title(title)
        .inner_size(size.0, size.1)
        .min_inner_size(480.0, 400.0)
        .background_color(tauri::window::Color(19, 20, 23, 255))
        .visible(false)
        .build()
    {
        center_on_widget_monitor(app, &w);
        bring_to_front(&w);
    }
}

fn open_settings(app: &AppHandle) {
    open_window(app, "settings", "settings.html", "Claude 위젯 설정", (560.0, 720.0));
}

fn open_store(app: &AppHandle) {
    open_window(app, "store", "store.html", "플러그인 스토어", (760.0, 760.0));
    let empty = state(app).catalog.lock().unwrap()["items"].as_array().map(|a| a.is_empty()).unwrap_or(true);
    if empty {
        tauri::async_runtime::spawn(load_catalog(app.clone()));
    }
}

fn toggle_widget(app: &AppHandle) {
    if let Some(w) = widget(app) {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
        }
    }
}

// ---------- 메뉴·트레이 ----------

fn build_menu(app: &AppHandle, s: &Value, for_tray: bool) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    let active = s["activeId"].as_str().unwrap_or("");
    for p in s["profiles"].as_array().cloned().unwrap_or_default() {
        let id = p["id"].as_str().unwrap_or("");
        let name = p["label"].as_str().filter(|l| !l.is_empty()).or(p["displayName"].as_str()).unwrap_or("");
        let label = format!("{name}  ({})", p["email"].as_str().unwrap_or(""));
        menu.append(&CheckMenuItem::with_id(app, format!("switch:{id}"), label, true, id == active, None::<&str>)?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    if for_tray {
        menu.append(&MenuItem::with_id(app, "toggle", "위젯 보이기/숨기기", true, None::<&str>)?)?;
    }
    menu.append(&MenuItem::with_id(app, "recheck", "MCP 상태 다시 확인", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "store", "플러그인 스토어", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "settings", "설정", true, None::<&str>)?)?;
    let update_label = match s["update"]["available"]["version"].as_str() {
        Some(v) => format!("v{v}로 업데이트"),
        None => "업데이트 확인".to_string(),
    };
    menu.append(&MenuItem::with_id(app, "update", update_label, true, None::<&str>)?)?;
    if !for_tray {
        menu.append(&MenuItem::with_id(app, "hide", "위젯 숨기기 (트레이에서 다시 열기)", true, None::<&str>)?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?)?;
    Ok(menu)
}

fn handle_menu(app: &AppHandle, id: &str) {
    match id {
        "toggle" => toggle_widget(app),
        "recheck" => spawn_check(app),
        // 메뉴 이벤트는 메인 스레드에서 오므로 창 생성은 백그라운드에서
        "store" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { open_store(&app) });
        }
        "settings" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { open_settings(&app) });
        }
        "hide" => {
            if let Some(w) = widget(app) {
                let _ = w.hide();
            }
        }
        "quit" => app.exit(0),
        "update" => {
            let has_update = state(app).update.lock().unwrap().available.is_some();
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if has_update {
                    updates::install(app).await
                } else {
                    updates::check(app).await
                }
            });
        }
        other => {
            if let Some(acc) = other.strip_prefix("switch:") {
                switch_account(app, acc.to_string());
            }
        }
    }
}

fn update_tray(app: &AppHandle, s: &Value) {
    let Some(tray) = app.tray_by_id("main") else { return };
    let active = s["profiles"]
        .as_array()
        .and_then(|ps| ps.iter().find(|p| p["id"] == s["activeId"]))
        .and_then(|p| p["email"].as_str())
        .unwrap_or("로그인 안 됨")
        .to_string();
    let used = s["usage"]["session"]["used"].as_f64().map(|u| format!("{}%", u.round())).unwrap_or("-".into());
    let broken = s["integrations"]["broken"].as_array().map(|a| a.len()).unwrap_or(0);
    let version = &app.package_info().version;
    let _ = tray.set_tooltip(Some(format!("Claude Widget v{version}\n{active}\n세션 사용 {used} · 끊김 {broken}")));
    if let Ok(menu) = build_menu(app, s, true) {
        let _ = tray.set_menu(Some(menu));
    }
}

// ---------- 프런트에서 호출하는 명령 ----------

#[tauri::command]
fn get_state(app: AppHandle) -> Value {
    build_state(&app)
}

#[tauri::command]
async fn refresh(app: AppHandle) {
    refresh_status(app.clone(), true).await;
    spawn_check(&app);
}

#[tauri::command]
fn recheck(app: AppHandle) {
    spawn_check(&app);
}

// 창 생성은 반드시 async 명령에서 (Windows에서 sync 명령 안에서 만들면 메인 스레드 교착)
#[tauri::command]
async fn open_settings_cmd(app: AppHandle) {
    open_settings(&app);
}

#[tauri::command]
async fn open_store_cmd(app: AppHandle) {
    open_store(&app);
}

#[tauri::command]
async fn switch_account_cmd(app: AppHandle, id: String) -> bool {
    switch_account_inner(app, id).await
}

#[tauri::command]
fn login_new(app: AppHandle) {
    sync_live_auth(&app);
    claude::backup_live_files(&store::backup_dir());
    std::thread::spawn(move || {
        claude::run_in_terminal("Claude Login", "claude auth login");
        tauri::async_runtime::block_on(refresh_status(app.clone(), true));
        spawn_check(&app);
    });
}

// 인증 필요한 MCP를 터미널에서 순서대로 로그인 (브라우저 열림) → 창 닫히면 다시 확인
#[tauri::command]
fn mcp_login(app: AppHandle, names: Vec<String>) {
    let safe: Vec<String> = names
        .into_iter()
        .filter(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_alphanumeric() || " .:@/-_".contains(c)))
        .collect();
    if safe.is_empty() {
        return;
    }
    let steps = safe.iter().map(|n| format!("echo. & echo === {n} === & claude mcp login \"{n}\"")).collect::<Vec<_>>().join(" & ");
    std::thread::spawn(move || {
        claude::run_in_terminal("MCP Login", &steps);
        spawn_check(&app);
    });
}

#[tauri::command]
fn open_connectors(app: AppHandle) {
    let _ = app.opener().open_url("https://claude.ai/customize/connectors", None::<&str>);
}

#[tauri::command]
fn open_url(app: AppHandle, url: String) {
    if url.starts_with("https://") {
        let _ = app.opener().open_url(url, None::<&str>);
    }
}

#[tauri::command]
fn remove_profile(app: AppHandle, id: String) -> bool {
    let st = state(&app);
    if st.rt.lock().unwrap().active_id.as_deref() == Some(id.as_str()) {
        return false;
    }
    store::delete_secret(&id);
    {
        let mut s = st.store.lock().unwrap();
        s.profiles.retain(|p| p.id != id);
        s.save();
    }
    broadcast(&app);
    true
}

#[tauri::command]
fn update_profile(app: AppHandle, id: String, patch: Value) {
    {
        let st = state(&app);
        let mut s = st.store.lock().unwrap();
        if let Some(p) = s.profiles.iter_mut().find(|p| p.id == id) {
            if let Some(v) = patch["avatar"].as_str() {
                p.avatar = v.into();
            }
            if let Some(v) = patch["customAvatar"].as_str() {
                p.custom_avatar = Some(v.into());
            }
            if let Some(v) = patch["label"].as_str() {
                p.label = v.into();
            }
        }
        s.save();
    }
    broadcast(&app);
}

#[tauri::command]
fn set_watch(app: AppHandle, keys: Option<Vec<String>>) {
    {
        let st = state(&app);
        let mut s = st.store.lock().unwrap();
        s.watch = keys;
        s.save();
    }
    broadcast(&app);
}

#[tauri::command]
fn set_interval(app: AppHandle, min: f64) {
    {
        let st = state(&app);
        let mut s = st.store.lock().unwrap();
        s.mcp_interval_min = if min >= 1.0 { min as u64 } else { 10 };
        s.save();
    }
    broadcast(&app);
}

#[tauri::command]
fn set_avatar_motion(app: AppHandle, on: bool) {
    {
        let st = state(&app);
        let mut s = st.store.lock().unwrap();
        s.avatar_motion = on;
        s.save();
    }
    broadcast(&app);
}

#[tauri::command]
fn set_anchor(app: AppHandle, anchor: String) {
    if !["", "tl", "tr", "bl", "br"].contains(&anchor.as_str()) {
        return;
    }
    {
        let st = state(&app);
        let mut s = st.store.lock().unwrap();
        s.anchor = anchor;
        s.save();
    }
    place_widget(&app);
    broadcast(&app);
}

#[tauri::command]
fn set_auto_start(app: AppHandle, on: bool) {
    let al = app.autolaunch();
    let _ = if on { al.enable() } else { al.disable() };
    broadcast(&app);
}

#[tauri::command]
fn set_mini(app: AppHandle, value: bool) {
    state(&app).rt.lock().unwrap().mini = value;
    place_widget(&app);
    broadcast(&app);
}

#[tauri::command]
fn set_height(app: AppHandle, h: f64) {
    let mini = {
        let st = state(&app);
        let mut rt = st.rt.lock().unwrap();
        rt.full_height = h.round().clamp(120.0, 420.0);
        rt.mini
    };
    if !mini {
        place_widget(&app);
    }
}

#[tauri::command]
async fn check_update_cmd(app: AppHandle) {
    updates::check(app).await;
}

#[tauri::command]
async fn install_update_cmd(app: AppHandle) {
    updates::install(app).await;
}

#[tauri::command]
fn account_menu(app: AppHandle) {
    let s = build_state(&app);
    if let (Some(w), Ok(menu)) = (widget(&app), build_menu(&app, &s, false)) {
        let _ = w.popup_menu(&menu);
    }
}

#[tauri::command]
fn store_catalog(app: AppHandle) -> Value {
    state(&app).catalog.lock().unwrap().clone()
}

#[tauri::command]
fn store_reload(app: AppHandle) {
    tauri::async_runtime::spawn(load_catalog(app));
}

#[tauri::command]
fn store_install(app: AppHandle, id: String) {
    if !claude::valid_plugin_id(&id) {
        return;
    }
    std::thread::spawn(move || {
        claude::run_in_terminal("Plugin Install", &format!("claude plugin install {id}"));
        after_plugin_change(&app);
    });
}

#[tauri::command]
async fn store_action(app: AppHandle, action: String, id: String) -> Result<(), String> {
    let r = tauri::async_runtime::spawn_blocking(move || claude::plugin_action(&action, &id)).await.map_err(|e| e.to_string())?;
    after_plugin_change(&app);
    r
}

// 에러는 { error }로 돌려줘 화면에 메시지를 그대로 표시
#[tauri::command]
async fn store_marketplace(app: AppHandle, action: String, value: String) -> Value {
    let r = tauri::async_runtime::spawn_blocking(move || claude::marketplace_action(&action, &value))
        .await
        .unwrap_or_else(|e| Err(e.to_string()));
    match r {
        Ok(()) => {
            load_catalog(app).await;
            json!({ "ok": true })
        }
        Err(e) => json!({ "error": e }),
    }
}

fn main() {
    // switch 명령: 자기를 부른 Claude Code의 pid를 붙여 다시 실행 (실행 중인 위젯이 받아 처리)
    let args: Vec<String> = std::env::args().collect();
    if parse_switch(&args).is_some() && !args.iter().any(|a| a == "--caller") {
        let caller = claude::find_claude_ancestor(std::process::id()).unwrap_or(0);
        let _ = std::process::Command::new(&args[0]).args(&args[1..]).args(["--caller", &caller.to_string()]).spawn();
        return;
    }
    store::migrate_electron_secrets();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if let Some(req) = parse_switch(&args) {
                tauri::async_runtime::spawn(remote_switch(app.clone(), req, cwd.into()));
            } else if let Some(w) = widget(app) {
                let _ = w.show();
            }
        }))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            store: Mutex::new(Store::load()),
            rt: Mutex::new(Runtime {
                active_id: None,
                org_id: None,
                logged_in: false,
                usage: Value::Null,
                usage_source: None,
                usage_error: None,
                auth_problem: None,
                usage_fetched_at: 0.0,
                checking: false,
                mini: false,
                full_height: 210.0,
            }),
            catalog: Mutex::new(json!({ "items": [] })),
            move_gen: AtomicU64::new(0),
            update: Mutex::new(updates::UpdateState::default()),
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            refresh,
            recheck,
            open_settings_cmd,
            open_store_cmd,
            switch_account_cmd,
            login_new,
            mcp_login,
            open_connectors,
            open_url,
            remove_profile,
            update_profile,
            set_watch,
            set_interval,
            set_auto_start,
            set_avatar_motion,
            set_anchor,
            set_mini,
            set_height,
            account_menu,
            store_catalog,
            store_reload,
            store_install,
            store_action,
            store_marketplace,
            check_update_cmd,
            install_update_cmd,
        ])
        .on_menu_event(|app, e| handle_menu(app, e.id().as_ref()))
        .setup(|app| {
            let handle = app.handle().clone();
            create_widget(&handle)?;
            claude::install_switch_command();
            // 위젯이 꺼져 있을 때 switch 명령으로 시작된 경우
            if let Some(req) = parse_switch(&std::env::args().collect::<Vec<_>>()) {
                let cwd = std::env::current_dir().unwrap_or_default();
                tauri::async_runtime::spawn(remote_switch(handle.clone(), req, cwd));
            }

            let tray_icon = Image::from_bytes(include_bytes!("../../assets/tray@2x.png"))?;
            TrayIconBuilder::with_id("main")
                .icon(tray_icon)
                .tooltip("Claude Widget")
                .menu(&build_menu(&handle, &build_state(&handle), true)?)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        toggle_widget(tray.app_handle());
                    }
                })
                .build(app)?;

            // 업데이트: 시작 10초 뒤, 이후 6시간마다
            let h = handle.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(10)).await;
                loop {
                    updates::check(h.clone()).await;
                    tokio::time::sleep(Duration::from_secs(6 * 60 * 60)).await;
                }
            });

            // 상태 1분, MCP 설정 간격, 최상위 유지 5초
            let h = handle.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    refresh_status(h.clone(), false).await;
                    tokio::time::sleep(Duration::from_secs(60)).await;
                }
            });
            let h = handle.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    check_integrations(h.clone()).await;
                    let min = state(&h).store.lock().unwrap().mcp_interval_min.max(1);
                    tokio::time::sleep(Duration::from_secs(min * 60)).await;
                }
            });
            let h = handle.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(5)).await;
                    if let Some(w) = widget(&h) {
                        if w.is_visible().unwrap_or(false) {
                            let _ = w.set_always_on_top(true);
                        }
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build app")
        .run(|_, e| {
            // 설정·스토어 창을 닫아도 앱은 트레이에 남음
            if let tauri::RunEvent::ExitRequested { api, code: None, .. } = e {
                api.prevent_exit();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::parse_switch;

    #[test]
    fn parses_switch_args() {
        let a = |s: &str| s.split(' ').map(String::from).collect::<Vec<_>>();
        let r = parse_switch(&a("exe switch personal --session abc-1 --caller 42")).unwrap();
        assert_eq!((r.profile.as_str(), r.session.as_deref(), r.caller), ("personal", Some("abc-1"), 42));
        let r = parse_switch(&a("exe switch me@x.com")).unwrap();
        assert_eq!((r.session, r.caller), (None, 0));
        assert!(parse_switch(&a("exe switch --session x")).is_none());
        assert!(parse_switch(&a("exe")).is_none());
    }
}
