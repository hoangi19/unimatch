import { useState } from 'react'
import type { InboxData, MessageRow, SendResult } from './data'

type ThreadRows = { upsert(m: MessageRow): void; remove(id: string): void; sync(): Promise<void> }

export const LOCAL_PREFIX = 'local-'

/**
 * Admin replies with an optimistic bubble: a local 'pending' row until the function answers, then the stored row.
 * A failed send stays as a failed bubble (stored, or local when nothing was stored) that `send` can retry.
 */
export function useReply(data: InboxData, conversationId: string, rows: ThreadRows) {
  // The customer's last message time when the server said the window had closed; a newer message reopens it.
  const [closedAt, setClosedAt] = useState<string | null | undefined>(undefined)

  async function send(text: string, lastCustomerMessageAt: string | null, retry?: MessageRow): Promise<SendResult> {
    const local: MessageRow = {
      id: `${LOCAL_PREFIX}${crypto.randomUUID()}`,
      conversation_id: conversationId,
      sender_kind: 'admin',
      text,
      delivery_status: 'pending',
      created_at: new Date().toISOString(),
      admin_id: null,
      attachments: null,
      delivery_error: null,
      event: null,
      external_id: null,
      trace: null,
    }
    const retryOf = retry && !retry.id.startsWith(LOCAL_PREFIX) ? retry.id : undefined
    if (retry) rows.remove(retry.id)
    rows.upsert(local)
    const result = await data.send(conversationId, text, retryOf)
    rows.remove(local.id)
    if (!result.ok && result.error.kind === 'outside_window') setClosedAt(lastCustomerMessageAt)
    // Stored (sent or failed), or delivered with the row still to come from the echo: show what the database has.
    if (result.ok || result.messageId) await rows.sync()
    // Nothing stored, so the server kept any retried row: put it back, or keep a local failed bubble.
    else rows.upsert(retryOf && retry ? retry : { ...local, delivery_status: 'failed', delivery_error: result.error.message })
    return result
  }

  return { send, windowClosedBy: (lastCustomerMessageAt: string | null) => closedAt !== undefined && closedAt === lastCustomerMessageAt }
}
