import { describe, expect, it } from 'vitest'
import { activeCyclesInput, adoptArrivingCyclesAudio, arrivingCyclesMediaId, isCyclesAudioName } from './capture'

describe('cycles audio arrival', () => {
  const focusrite = { id: 'out-focusrite', name: 'Focusrite USB', state: 'Active' }
  const quiet = { id: 'in-cycles', name: 'Elektron Model:Cycles', state: 'Unplugged' }
  const cycles = { id: 'in-cycles', name: 'Elektron Model:Cycles', state: 'Active' }

  it('starts the inserts on a Model:Cycles input that just became available', () => {
    expect(activeCyclesInput([focusrite, quiet])).toBeNull()
    expect(adoptArrivingCyclesAudio([focusrite, cycles], '', new Set())).toBe('in-cycles')
    expect(adoptArrivingCyclesAudio([focusrite, cycles], 'in-cycles', new Set())).toBeNull()
    expect(adoptArrivingCyclesAudio([focusrite, cycles], 'in-other', new Set(['in-cycles']))).toBeNull()
  })

  it('points the visualizer at a Model:Cycles input that is not already open', () => {
    const devices = [
      { kind: 'audioinput', label: 'Microphone', deviceId: 'mic' },
      { kind: 'audioinput', label: 'Elektron Model:Cycles', deviceId: 'cycles' },
      { kind: 'audiooutput', label: 'Elektron Model:Cycles', deviceId: 'cycles-out' }
    ]
    expect(arrivingCyclesMediaId(devices, 'mic')).toBe('cycles')
    expect(arrivingCyclesMediaId(devices, 'cycles')).toBeNull()
    expect(arrivingCyclesMediaId(devices, undefined)).toBe('cycles')
    expect(arrivingCyclesMediaId([{ kind: 'audioinput', label: '', deviceId: 'default' }], undefined)).toBeNull()
  })

  it('recognizes the six-channel input when Windows drops the Elektron name', () => {
    const generic = { id: 'in-usb', name: 'Digital Audio Interface (USB Audio 2.0)', state: 'Active' }
    expect(isCyclesAudioName(generic.name)).toBe(true)
    expect(isCyclesAudioName('Speakers (Focusrite USB Audio)')).toBe(false)
    expect(activeCyclesInput([focusrite, generic])?.id).toBe('in-usb')
    expect(arrivingCyclesMediaId([{ kind: 'audioinput', label: generic.name, deviceId: 'usb' }], undefined)).toBe('usb')
  })
})