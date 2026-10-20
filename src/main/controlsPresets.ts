import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parsePresetDocument, removePreset, upsertPreset, type ControlsPreset } from '../audio/controlsPreset'

function file(): string {
  return join(app.getPath('userData'), 'controls-presets.json')
}

export function listControlsPresets(): ControlsPreset[] {
  try {
    return parsePresetDocument(JSON.parse(readFileSync(file(), 'utf8')))
  } catch {
    return []
  }
}

function write(presets: ControlsPreset[]): ControlsPreset[] {
  const folder = app.getPath('userData')
  mkdirSync(folder, { recursive: true })
  writeFileSync(file(), JSON.stringify({ version: 1, presets }))
  return presets
}

export function saveControlsPreset(preset: ControlsPreset): ControlsPreset[] {
  return write(upsertPreset(listControlsPresets(), preset))
}

export function deleteControlsPreset(name: string): ControlsPreset[] {
  return write(removePreset(listControlsPresets(), name))
}
