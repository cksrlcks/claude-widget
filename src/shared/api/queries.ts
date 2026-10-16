// 백엔드 상태는 Rust가 "state" / "catalog" 이벤트로 밀어줌 → React Query 캐시에 그대로 반영
import { useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { listen } from "@tauri-apps/api/event"

import { api } from "@/shared/api/commands"
import type { AppState, Catalog } from "@/shared/types"

export const appKeys = {
  all: ["app"] as const,
  state: () => [...appKeys.all, "state"] as const,
  catalog: () => [...appKeys.all, "catalog"] as const,
}

function useEventSync<T>(event: string, key: readonly unknown[]) {
  const qc = useQueryClient()
  useEffect(() => {
    const unlisten = listen<T>(event, (e) => qc.setQueryData(key, e.payload))
    return () => {
      unlisten.then((f) => f())
    }
    // key는 팩토리에서 오는 고정값이라 의존성에서 제외 (매 렌더 새 배열이라 넣으면 매번 재구독)
  }, [event, qc])
}

export function useAppState() {
  useEventSync<AppState>("state", appKeys.state())
  return useQuery({ queryKey: appKeys.state(), queryFn: api.getState, staleTime: Infinity })
}

export function useCatalog() {
  useEventSync<Catalog>("catalog", appKeys.catalog())
  return useQuery({ queryKey: appKeys.catalog(), queryFn: api.getCatalog, staleTime: Infinity })
}
