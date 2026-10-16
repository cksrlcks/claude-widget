// Clawd 픽셀 아이콘 생성: assets/icon.png(256), assets/tray.png(32), assets/icon.ico(16~256)
// 실행: node scripts/make-icons.js
const fs = require("fs")
const path = require("path")
const zlib = require("zlib")

const PIXELS = [
  "..########..",
  "..##e##e##..",
  ".##########.",
  "..########..",
  "..#.#..#.#..",
  "..#.#..#.#..",
]
const ORANGE = [0xd9, 0x77, 0x57, 255]
const EYE = [0x18, 0x18, 0x1b, 255]
const TILE = [0x1d, 0x1e, 0x22, 255]

// size x size RGBA 버퍼에 그림. tile=true면 둥근 사각 배경 포함
function draw(size, tile) {
  const buf = Buffer.alloc(size * size * 4)
  const set = (x, y, c) => buf.set(c, (y * size + x) * 4)
  if (tile) {
    const r = size * 0.22
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const dx = Math.max(r - x - 0.5, x + 0.5 - (size - r), 0)
        const dy = Math.max(r - y - 0.5, y + 0.5 - (size - r), 0)
        const d = Math.hypot(dx, dy)
        if (d <= r) set(x, y, [...TILE.slice(0, 3), Math.round(255 * Math.min(1, r - d + 0.5))])
      }
  }
  // 트레이용(tile=false)은 좌우 빈 열을 잘라 아이콘 칸을 꽉 채움
  const grid = tile ? PIXELS : PIXELS.map((r) => r.slice(1, -1))
  const cols = grid[0].length
  const unit = Math.max(1, Math.floor((size * (tile ? 0.72 : 1)) / cols))
  const ox = Math.floor((size - cols * unit) / 2)
  const oy = Math.floor((size - grid.length * unit) / 2)
  grid.forEach((row, py) =>
    [...row].forEach((c, px) => {
      if (c === ".") return
      for (let y = 0; y < unit; y++)
        for (let x = 0; x < unit; x++) set(ox + px * unit + x, oy + py * unit + y, c === "e" ? EYE : ORANGE)
    })
  )
  return buf
}

function crc32(b) {
  let c = ~0
  for (const byte of b) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function png(size, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.set([8, 6, 0, 0, 0], 8) // 8bit RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

// PNG를 그대로 담는 ICO (Vista 이상 지원)
function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = 6 + images.length * 16
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size
    e[1] = size >= 256 ? 0 : size
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    return e
  })
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)])
}

const out = path.join(__dirname, "..", "assets")
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, "icon.png"), png(256, draw(256, true)))
// 트레이: 32px로 크게 그린 뒤 2x2 평균으로 16px 생성 → 정수 픽셀 제약 없이 칸을 꽉 채움
function half(src, size) {
  const h = size / 2
  const dst = Buffer.alloc(h * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < h; x++) {
      const px = [0, 1, 2, 3].map((i) => ((y * 2 + (i >> 1)) * size + x * 2 + (i & 1)) * 4)
      const a = px.reduce((s, p) => s + src[p + 3], 0)
      for (let c = 0; c < 3; c++) dst[(y * h + x) * 4 + c] = a ? Math.round(px.reduce((s, p) => s + src[p + c] * src[p + 3], 0) / a) : 0
      dst[(y * h + x) * 4 + 3] = Math.round(a / 4)
    }
  return dst
}
const tray32 = draw(32, false)
fs.writeFileSync(path.join(out, "tray.png"), png(16, half(tray32, 32)))
fs.writeFileSync(path.join(out, "tray@2x.png"), png(32, tray32))
fs.writeFileSync(
  path.join(out, "icon.ico"),
  ico([16, 24, 32, 48, 64, 128, 256].map((s) => ({ size: s, data: png(s, draw(s, true)) })))
)
console.log("assets/icon.png, assets/tray.png, assets/icon.ico 생성")
