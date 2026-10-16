import { useEffect, useRef } from "react"

import { api } from "@/shared/api/commands"

/** 내용 높이가 바뀌면 창 높이를 맞춤 (끊긴 MCP 목록이 늘어날 때 등) */
export function useFitHeight<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    let last = 0
    const observer = new ResizeObserver(() => {
      const h = Math.ceil(el.getBoundingClientRect().height)
      if (h !== last) {
        last = h
        api.setHeight(h)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [enabled])
  return ref
}
