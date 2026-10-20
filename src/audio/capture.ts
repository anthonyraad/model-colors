/** Windows sometimes names the six-channel input "Digital Audio Interface" instead of Elektron. */
export function isCyclesAudioName(name: string): boolean {
  return /cycles|elektron|digital audio interface/i.test(name)
}

/** An active Model:Cycles capture device, if one is listed. */
export function activeCyclesInput(devices: readonly { id: string; name: string; state?: string }[]): { id: string; name: string } | null {
  return devices.find((device) => (device.state == null || device.state === 'Active') && isCyclesAudioName(device.name)) ?? null
}

/**
 * Switch the insert input when a Model:Cycles capture device appears.
 * A device that was already listed is left alone, so a later manual choice stays put.
 */
export function adoptArrivingCyclesAudio(
  devices: readonly { id: string; name: string; state?: string }[],
  currentInputId: string,
  knownCyclesIds: ReadonlySet<string>
): string | null {
  const cycles = activeCyclesInput(devices)
  if (!cycles || knownCyclesIds.has(cycles.id) || cycles.id === currentInputId) return null
  return cycles.id
}

/** Browser capture id for a Model:Cycles input that is not the one already open. */
export function arrivingCyclesMediaId(
  devices: readonly { kind: string; label: string; deviceId: string }[],
  currentDeviceId: string | undefined
): string | null {
  const cycles = devices.find((device) => device.kind === 'audioinput' && isCyclesAudioName(device.label))
  if (!cycles || cycles.deviceId === currentDeviceId) return null
  return cycles.deviceId
}
