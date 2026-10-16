/** 업로드 이미지를 정사각형으로 잘라 size px PNG data URL로 (store.json에 저장되므로 작게) */
export async function resizeToDataUrl(file: File, size = 128): Promise<string> {
  const img = await createImageBitmap(file)
  const canvas = Object.assign(document.createElement("canvas"), { width: size, height: size })
  const scale = Math.max(size / img.width, size / img.height)
  const w = img.width * scale
  const h = img.height * scale
  canvas.getContext("2d")!.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
  return canvas.toDataURL("image/png")
}
