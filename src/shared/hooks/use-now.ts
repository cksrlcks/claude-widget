import { useEffect, useState } from "react"

/** 남은 시간 표시처럼 시간이 흐르면 다시 그려야 하는 곳에서 사용 */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}
