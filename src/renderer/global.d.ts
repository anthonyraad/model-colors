import type { Bridge } from '../midi/bridge'

declare global {
  interface Window {
    cycles?: Bridge
  }
}

export {}
