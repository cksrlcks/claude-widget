import { useRef, type MouseEvent } from "react"

import { api } from "@/shared/api/commands"

/**
 * 위젯 어디를 잡아도 창을 옮길 수 있게. 3px 넘게 움직이면 OS 창 드래그로 넘기고,
 * 그보다 적게 움직이면 평소처럼 click 이벤트가 발생한다. (위치 저장은 백엔드가 처리)
 */
export function useWindowDrag() {
  const start = useRef<{ x: number; y: number } | null>(null)

  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return
    start.current = { x: e.screenX, y: e.screenY }
  }
  const onMouseMove = (e: MouseEvent) => {
    const s = start.current
    if (!s || Math.abs(e.screenX - s.x) + Math.abs(e.screenY - s.y) <= 3) return
    start.current = null
    api.startDrag()
  }
  const onMouseUp = () => {
    start.current = null
  }

  return { onMouseDown, onMouseMove, onMouseUp }
}
