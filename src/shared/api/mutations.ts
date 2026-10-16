// 사용자 액션 → 백엔드 명령. 결과 상태는 "state" 이벤트로 돌아오므로 여기서는 토스트만 처리
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"

import { api } from "@/shared/api/commands"
import type { MarketplaceAction, PluginAction, ProfilePatch } from "@/shared/types"

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : typeof err === "string" ? err : fallback

export function useSwitchAccount() {
  return useMutation({
    mutationFn: api.switchAccount,
    onSuccess: (switched) => {
      if (switched) toast.success("계정을 전환했습니다")
    },
    onError: (err) => toast.error(errorMessage(err, "계정 전환에 실패했습니다")),
  })
}

export function useRemoveProfile() {
  return useMutation({
    mutationFn: api.removeProfile,
    onSuccess: (removed) => {
      if (removed) toast.success("계정을 삭제했습니다")
    },
    onError: (err) => toast.error(errorMessage(err, "계정 삭제에 실패했습니다")),
  })
}

export function useUpdateProfile() {
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ProfilePatch }) => api.updateProfile(id, patch),
    onError: (err) => toast.error(errorMessage(err, "저장에 실패했습니다")),
  })
}

export function usePluginAction() {
  return useMutation({
    mutationFn: ({ action, id }: { action: PluginAction; id: string }) => api.pluginAction(action, id),
    onSuccess: (_, { action }) =>
      toast.success(
        { uninstall: "플러그인을 제거했습니다", enable: "활성화했습니다", disable: "비활성화했습니다" }[action],
      ),
    onError: (err) => toast.error(errorMessage(err, "작업에 실패했습니다")),
  })
}

export function useMarketplaceAction() {
  return useMutation({
    mutationFn: async ({ action, value }: { action: MarketplaceAction; value: string }) => {
      const res = await api.marketplaceAction(action, value)
      if (res.error) throw new Error(res.error)
    },
    onSuccess: (_, { action }) =>
      toast.success(action === "add" ? "마켓플레이스를 추가했습니다" : "마켓플레이스를 제거했습니다"),
    onError: (err) => toast.error(errorMessage(err, "작업에 실패했습니다")),
  })
}
