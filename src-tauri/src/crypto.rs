// 계정 토큰 암호화 (Windows DPAPI: 현재 Windows 사용자만 복호화 가능)
// + Electron safeStorage("v10" + AES-256-GCM, 키는 Local State에 DPAPI로 보관)로 저장된 기존 토큰 복호화
use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use base64::Engine;
use std::{path::Path, ptr};
use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB};

fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 }
}

fn take(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
    unsafe {
        let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        LocalFree(out.pbData as _);
        v
    }
}

pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
    let input = blob(data);
    let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: ptr::null_mut() };
    let ok = unsafe { CryptProtectData(&input, ptr::null(), ptr::null(), ptr::null(), ptr::null(), 0, &mut out) };
    if ok == 0 {
        return Err("CryptProtectData 실패".into());
    }
    Ok(take(out))
}

pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    let input = blob(data);
    let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: ptr::null_mut() };
    let ok = unsafe { CryptUnprotectData(&input, ptr::null_mut(), ptr::null(), ptr::null(), ptr::null(), 0, &mut out) };
    if ok == 0 {
        return Err("CryptUnprotectData 실패".into());
    }
    Ok(take(out))
}

/// Electron safeStorage로 암호화된 데이터 복호화 (기존 Electron 버전에서 이전용)
pub fn decrypt_electron(local_state: &Path, data: &[u8]) -> Result<Vec<u8>, String> {
    let state: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(local_state).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let enc_key = state["os_crypt"]["encrypted_key"].as_str().ok_or("encrypted_key 없음")?;
    let enc_key = base64::engine::general_purpose::STANDARD.decode(enc_key).map_err(|e| e.to_string())?;
    let key = unprotect(enc_key.strip_prefix(b"DPAPI").ok_or("DPAPI 접두어 없음")?)?;

    let body = data.strip_prefix(b"v10").ok_or("v10 형식 아님")?;
    if body.len() < 12 {
        return Err("데이터가 너무 짧음".into());
    }
    let (nonce, ct) = body.split_at(12);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    cipher.decrypt(Nonce::from_slice(nonce), ct).map_err(|_| "AES-GCM 복호화 실패".to_string())
}
