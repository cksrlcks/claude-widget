import { createContext, PropsWithChildren, useCallback, useContext, useRef, useState } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type ConfirmOptions = {
  title: string
  description: string
  cancelLabel?: string
  okLabel?: string
}
type ConfirmFn = (title: string, description: string, cancelLabel?: string, okLabel?: string) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

export function ConfirmProvider({ children }: PropsWithChildren) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolveRef = useRef<((value: boolean) => void) | null>(null)

  const confirm: ConfirmFn = useCallback(
    (title, description, cancelLabel = "취소", okLabel = "확인") =>
      new Promise<boolean>((resolve) => {
        resolveRef.current = resolve
        setOptions({ title, description, cancelLabel, okLabel })
      }),
    [],
  )

  const handleCancel = () => {
    resolveRef.current?.(false)
    setOptions(null)
  }
  const handleOk = () => {
    resolveRef.current?.(true)
    setOptions(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={!!options}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{options?.title}</AlertDialogTitle>
            {options?.description && <AlertDialogDescription>{options.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancel}>{options?.cancelLabel ?? "취소"}</AlertDialogCancel>
            <AlertDialogAction onClick={handleOk}>{options?.okLabel ?? "확인"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider")
  return ctx
}
