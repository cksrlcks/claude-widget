/** 위젯·설정 창 공통 테마. 창끼리 localStorage를 공유하므로 storage 이벤트로 다른 창에도 바로 반영 */
export type Theme = "light" | "dark"

const KEY = "settings-theme"
const CLASS: Record<Theme, string> = { light: "theme-paper", dark: "theme-ember" }

function stored(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark"
  } catch {
    return "dark"
  }
}

function apply(theme: Theme) {
  const root = document.documentElement.classList
  root.remove(...Object.values(CLASS))
  root.add(CLASS[theme])
}

export function getTheme(): Theme {
  return document.documentElement.classList.contains(CLASS.light) ? "light" : "dark"
}

export function setTheme(theme: Theme) {
  apply(theme)
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // 저장 못 해도 이번 창에는 적용됨
  }
}

/** 창이 뜰 때 저장된 테마 적용 + 다른 창에서 바꾸면 따라감 (mount에서 한 번 호출) */
export function initTheme() {
  apply(stored())
  window.addEventListener("storage", (e) => e.key === KEY && apply(stored()))
}
