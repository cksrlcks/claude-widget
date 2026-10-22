//! 프로젝트(Claude Code를 실행한 폴더)별 토큰 사용량과 낭비 신호 — ~/.claude/projects/**/*.jsonl 집계
//! 여기서는 횟수만 세고, 낭비로 볼지(몇 % 이상 등)와 팁 문구는 화면(src/features/tokens/components/token-section.tsx)에서 정함
//! 아래 기준값을 바꾸면 화면 문구도 같이 맞춤
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

/// 요청 맥락이 이걸 넘은 부분은 "대화를 길게 끈 몫"(초과분)
const EXCESS_CONTEXT: u64 = 100_000;
/// 이만큼 쉰 뒤 캐시 쓰기가 REWRITE 이상이면 "쉬었다 이어가기" (캐시 만료로 맥락을 다시 씀)
const IDLE_SECS: i64 = 5 * 60;
const REWRITE: u64 = 50_000;
/// 도구 결과 하나가 이 글자 수 이상이면 "큰 출력"
const BIG_OUTPUT_CHARS: usize = 40_000;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTokens {
    /// 세션을 시작한 폴더 (세션 중 하위 폴더로 옮겨도 시작 폴더로 묶음)
    pub path: String,
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    /// 사람이 직접 보낸 질문 수 (명령·도구 결과·요약 제외)
    pub prompts: u32,
    /// 메인 대화 요청마다 맥락이 EXCESS_CONTEXT를 넘은 부분의 합
    pub excess: u64,
    /// 응답 수 (서브에이전트 포함)
    pub requests: u32,
    pub sub_requests: u32,
    pub rewrites: u32,
    pub sessions: u32,
    /// 세션 첫 요청 맥락 크기의 중앙값 (MCP 도구·CLAUDE.md 등 기본으로 깔리는 양)
    pub baseline: u64,
    pub big_outputs: u32,
    /// 큰 출력을 낸 도구 상위 3개 (이름, 횟수)
    pub big_tools: Vec<(String, u32)>,
    #[serde(skip)]
    baselines: Vec<u64>,
    #[serde(skip)]
    tools: HashMap<String, u32>,
}

/// 응답 하나. 같은 id가 여러 줄에 남고 마지막 줄이 최종 토큰 수라 덮어씀
struct Req {
    id: String,
    project: String,
    side: bool,
    ts: Option<i64>,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
}

pub fn scan() -> Vec<ProjectTokens> {
    scan_dir(&crate::claude::home().join(".claude").join("projects"))
}

fn scan_dir(root: &Path) -> Vec<ProjectTokens> {
    let mut files = vec![];
    collect_jsonl(root, &mut files);
    // 서브에이전트 기록은 부모 세션의 시작 폴더를 따르므로 부모 세션 파일을 먼저 읽음
    files.sort_by_key(|p| p.components().any(|c| c.as_os_str() == "subagents"));
    let mut projects: HashMap<String, ProjectTokens> = HashMap::new();
    // 이어하기·포크한 세션은 이전 대화를 복사해 두므로 파일을 넘어 중복 제거
    let mut seen = HashSet::new();
    // 세션 id → 시작 폴더
    let mut roots: HashMap<String, String> = HashMap::new();
    for f in files {
        if let Ok(bytes) = fs::read(&f) {
            scan_file(&String::from_utf8_lossy(&bytes), &mut projects, &mut seen, &mut roots);
        }
    }
    let mut out: Vec<_> = projects
        .into_values()
        .map(|mut p| {
            p.baselines.sort_unstable();
            p.baseline = p.baselines.get(p.baselines.len() / 2).copied().unwrap_or(0);
            let mut tools: Vec<_> = p.tools.drain().collect();
            tools.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
            tools.truncate(3);
            p.big_tools = tools;
            p
        })
        .collect();
    out.sort_by_key(|p| std::cmp::Reverse(p.input + p.output + p.cache_read + p.cache_write));
    out
}

fn collect_jsonl(dir: &Path, out: &mut Vec<PathBuf>) {
    for e in fs::read_dir(dir).into_iter().flatten().flatten() {
        let p = e.path();
        if p.is_dir() {
            collect_jsonl(&p, out);
        } else if p.extension().is_some_and(|x| x == "jsonl") {
            out.push(p);
        }
    }
}

fn scan_file(
    text: &str,
    projects: &mut HashMap<String, ProjectTokens>,
    seen: &mut HashSet<String>,
    roots: &mut HashMap<String, String>,
) {
    let mut reqs: Vec<Req> = vec![];
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut tool_names: HashMap<String, String> = HashMap::new();
    let mut root: Option<String> = None;
    for line in text.lines() {
        let has_usage = line.contains("\"usage\"");
        // 큰 도구 결과가 아니면 결과 줄은 파싱할 필요 없음 (바이트 길이 ≥ 글자 수)
        let big_result = line.len() >= BIG_OUTPUT_CHARS && line.contains("\"tool_result\"");
        let maybe_prompt = line.contains("\"type\":\"user\"") && !line.contains("\"tool_result\"");
        if !has_usage && !big_result && !maybe_prompt {
            continue;
        }
        let Ok(j) = serde_json::from_str::<Value>(line) else { continue };
        let side = j["isSidechain"].as_bool().unwrap_or(false);
        if root.is_none() {
            let sid = j["sessionId"].as_str().unwrap_or_default();
            root = roots.get(sid).cloned().or_else(|| j["cwd"].as_str().map(project_key));
            if let (Some(r), false, false) = (&root, side, sid.is_empty()) {
                roots.entry(sid.to_string()).or_insert_with(|| r.clone());
            }
        }
        let project = root.clone().unwrap_or_else(|| "(알 수 없음)".into());

        if maybe_prompt {
            let uuid = j["uuid"].as_str().unwrap_or_default();
            if !side && is_prompt(&j) && (uuid.is_empty() || seen.insert(format!("prompt:{uuid}"))) {
                projects.entry(project.clone()).or_insert_with(|| new_project(&project)).prompts += 1;
            }
            continue;
        }
        let msg = &j["message"];
        for c in msg["content"].as_array().into_iter().flatten() {
            match c["type"].as_str() {
                Some("tool_use") => {
                    if let (Some(id), Some(name)) = (c["id"].as_str(), c["name"].as_str()) {
                        tool_names.insert(id.to_string(), name.to_string());
                    }
                }
                Some("tool_result") if text_len(&c["content"]) >= BIG_OUTPUT_CHARS => {
                    let id = c["tool_use_id"].as_str().unwrap_or_default();
                    if !id.is_empty() && !seen.insert(format!("tool:{id}")) {
                        continue;
                    }
                    let name = tool_names.get(id).cloned();
                    let p = projects.entry(project.clone()).or_insert_with(|| new_project(&project));
                    p.big_outputs += 1;
                    *p.tools.entry(name.unwrap_or_else(|| "기타".into())).or_default() += 1;
                }
                _ => {}
            }
        }
        let (Some(id), Some(u)) = (msg["id"].as_str(), msg["usage"].as_object()) else { continue };
        let n = |k: &str| u.get(k).and_then(Value::as_u64).unwrap_or(0);
        let req = Req {
            id: id.to_string(),
            project,
            side,
            ts: j["timestamp"].as_str().and_then(epoch_secs),
            input: n("input_tokens"),
            output: n("output_tokens"),
            cache_read: n("cache_read_input_tokens"),
            cache_write: n("cache_creation_input_tokens"),
        };
        match index.get(id) {
            // 요청 시각은 첫 줄 기준으로 둠
            Some(&i) => reqs[i] = Req { ts: reqs[i].ts, ..req },
            None => {
                index.insert(id.to_string(), reqs.len());
                reqs.push(req);
            }
        }
    }

    let mut first = true;
    let mut prev_ts: Option<i64> = None;
    for r in reqs {
        if !seen.insert(r.id.clone()) {
            continue;
        }
        let p = projects.entry(r.project.clone()).or_insert_with(|| new_project(&r.project));
        p.input += r.input;
        p.output += r.output;
        p.cache_read += r.cache_read;
        p.cache_write += r.cache_write;
        p.requests += 1;
        if r.side {
            p.sub_requests += 1;
            continue;
        }
        let ctx = r.input + r.cache_read + r.cache_write;
        p.excess += ctx.saturating_sub(EXCESS_CONTEXT);
        if first {
            p.sessions += 1;
            p.baselines.push(ctx);
            first = false;
        } else if let (Some(a), Some(b)) = (prev_ts, r.ts) {
            if b - a >= IDLE_SECS && r.cache_write >= REWRITE {
                p.rewrites += 1;
            }
        }
        prev_ts = r.ts.or(prev_ts);
    }
}

fn new_project(path: &str) -> ProjectTokens {
    ProjectTokens { path: path.to_string(), ..Default::default() }
}

/// 사람이 직접 보낸 질문인지 (슬래시 명령·! 셸·중단 표시·대화 요약·메타 메시지 제외)
fn is_prompt(j: &Value) -> bool {
    if j["isMeta"].as_bool() == Some(true) || j["isCompactSummary"].as_bool() == Some(true) {
        return false;
    }
    let text = match &j["message"]["content"] {
        Value::String(s) => s.as_str(),
        Value::Array(a) => a.iter().find_map(|x| x["text"].as_str()).unwrap_or_default(),
        _ => "",
    };
    let t = text.trim_start();
    !t.is_empty() && !t.starts_with('<') && !t.starts_with("Caveat:") && !t.starts_with("[Request interrupted")
}

/// d:\a와 D:\a는 같은 폴더 (드라이브 문자만 대문자로 맞춤)
fn project_key(cwd: &str) -> String {
    let mut s = cwd.to_string();
    if s.as_bytes().get(1) == Some(&b':') {
        s[..1].make_ascii_uppercase();
    }
    s
}

/// 도구 결과 본문 글자 수 (문자열 또는 [{type:"text", text}] 배열)
fn text_len(v: &Value) -> usize {
    match v {
        Value::String(s) => s.chars().count(),
        Value::Array(a) => a.iter().filter_map(|x| x["text"].as_str()).map(|s| s.chars().count()).sum(),
        _ => 0,
    }
}

/// "2026-10-20T04:36:33.002Z" → 유닉스 초 (UTC, 초 미만 버림)
fn epoch_secs(ts: &str) -> Option<i64> {
    let n = |a: usize, b: usize| ts.get(a..b)?.parse::<i64>().ok();
    let (y, m, d) = (n(0, 4)?, n(5, 7)?, n(8, 10)?);
    let secs = n(11, 13)? * 3600 + n(14, 16)? * 60 + n(17, 19)?;
    // 그레고리력 날짜 → 1970-01-01부터 일 수
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * ((m + 9) % 12) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some((era * 146_097 + doe - 719_468) * 86_400 + secs)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asst(id: &str, cwd: &str, ts: &str, side: bool, out: u64, read: u64, write: u64) -> String {
        format!(
            r#"{{"sessionId":"s1","cwd":"{cwd}","isSidechain":{side},"timestamp":"{ts}","message":{{"id":"{id}","content":[],"usage":{{"input_tokens":1,"output_tokens":{out},"cache_read_input_tokens":{read},"cache_creation_input_tokens":{write}}}}}}}"#
        )
    }

    fn user(uuid: &str, cwd: &str, text: &str) -> String {
        format!(r#"{{"sessionId":"s1","type":"user","uuid":"{uuid}","cwd":"{cwd}","message":{{"content":"{text}"}}}}"#)
    }

    #[test]
    fn aggregates_and_flags() {
        assert_eq!(epoch_secs("1970-01-02T00:00:01.5Z"), Some(86_401));
        assert_eq!(epoch_secs("2026-03-01T00:00:00Z").unwrap() - epoch_secs("2026-02-28T00:00:00Z").unwrap(), 86_400);

        let big = "x".repeat(BIG_OUTPUT_CHARS);
        let tool_use = r#"{"sessionId":"s1","cwd":"d:\\p","message":{"id":"m2","content":[{"type":"tool_use","id":"t1","name":"Read"}],"usage":{"output_tokens":1}}}"#;
        let tool_result = format!(
            r#"{{"sessionId":"s1","type":"user","cwd":"d:\\p\\sub","message":{{"content":[{{"type":"tool_result","tool_use_id":"t1","content":[{{"type":"text","text":"{big}"}}]}}]}}}}"#
        );
        let session = [
            user("u1", "d:\\\\p", "고쳐줘"),
            // 슬래시 명령은 질문으로 안 셈
            user("u2", "d:\\\\p", "<command-name>/clear</command-name>"),
            asst("m1", "d:\\\\p", "2026-01-01T00:00:00Z", false, 5, 60_000, 0),
            // 스트리밍 중간 줄 → 마지막 줄 값으로 덮어씀
            asst("m1", "d:\\\\p", "2026-01-01T00:00:00Z", false, 100, 60_000, 0),
            tool_use.to_string(),
            tool_result,
            // 세션 중 하위 폴더로 옮겨도 시작 폴더로 묶음 + 10분 쉬고 캐시 다시 씀 + 10만 초과
            asst("m3", "D:\\\\p\\\\sub", "2026-01-01T00:10:00Z", false, 10, 100_000, 60_000),
            user("u3", "D:\\\\p\\\\sub", "계속"),
        ]
        .join("\n");
        // 서브에이전트 기록은 하위 폴더에서 돌아도 부모 세션의 시작 폴더로
        let agent = asst("s1", "D:\\\\p\\\\sub", "2026-01-01T00:10:30Z", true, 7, 0, 0);

        let dir = std::env::temp_dir().join(format!("claude-widget-tokens-{}", std::process::id()));
        let sub = dir.join("proj");
        fs::create_dir_all(sub.join("s1").join("subagents")).unwrap();
        fs::write(sub.join("s1").join("subagents").join("agent-x.jsonl"), agent).unwrap();
        fs::write(sub.join("a.jsonl"), &session).unwrap();
        // 포크된 세션이 같은 응답을 복사해도 한 번만 셈
        fs::write(sub.join("b.jsonl"), &session).unwrap();
        let r = scan_dir(&dir);
        fs::remove_dir_all(&dir).unwrap();

        assert_eq!(r.len(), 1);
        let p = &r[0];
        assert_eq!(p.path, "D:\\p");
        assert_eq!((p.output, p.cache_read, p.cache_write), (118, 160_000, 60_000));
        assert_eq!((p.prompts, p.requests, p.sub_requests), (2, 4, 1));
        assert_eq!((p.excess, p.rewrites, p.sessions, p.baseline), (60_001, 1, 1, 60_001));
        assert_eq!((p.big_outputs, p.big_tools.clone()), (1, vec![("Read".to_string(), 1)]));
    }
}
