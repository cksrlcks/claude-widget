# 배포용 서명 빌드. 개인 키와 비밀번호는 이 터미널 세션 안에서만 쓰이고 파일·로그에 남지 않음
# 사용: powershell -ExecutionPolicy Bypass -File scripts\build-release.ps1
param([string]$KeyPath = "$env:USERPROFILE\.tauri\claude-widget.key")

$ErrorActionPreference = "Stop"
if (-not (Test-Path $KeyPath)) { throw "서명 키가 없습니다: $KeyPath" }

$secure = Read-Host "서명 키 비밀번호" -AsSecureString
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $KeyPath -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

try {
  Set-Location (Split-Path $PSScriptRoot -Parent)
  npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "빌드 실패 (exit $LASTEXITCODE)" }
  Write-Host "`n빌드 완료:" -ForegroundColor Green
  Get-ChildItem "src-tauri\target\release\bundle\nsis" -Filter "*setup.exe*" | Select-Object Name, Length | Format-Table
} finally {
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY, Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
}
