/// <reference types="vite/client" />

interface ElectronAPI {
  send: (channel: string, data: unknown) => void
  receive: (channel: string, func: (...args: unknown[]) => void) => void
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  platform: string
  versions: {
    node: string
    chrome: string
    electron: string
  }
}
