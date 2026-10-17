/** GIF 원본 최대 크기 — store.json에 data URL로 들어가므로 제한 */
export const MAX_GIF_BYTES = 2 * 1024 * 1024

/**
 * 업로드 이미지를 아바타용 data URL로.
 * - GIF: 캔버스로 줄이면 움직임이 사라지므로 원본 그대로 (2MB 이하)
 * - 그 외: 정사각형으로 잘라 size px PNG (store.json에 저장되므로 작게)
 */
export async function toAvatarDataUrl(file: File, size = 128): Promise<string> {
  if (file.type === "image/gif") {
    if (file.size > MAX_GIF_BYTES) throw new Error("GIF는 2MB 이하만 올릴 수 있습니다")
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error("GIF를 읽지 못했습니다"))
      reader.readAsDataURL(file)
    })
  }
  const img = await createImageBitmap(file)
  const canvas = Object.assign(document.createElement("canvas"), { width: size, height: size })
  const scale = Math.max(size / img.width, size / img.height)
  const w = img.width * scale
  const h = img.height * scale
  canvas.getContext("2d")!.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
  return canvas.toDataURL("image/png")
}
