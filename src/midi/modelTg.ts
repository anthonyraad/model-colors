import mapJson from '../../protocol/model-cycles-os-1.13.json'
import { valueCaption, type Parameter } from './protocol'

export type SamplerMode = {
  id: string
  name: string
  dials: string[]
  effectDials?: boolean
  note?: string
}

export type ModelTgMap = {
  name: string
  baseFirmware: string
  note: string
  machines: { id: string; name: string }[]
  dialParameterIds: string[]
  samplerModes: SamplerMode[]
  panelOnly: { name: string; panel: string; detail: string }[]
  noMidi: string[]
}

export const modelTg = (mapJson as unknown as { modelTg: ModelTgMap }).modelTg

export function samplerMode(id: string): SamplerMode | undefined {
  return modelTg.samplerModes.find((mode) => mode.id === id)
}

/** Panel name for a stock dial while the track is a Sampler. The CC does not change. */
export function samplerDialName(modeId: string, parameterId: string): string | null {
  const mode = samplerMode(modeId)
  const index = modelTg.dialParameterIds.indexOf(parameterId)
  if (!mode || index < 0) return null
  return mode.dials[index] ?? null
}

export function samplerKnobCaption(parameter: Parameter, modeId: string): string {
  const mode = samplerMode(modeId)
  const dial = samplerDialName(modeId, parameter.id)
  const parts = [valueCaption(parameter)]
  if (dial) {
    parts.push(`on a Sampler track this dial is ${dial}`, `it still sends ${parameter.name}`)
  }
  if (mode?.effectDials && (parameter.id === 'sweep' || parameter.id === 'contour')) {
    parts.push('if that track’s EFX option is Lo-fi, Tape, or Vinyl, the instrument uses this dial for the effect')
  }
  if (parameter.id === 'color' && mode?.id === 'stretch' && mode.note) parts.push(mode.note)
  if (parameter.id === 'shape' && mode?.id === 'wave' && mode.note) parts.push(mode.note)
  if (parameter.id === 'note' && mode?.id === 'slice' && mode.note) parts.push(mode.note)
  return parts.join(' · ')
}
