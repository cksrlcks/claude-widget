// macOS 키체인 (generic password) 읽기/쓰기
// Security.framework 대신 /usr/bin/security를 거침 → Claude Code가 만든 항목도 같은 방식으로 접근하고,
// 서명 안 된 앱을 다시 빌드할 때마다 키체인 접근 허용을 다시 묻지 않음
use std::{
    io::Write,
    process::{Command, Stdio},
};

/// security 종료 코드: 항목 없음
const NOT_FOUND: i32 = 44;

/// 비밀번호 값. 항목이 없으면 Ok(None)
pub fn read(service: &str) -> Result<Option<String>, String> {
    let out = Command::new("/usr/bin/security")
        .args(["find-generic-password", "-s", service, "-w"])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.code() == Some(NOT_FOUND) {
        return Ok(None);
    }
    if !out.status.success() {
        return Err(format!("키체인 읽기 실패: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(Some(String::from_utf8_lossy(&out.stdout).trim_end_matches('\n').to_string()))
}

/// 항목의 계정(acct) 이름
pub fn account(service: &str) -> Option<String> {
    let out = Command::new("/usr/bin/security")
        .args(["find-generic-password", "-s", service])
        .stdin(Stdio::null())
        .output()
        .ok()?;
    // 형식: `    "acct"<blob>="heavybear"`
    String::from_utf8_lossy(&out.stdout).lines().find_map(|l| {
        let v = l.trim().strip_prefix("\"acct\"<blob>=\"")?.strip_suffix('"')?;
        Some(v.to_string())
    })
}

/// `security -i`가 한 줄에서 읽는 최대 길이. 넘으면 잘린 앞부분이 그대로 실행돼 잘린 값이 저장됨
const INTERACTIVE_LINE_MAX: usize = 4000;

/// 저장. update면 기존 항목을 덮어쓰고, 아니면 이미 있을 때 실패. 저장 후 다시 읽어 같은 값인지 확인
/// 값은 가능하면 인자 목록(ps로 보임)이 아니라 `security -i`의 표준 입력으로 hex 전달, 길면 인자로 전달
/// (에러 메시지에는 값이 섞이지 않게 security의 오류 코드만 담음)
pub fn write(service: &str, account: &str, value: &str, update: bool) -> Result<(), String> {
    let safe = |s: &str| !s.is_empty() && !s.chars().any(|c| c == '"' || c == '\\' || c.is_control());
    if !safe(service) || !safe(account) {
        return Err("키체인 이름 형식 오류".into());
    }
    let hex: String = value.bytes().map(|b| format!("{b:02x}")).collect();
    let flag = if update { " -U" } else { "" };
    let line = format!("add-generic-password{flag} -a \"{account}\" -s \"{service}\" -X {hex}\n");

    let out = if line.len() <= INTERACTIVE_LINE_MAX {
        let mut child = Command::new("/usr/bin/security")
            .arg("-i")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        child.stdin.take().ok_or("stdin 없음")?.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        child.wait_with_output().map_err(|e| e.to_string())?
    } else {
        let mut args = vec!["add-generic-password"];
        if update {
            args.push("-U");
        }
        args.extend(["-a", account, "-s", service, "-X", &hex]);
        Command::new("/usr/bin/security")
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .output()
            .map_err(|e| e.to_string())?
    };
    // 대화형 모드는 명령이 실패해도 종료 코드가 0일 수 있어 stderr도 확인
    if !out.status.success() || !out.stderr.is_empty() {
        return Err(format!("키체인 저장 실패{}", error_code(&String::from_utf8_lossy(&out.stderr))));
    }
    if read(service)?.as_deref() != Some(value) {
        return Err("키체인 저장 확인 실패 (저장된 값이 다름)".into());
    }
    Ok(())
}

// stderr 예: "...: The specified item already exists in the keychain.\nadd-generic-password: returned -25299"
// 명령을 그대로 되풀이하는 메시지(unknown command "<값>")도 있어 원문은 쓰지 않고 오류 코드만 꺼냄
fn error_code(stderr: &str) -> String {
    stderr
        .split("returned ")
        .nth(1)
        .and_then(|t| t.split_whitespace().next())
        .filter(|c| c.len() <= 8 && c.trim_start_matches('-').chars().all(|ch| ch.is_ascii_digit()))
        .map(|c| format!(" (코드 {c})"))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    #[test]
    fn error_code_never_echoes_input() {
        assert_eq!(super::error_code("x\nadd-generic-password: returned -25299\n"), " (코드 -25299)");
        assert_eq!(super::error_code("security: unknown command \"6162636465\""), "");
    }
}
