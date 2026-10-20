import { allNotesOff, isProgramChange, isResetAllControllers, isSysEx, midiStop, noteOff } from './messages'

export type HeldNote = { channel: number; note: number }

/** Note-offs for notes this app is holding, All Notes Off, then Stop. No SysEx, program change, or CC 121. */
export function panicMessages(channels: number[], heldNotes: HeldNote[]): number[][] {
  const uniqueChannels = [...new Set(channels.filter((channel) => channel >= 1 && channel <= 16))]
  const messages: number[][] = []
  const seen = new Set<string>()
  for (const held of heldNotes) {
    const key = `${held.channel}:${held.note}`
    if (seen.has(key)) continue
    seen.add(key)
    if (held.channel >= 1 && held.channel <= 16) messages.push(noteOff(held.channel, held.note))
  }
  for (const channel of uniqueChannels) messages.push(allNotesOff(channel))
  messages.push(midiStop())
  for (const message of messages) {
    if (isSysEx(message) || isProgramChange(message) || isResetAllControllers(message)) {
      throw new Error('Panic built a message it is not allowed to send')
    }
  }
  return messages
}
