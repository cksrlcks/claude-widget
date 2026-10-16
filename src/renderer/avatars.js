// 기본 아바타 5종: Claude Code 마스코트(Clawd) 픽셀 모양, 색상만 다름
// 12x6 픽셀 격자 — 몸통(0~3행, 2행은 팔까지 넓게), 눈 2개, 다리 4개
const CLAWD_PIXELS = [
  "..########..",
  "..##e##e##..",
  ".##########.",
  "..########..",
  "..#.#..#.#..",
  "..#.#..#.#..",
]

function clawdSvg(color, bg) {
  const unit = 4
  const ox = (64 - 12 * unit) / 2
  const oy = (64 - CLAWD_PIXELS.length * unit) / 2 + 2
  let rects = ""
  CLAWD_PIXELS.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c === ".") return
      const fill = c === "e" ? "#18181b" : color
      rects += `<rect x="${ox + x * unit}" y="${oy + y * unit}" width="${unit}" height="${unit}" fill="${fill}"/>`
    })
  )
  return `<svg viewBox="0 0 64 64" shape-rendering="crispEdges"><rect width="64" height="64" fill="${bg}"/>${rects}</svg>`
}

window.AVATARS = {
  a1: { name: "오렌지", svg: clawdSvg("#d97757", "#3a2620") },
  a2: { name: "블루", svg: clawdSvg("#5b8def", "#1f2a40") },
  a3: { name: "그린", svg: clawdSvg("#4fbf7f", "#1d3328") },
  a4: { name: "퍼플", svg: clawdSvg("#9b7be8", "#2b2340") },
  a5: { name: "핑크", svg: clawdSvg("#e8739b", "#3d2230") },
}

window.avatarHtml = (profile) => {
  if (profile?.avatar === "custom" && profile.customAvatar) return `<img src="${profile.customAvatar}" alt="" />`
  return (window.AVATARS[profile?.avatar] ?? window.AVATARS.a1).svg
}
