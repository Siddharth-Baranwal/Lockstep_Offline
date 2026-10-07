import { clamp, clampGainDb, clampDelayMs } from './devices'

export interface RoomAudioParameters {
  /** Additional Voicemeeter delay, in milliseconds. */
  delayBarMs: number
  delayTowerMs: number
  gainBarDb: number
  gainTowerDb: number
  towerConnected: boolean
  barConnected: boolean
}

const BAR_NATIVE_LATENCY_MS = 148
const TOWER_NATIVE_LATENCY_MS = 196
const MAX_TOTAL_DELAY_SECONDS = 1
const SIMULATOR_GAIN_SCALE = 0.4

/** Browser-only audition of the two speaker paths through a shared test tone. */
export class RoomAudioSimulator {
  private ctx: AudioContext | null = null
  private oscillator: OscillatorNode | null = null
  private barDelayNode: DelayNode | null = null
  private towerDelayNode: DelayNode | null = null
  private barGainNode: GainNode | null = null
  private towerGainNode: GainNode | null = null
  public active = false

  start(params: RoomAudioParameters): void {
    this.stop()

    const AudioContextConstructor = getAudioContextConstructor()
    if (!AudioContextConstructor) {
      throw new Error('Web Audio is not supported by this browser.')
    }

    const context = new AudioContextConstructor()
    this.ctx = context

    try {
      const oscillator = context.createOscillator()
      const barDelay = context.createDelay(MAX_TOTAL_DELAY_SECONDS)
      const towerDelay = context.createDelay(MAX_TOTAL_DELAY_SECONDS)
      const barGain = context.createGain()
      const towerGain = context.createGain()

      oscillator.type = 'triangle'
      oscillator.frequency.setValueAtTime(220, context.currentTime)
      oscillator.connect(barDelay)
      oscillator.connect(towerDelay)
      barDelay.connect(barGain).connect(context.destination)
      towerDelay.connect(towerGain).connect(context.destination)

      this.oscillator = oscillator
      this.barDelayNode = barDelay
      this.towerDelayNode = towerDelay
      this.barGainNode = barGain
      this.towerGainNode = towerGain

      this.updateParameters(params)
      oscillator.start()
      this.active = true

      // Browsers may begin AudioContexts suspended until a user gesture. Keep
      // the simulator marked active and resume when the browser permits it.
      void context.resume().catch(() => {
        // A later user gesture can call start again if autoplay is restricted.
      })
    } catch (error) {
      this.stop()
      throw error
    }
  }

  updateParameters(params: RoomAudioParameters): void {
    const context = this.ctx
    const barDelay = this.barDelayNode
    const towerDelay = this.towerDelayNode
    const barGain = this.barGainNode
    const towerGain = this.towerGainNode
    if (!context || !barDelay || !towerDelay || !barGain || !towerGain) return

    const now = context.currentTime
    const barSeconds = clamp(
      (BAR_NATIVE_LATENCY_MS + clampDelayMs(params.delayBarMs)) / 1000,
      0,
      MAX_TOTAL_DELAY_SECONDS,
    )
    const towerSeconds = clamp(
      (TOWER_NATIVE_LATENCY_MS + clampDelayMs(params.delayTowerMs)) / 1000,
      0,
      MAX_TOTAL_DELAY_SECONDS,
    )
    barDelay.delayTime.setTargetAtTime(barSeconds, now, 0.015)
    towerDelay.delayTime.setTargetAtTime(towerSeconds, now, 0.015)

    const targetBarGain = params.barConnected
      ? Math.pow(10, clampGainDb(params.gainBarDb) / 20) * SIMULATOR_GAIN_SCALE
      : 0
    const targetTowerGain = params.towerConnected
      ? Math.pow(10, clampGainDb(params.gainTowerDb) / 20) * SIMULATOR_GAIN_SCALE
      : 0
    // Smooth gain transitions to avoid clicks when toggling a speaker or fader.
    barGain.gain.setTargetAtTime(targetBarGain, now, 0.015)
    towerGain.gain.setTargetAtTime(targetTowerGain, now, 0.015)
  }

  stop(): void {
    const oscillator = this.oscillator
    const context = this.ctx

    this.active = false
    this.oscillator = null
    this.barDelayNode = null
    this.towerDelayNode = null
    this.barGainNode = null
    this.towerGainNode = null
    this.ctx = null

    if (oscillator) {
      try {
        oscillator.stop()
      } catch {
        // stop() throws if the node has already stopped.
      }
      oscillator.disconnect()
    }
    if (context && context.state !== 'closed') {
      void context.close().catch(() => {
        // Context teardown is best effort; references have already been cleared.
      })
    }
  }
}

function getAudioContextConstructor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined
  const audioWindow = window as Window & { webkitAudioContext?: typeof AudioContext }
  return window.AudioContext ?? audioWindow.webkitAudioContext
}

export const roomAudioSim = new RoomAudioSimulator()
