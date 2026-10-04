/** Float outside the form's layout/scroll container, inside a native dialog's top layer. */
export function useDialogPortal() {
  const root = shallowRef<HTMLElement>()
  const dialog = shallowRef<HTMLDialogElement>()
  onMounted(() => { dialog.value = root.value?.closest('dialog') ?? undefined })
  return { root, dialog, portal: computed(() => dialog.value ?? true) }
}
