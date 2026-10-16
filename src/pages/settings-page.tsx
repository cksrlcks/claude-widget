import { AccountSection } from "@/features/accounts/components/account-section"
import { GeneralSection } from "@/features/general/components/general-section"
import { WatchSection } from "@/features/integrations/components/watch-section"
import { InventorySection } from "@/features/inventory/components/inventory-section"
import { UpdateSection } from "@/features/updates/components/update-section"
import { useAppState } from "@/shared/api/queries"

export function SettingsPage() {
  const { data: state } = useAppState()
  if (!state) return null

  return (
    <main className="grid gap-8 p-6">
      <AccountSection state={state} />
      <WatchSection state={state} />
      <InventorySection state={state} />
      <GeneralSection state={state} />
      <UpdateSection update={state.update} />
    </main>
  )
}
