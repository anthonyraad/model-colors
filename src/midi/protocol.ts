import mapJson from '../../protocol/model-cycles-os-1.13.json'

export type ParameterGroup = 'track' | 'fx'

export type Parameter = {
  id: string
  name: string
  cc: number
  lsb: number | null
  group: ParameterGroup
  lock: string
  curve: string
  display?: string
}

export type Protocol = {
  firmware: string
  parameters: Parameter[]
  channels: {
    trackDefaults: number[]
    trackDefaultConfidence: string
    unknownDefaultNote: string
    sharedChannelRule: string
  }
  transport: {
    stop: number
    allNotesOff: { cc: number }
    resetAllControllers: { send: boolean }
  }
}

export const protocol = mapJson as Protocol

const byId = new Map(protocol.parameters.map((parameter) => [parameter.id, parameter]))
const byCc = new Map<number, Parameter>()
for (const parameter of protocol.parameters) {
  byCc.set(parameter.cc, parameter)
  if (parameter.lsb != null) byCc.set(parameter.lsb, parameter)
}

export function parameterById(id: string): Parameter | undefined {
  return byId.get(id)
}

export function parameterByCc(cc: number): Parameter | undefined {
  return byCc.get(cc)
}

export function trackParameters(): Parameter[] {
  return protocol.parameters.filter((parameter) => parameter.group === 'track')
}

export function fxParameters(): Parameter[] {
  return protocol.parameters.filter((parameter) => parameter.group === 'fx')
}

export function looksLikeModelCycles(name: string): boolean {
  return /cycles/i.test(name) && /elektron|model/i.test(name)
}

export function modelCyclesPortIds(ports: { id: string; name: string; simulated?: boolean }[]): string[] {
  return ports.filter((port) => !port.simulated && looksLikeModelCycles(port.name)).map((port) => port.id)
}

/**
 * Take over a live hardware connection when a Model:Cycles port shows up.
 * A port that was already listed is left alone, so a deliberate other choice stays put.
 * The simulator and an open Model:Cycles port are left alone too.
 */
export function adoptArrivingCycles(
  inputs: { id: string; name: string; simulated?: boolean }[],
  outputs: { id: string; name: string; simulated?: boolean }[],
  connectedInputId: string | null,
  connectedOutputId: string | null,
  knownCyclesIds: ReadonlySet<string>
): { inputId: string | null; outputId: string | null } | null {
  const arriving = [...modelCyclesPortIds(inputs), ...modelCyclesPortIds(outputs)].filter((id) => !knownCyclesIds.has(id))
  if (arriving.length === 0) return null
  const output = outputs.find((port) => port.id === connectedOutputId)
  const onHardware = connectedOutputId != null && connectedOutputId !== 'sim:output' && !output?.simulated
  const onCycles = output != null && looksLikeModelCycles(output.name)
  if (!onHardware || onCycles) return null
  const inputId = modelCyclesPortIds(inputs)[0] ?? connectedInputId
  const outputId = modelCyclesPortIds(outputs)[0] ?? connectedOutputId
  if (inputId === connectedInputId && outputId === connectedOutputId) return null
  return { inputId, outputId }
}

/** Keep a manual choice. The first selection prefers the Model:Cycles, then the Focusrite MIDI port. */
export function defaultPortId(
  ports: { id: string; name: string; simulated?: boolean }[],
  currentId: string,
  initialId: string
): string {
  if (currentId !== initialId) return currentId
  const cycles = ports.find((port) => !port.simulated && looksLikeModelCycles(port.name))
  if (cycles) return cycles.id
  const focusrite = ports.find((port) => !port.simulated && /focusrite/i.test(port.name))
  return focusrite?.id ?? currentId
}

export function valueCaption(parameter: Parameter): string {
  const parts = [`CC ${parameter.cc}${parameter.lsb != null ? ` / ${parameter.lsb}` : ''}`]
  if (parameter.display) parts.push(`on the device: ${parameter.display}`)
  if (parameter.curve === 'machine-dependent') parts.push('the meaning follows the machine')
  if (parameter.curve === 'value-map-unpublished') parts.push('which value selects which machine is unpublished')
  if (parameter.curve === 'index-unpublished') parts.push('the value order is unpublished')
  if (parameter.curve === 'unpublished-threshold') parts.push('the on/off threshold is unpublished')
  if (parameter.display || parameter.curve !== 'likely-identity') {
    parts.push('the number shown here is the raw MIDI value')
  }
  if (parameter.lock === 'no-lfo-setup') parts.push('live only — the device cannot store this per step')
  if (parameter.id === 'note') parts.push('this is the Note parameter, not a note-on')
  return parts.join(' · ')
}
