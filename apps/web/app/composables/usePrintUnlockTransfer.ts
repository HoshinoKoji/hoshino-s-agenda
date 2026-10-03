import type { Ref } from 'vue'
import type { Entry } from '../../../../shared/types'
import type { EntryEncryption } from './useEntryEncryption'

export function usePrintUnlockTransfer(email: Ref<string>, entries: Ref<Entry[]>, encryption: EntryEncryption) {
  return useEntryUnlockTransfer(email, entries, encryption, 'print')
}
