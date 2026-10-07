import { useEffect, useSyncExternalStore } from 'react'
import {
  BASE_LATENCY_DELTA_MS,
  buildSetParametersScript,
  clamp,
  clampDelayMs,
  clampGainDb,
  DEVICES,
  getTargetDelays,
  LISTENING_MODES,
  MAX_SLEW_PER_STEP_MS,
  type DeviceId,
  type EqBands,
  type ListeningModeId,
} from './devices'
import { roomAudioSim } from './audioSim'
import { BRIDGE_ORIGIN } from './bridgeInstaller'

export const CONTROL_TICK_MS = 50
export const BRIDGE_POLL_INTERVAL_MS = 500
export const RESIDUAL_EMA_ALPHA = 0.15
export const LOCK_ENTER_THRESHOLD_MS = 10
export const LOCK_EXIT_THRESHOLD_MS = 12
export const LOCK_EXIT_DEBOUNCE_FRAMES = 30
export const DELAY_SETTLE_DEADBAND_MS = 4.5
const COHERENCE_JITTER_SCALE_MS = 200
const HISTORY_LIMIT = 240

export type ConnectionStatus = 'simulated' | 'connecting' | 'live' | 'offline'
export type LockStatus = 'locked' | 'adjusting' | 'unlocked'

export interface DeviceTelemetry {
  rmsDb: number
  delayMs: number
  gainDb: number
  connected: boolean
}

export interface TimingSample {
  timestamp: number
  residualMs: number
  coherence: number
}

export interface CalibrationState {
  open: boolean
  step: 1 | 2 | 3 | 4
  complete: boolean
  error: string | null
  carrierVerified: boolean
  measuredLatencyMs: Record<DeviceId, number> | null
  measuredSensitivityDb: Record<DeviceId, number> | null
}

export interface LockstepState {
  running: boolean
  connection: ConnectionStatus
  autopilot: boolean
  mode: ListeningModeId
  lock: LockStatus
  residualMs: number
  coherence: number
  manualTrimMs: number
  gainTrimDb: Record<DeviceId, number>
  eqDb: Record<DeviceId, EqBands>
  devices: Record<DeviceId, DeviceTelemetry>
  timingHistory: readonly TimingSample[]
  lastCommand: string | null
  commandError: string | null
  lastBridgePollAt: number | null
  calibration: CalibrationState
  audioAudition: boolean
}

interface BridgeTelemetry {
  t?: unknown
  conn?: unknown
  autopilot?: unknown
  mode?: unknown
  lock?: unknown
  residualMs?: unknown
  coherence?: unknown
  devices?: Partial<Record<DeviceId, Partial<DeviceTelemetry>>>
}

export interface LockstepActions {
  start: () => void
  stop: () => void
  reconnect: () => void
  setMode: (mode: ListeningModeId) => void
  setManualTrim: (trimMs: number) => void
  setGain: (device: DeviceId, gainDb: number) => void
  setEqBand: (device: DeviceId, band: 0 | 1 | 2, gainDb: number) => void
  setDeviceConnected: (device: DeviceId, connected: boolean) => void
  setAutopilot: (enabled: boolean) => void
  sendCommand: (script: string) => Promise<boolean>
  startCalibration: () => void
  advanceCalibration: () => Promise<boolean>
  cancelCalibration: () => void
  setAudioAudition: (enabled: boolean) => void
}

const initialCalibration = (): CalibrationState => ({
  open: false,
  step: 1,
  complete: false,
  error: null,
  carrierVerified: false,
  measuredLatencyMs: null,
  measuredSensitivityDb: null,
})

const initialState: LockstepState = {
  running: false,
  connection: 'simulated',
  autopilot: true,
  mode: 'seamless',
  lock: 'locked',
  residualMs: 0,
  coherence: 0.9,
  manualTrimMs: 0,
  gainTrimDb: { soundbar: 0, party: 0 },
  eqDb: {
    soundbar: LISTENING_MODES.seamless.eqDb.soundbar,
    party: LISTENING_MODES.seamless.eqDb.party,
  },
  devices: {
    soundbar: { rmsDb: -14.2, delayMs: BASE_LATENCY_DELTA_MS, gainDb: 1.8, connected: true },
    party: { rmsDb: -16.0, delayMs: 0, gainDb: -2.4, connected: true },
  },
  timingHistory: [],
  lastCommand: null,
  commandError: null,
  lastBridgePollAt: null,
  calibration: initialCalibration(),
  audioAudition: false,
}

let state = initialState
const listeners = new Set<() => void>()
let controlTimer: ReturnType<typeof setTimeout> | undefined
let queuedCommandTimer: ReturnType<typeof setTimeout> | undefined
let loopStartedAt = 0
let pollInFlight = false
let commandInFlight = false
let mountedConsumers = 0
let instantaneousResidualMs = 0
let smoothedResidualMs = 0
let hasResidualSample = false
let consecutiveUnlockFrames = 0

function publish(next: LockstepState): void {
  state = next
  listeners.forEach((listener) => listener())
  if (state.audioAudition) updateAudition()
}

function patchState(patch: Partial<LockstepState>): void {
  publish({ ...state, ...patch })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): LockstepState {
  return state
}

function getTargetGain(device: DeviceId): number {
  return clampGainDb(LISTENING_MODES[state.mode].gainDb[device] + state.gainTrimDb[device])
}

function updateAudition(): void {
  roomAudioSim.updateParameters({
    delayBarMs: state.devices.soundbar.delayMs,
    delayTowerMs: state.devices.party.delayMs,
    gainBarDb: state.devices.soundbar.gainDb,
    gainTowerDb: state.devices.party.gainDb,
    barConnected: state.devices.soundbar.connected,
    towerConnected: state.devices.party.connected,
  })
}

function currentCommand(): string {
  const mode = LISTENING_MODES[state.mode]
  // The loop sends the current slewed delay, while the mode biases determine
  // the target used by the controller on every 50 ms tick.
  return buildSetParametersScript({
    stripIndex: 5,
    stripA1: state.devices.soundbar.connected,
    stripA2: state.devices.party.connected,
    delayBarMs: state.devices.soundbar.delayMs,
    delayTowerMs: state.devices.party.delayMs,
    gainBarDb: state.devices.soundbar.gainDb,
    gainTowerDb: state.devices.party.gainDb,
    eqBarDb: state.eqDb.soundbar,
    eqTowerDb: state.eqDb.party,
    mono: mode.mono,
  })
}

function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  return fetch(url, {
    ...init,
    cache: 'no-store',
    signal: AbortSignal.timeout(1200),
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Bridge returned HTTP ${response.status}`)
    return (await response.json()) as T
  })
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function applyBridgeTelemetry(payload: BridgeTelemetry): void {
  if (payload.t !== 'state') throw new Error('Bridge returned an unknown state payload.')
  const bridgeDevices = payload.devices ?? {}
  const mergedDevices = { ...state.devices }
  for (const id of ['soundbar', 'party'] as const) {
    const incoming = bridgeDevices[id]
    if (!incoming) continue
    mergedDevices[id] = {
      rmsDb: finiteNumber(incoming.rmsDb, mergedDevices[id].rmsDb),
      delayMs: clampDelayMs(finiteNumber(incoming.delayMs, mergedDevices[id].delayMs)),
      gainDb: clampGainDb(finiteNumber(incoming.gainDb, mergedDevices[id].gainDb)),
      connected: typeof incoming.connected === 'boolean' ? incoming.connected : mergedDevices[id].connected,
    }
  }
  const now = Date.now()
  const residual = finiteNumber(payload.residualMs, calculateResidual(mergedDevices))
  instantaneousResidualMs = residual
  hasResidualSample = true
  publish({
    ...state,
    connection: payload.conn === 'live' ? 'live' : 'offline',
    autopilot: typeof payload.autopilot === 'boolean' ? payload.autopilot : state.autopilot,
    devices: mergedDevices,
    lastBridgePollAt: now,
    commandError: null,
  })
}

function calculateResidual(devices: Record<DeviceId, DeviceTelemetry>, driftMs = 0, jitterMs = 0): number {
  return DEVICES.soundbar.nativeLatencyMs + devices.soundbar.delayMs
    - DEVICES.party.nativeLatencyMs - devices.party.delayMs + driftMs + jitterMs
}

function calculateCoherence(residual: number): number {
  const jitterPenalty = (DEVICES.soundbar.jitterMs + DEVICES.party.jitterMs) / COHERENCE_JITTER_SCALE_MS
  return clamp(Math.exp(-Math.abs(residual) / 28) - jitterPenalty, 0, 1)
}

async function pollBridge(): Promise<void> {
  if (pollInFlight) return
  pollInFlight = true
  try {
    const payload = await requestJson<BridgeTelemetry>(`${BRIDGE_ORIGIN}/`)
    applyBridgeTelemetry(payload)
  } catch {
    patchState({
      connection: state.connection === 'connecting' || state.connection === 'live' ? 'simulated' : state.connection,
      lastBridgePollAt: Date.now(),
    })
  } finally {
    pollInFlight = false
  }
}

async function postCommand(script: string): Promise<boolean> {
  if (commandInFlight) return false
  commandInFlight = true
  try {
    const response = await requestJson<{ ok?: boolean; message?: string }>(`${BRIDGE_ORIGIN}/cmd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script }),
    })
    if (response.ok !== true) throw new Error(response.message || 'The bridge did not apply the command.')
    patchState({ lastCommand: script, commandError: null })
    return true
  } catch (error) {
    patchState({ commandError: error instanceof Error ? error.message : 'Could not send command to the bridge.' })
    return false
  } finally {
    commandInFlight = false
  }
}

function scheduleCurrentCommand(): void {
  if (queuedCommandTimer) clearTimeout(queuedCommandTimer)
  queuedCommandTimer = setTimeout(() => {
    queuedCommandTimer = undefined
    if (state.connection !== 'live') return
    if (commandInFlight) {
      scheduleCurrentCommand()
      return
    }
    const script = currentCommand()
    if (script !== state.lastCommand) void postCommand(script)
  }, 120)
}

function makeControlFrame(now: number): void {
  const elapsedSeconds = Math.max(0, (now - loopStartedAt) / 1000)
  const isLive = state.connection === 'live'
  const driftMs = isLive ? 0 : (DEVICES.party.clockPpm - DEVICES.soundbar.clockPpm) * elapsedSeconds / 1000
  const jitter = isLive ? 0 : (Math.random() - 0.5) * (DEVICES.soundbar.jitterMs + DEVICES.party.jitterMs)
  const devices = { ...state.devices }
  const target = getTargetDelays(LISTENING_MODES[state.mode], state.manualTrimMs)
  const diff = target.soundbar - devices.soundbar.delayMs
  if (state.autopilot) {
    const nextDelay = Math.abs(diff) <= DELAY_SETTLE_DEADBAND_MS
      ? target.soundbar
      : devices.soundbar.delayMs + Math.sign(diff) * Math.min(Math.abs(diff), MAX_SLEW_PER_STEP_MS)
    if (nextDelay !== devices.soundbar.delayMs) {
      devices.soundbar = { ...devices.soundbar, delayMs: clampDelayMs(nextDelay) }
    }
  }
  if (state.autopilot) {
    for (const id of ['soundbar', 'party'] as const) {
      const targetGain = getTargetGain(id)
      if (Math.abs(devices[id].gainDb - targetGain) > 0.05) {
        devices[id] = { ...devices[id], gainDb: targetGain }
      }
    }
  }

  // Approximate output level with bounded room jitter for the offline preview.
  if (!isLive) {
    for (const id of ['soundbar', 'party'] as const) {
      const device = DEVICES[id]
      const levelWobble = (Math.random() - 0.5) * device.jitterMs * 0.12
      devices[id] = {
        ...devices[id],
        rmsDb: devices[id].connected ? clamp(-18 + devices[id].gainDb + levelWobble, -90, 0) : -90,
      }
    }
  }

  if (!isLive || !hasResidualSample) {
    instantaneousResidualMs = calculateResidual(devices, driftMs, jitter)
    hasResidualSample = true
  }
  // Smooth all live and simulated measurements at the 20 Hz control rate so
  // the chart and lock logic never consume packet-level timing spikes directly.
  smoothedResidualMs = (smoothedResidualMs * (1 - RESIDUAL_EMA_ALPHA))
    + (instantaneousResidualMs * RESIDUAL_EMA_ALPHA)
  const residual = smoothedResidualMs
  const coherence = calculateCoherence(residual)
  const carriersActive = devices.soundbar.connected && devices.party.connected
  let lock: LockStatus
  if (!carriersActive) {
    lock = 'unlocked'
    consecutiveUnlockFrames = 0
  } else if (state.lock === 'locked') {
    if (Math.abs(residual) > LOCK_EXIT_THRESHOLD_MS) {
      consecutiveUnlockFrames += 1
      lock = consecutiveUnlockFrames >= LOCK_EXIT_DEBOUNCE_FRAMES ? 'adjusting' : 'locked'
    } else {
      consecutiveUnlockFrames = 0
      lock = 'locked'
    }
  } else {
    consecutiveUnlockFrames = 0
    lock = Math.abs(residual) <= LOCK_ENTER_THRESHOLD_MS ? 'locked' : 'adjusting'
  }
  const sample: TimingSample = { timestamp: Date.now(), residualMs: residual, coherence }
  publish({
    ...state,
    connection: state.connection === 'live' ? 'live' : 'simulated',
    residualMs: residual,
    coherence,
    lock,
    devices,
    timingHistory: [...state.timingHistory.slice(-(HISTORY_LIMIT - 1)), sample],
  })

  if (state.audioAudition) updateAudition()
  // Send each small 20 Hz slew increment to hardware. Manual trim itself is
  // committed only after interaction ends, so this never mirrors slider noise.
  if (state.connection === 'live' && state.autopilot) {
    const script = currentCommand()
    if (script !== state.lastCommand && !commandInFlight) void postCommand(script)
  }
}

function scheduleControlTick(): void {
  if (!state.running) return
  const tickStarted = Date.now()
  makeControlFrame(tickStarted)
  void pollBridgeIfDue(tickStarted)
  const elapsed = Date.now() - tickStarted
  controlTimer = setTimeout(scheduleControlTick, Math.max(0, CONTROL_TICK_MS - elapsed))
}

async function pollBridgeIfDue(now: number): Promise<void> {
  if (now - (state.lastBridgePollAt ?? 0) >= BRIDGE_POLL_INTERVAL_MS) {
    if (state.connection === 'simulated') patchState({ connection: 'connecting' })
    await pollBridge()
  }
}

function startEngine(): void {
  if (state.running) return
  loopStartedAt = Date.now()
  instantaneousResidualMs = state.residualMs
  smoothedResidualMs = state.residualMs
  hasResidualSample = false
  consecutiveUnlockFrames = 0
  patchState({ running: true, connection: 'connecting' })
  void pollBridge()
  scheduleControlTick()
}

function stopEngine(): void {
  if (controlTimer) clearTimeout(controlTimer)
  if (queuedCommandTimer) clearTimeout(queuedCommandTimer)
  controlTimer = undefined
  queuedCommandTimer = undefined
  if (state.audioAudition) roomAudioSim.stop()
  if (state.running || state.audioAudition) patchState({ running: false, audioAudition: false })
}

async function sendCurrentProfile(): Promise<boolean> {
  const script = currentCommand()
  if (state.connection !== 'live') {
    patchState({ lastCommand: script, commandError: 'Bridge is not connected; profile is active in simulation only.' })
    return false
  }
  return postCommand(script)
}

function startCalibration(): void {
  publish({ ...state, calibration: { ...initialCalibration(), open: true } })
}

async function advanceCalibration(): Promise<boolean> {
  const calibration = state.calibration
  if (!calibration.open) return false

  if (calibration.step === 1) {
    const carriersPresent = state.devices.soundbar.connected && state.devices.party.connected
    if (!carriersPresent) {
      publish({ ...state, calibration: { ...calibration, error: 'Both A1 and A2 speaker routes must be enabled.' } })
      return false
    }
    publish({ ...state, calibration: { ...calibration, step: 2, carrierVerified: true, error: null } })
    return true
  }

  if (calibration.step === 2) {
    publish({
      ...state,
      calibration: {
        ...calibration,
        step: 3,
        measuredLatencyMs: {
          soundbar: DEVICES.soundbar.nativeLatencyMs,
          party: DEVICES.party.nativeLatencyMs,
        },
        error: null,
      },
    })
    return true
  }

  if (calibration.step === 3) {
    publish({
      ...state,
      calibration: {
        ...calibration,
        step: 4,
        measuredSensitivityDb: {
          soundbar: DEVICES.soundbar.sensitivityDb,
          party: DEVICES.party.sensitivityDb,
        },
        error: null,
      },
    })
    return true
  }

  const seamless = LISTENING_MODES.seamless
  patchState({
    mode: 'seamless',
    manualTrimMs: 0,
    gainTrimDb: { soundbar: 0, party: 0 },
    eqDb: seamless.eqDb,
    devices: {
      soundbar: { ...state.devices.soundbar, delayMs: BASE_LATENCY_DELTA_MS, gainDb: 1.8 },
      party: { ...state.devices.party, delayMs: 0, gainDb: -2.4 },
    },
  })
  const success = await sendCurrentProfile()
  publish({
    ...state,
    autopilot: true,
    calibration: {
      ...calibration,
      complete: true,
      open: false,
      error: success || state.connection !== 'live' ? null : state.commandError,
    },
  })
  return success || state.connection !== 'live'
}

function cancelCalibration(): void {
  publish({ ...state, calibration: initialCalibration() })
}

const actions: LockstepActions = {
  start: startEngine,
  stop: stopEngine,
  reconnect() {
    patchState({ connection: 'connecting' })
    void pollBridge()
  },
  setMode(mode) {
    if (!(mode in LISTENING_MODES)) return
    patchState({ mode, eqDb: LISTENING_MODES[mode].eqDb })
    scheduleCurrentCommand()
  },
  setManualTrim(trimMs) {
    patchState({ manualTrimMs: clamp(trimMs, -40, 40) })
  },
  setGain(device, gainDb) {
    const normalizedGain = clampGainDb(gainDb)
    patchState({
      gainTrimDb: { ...state.gainTrimDb, [device]: normalizedGain - LISTENING_MODES[state.mode].gainDb[device] },
      devices: { ...state.devices, [device]: { ...state.devices[device], gainDb: normalizedGain } },
    })
    scheduleCurrentCommand()
  },
  setEqBand(device, band, gainDb) {
    const bands = [...state.eqDb[device]] as [number, number, number]
    bands[band] = clamp(gainDb, -12, 12)
    patchState({ eqDb: { ...state.eqDb, [device]: bands } })
    scheduleCurrentCommand()
  },
  setDeviceConnected(device, connected) {
    patchState({ devices: { ...state.devices, [device]: { ...state.devices[device], connected } } })
    scheduleCurrentCommand()
  },
  setAutopilot(enabled) {
    patchState({ autopilot: enabled, lock: enabled ? 'adjusting' : 'unlocked' })
    if (enabled) scheduleCurrentCommand()
  },
  sendCommand: postCommand,
  startCalibration,
  advanceCalibration,
  cancelCalibration,
  setAudioAudition(enabled) {
    if (enabled && !roomAudioSim.active) {
      try {
        roomAudioSim.start({
          delayBarMs: state.devices.soundbar.delayMs,
          delayTowerMs: state.devices.party.delayMs,
          gainBarDb: state.devices.soundbar.gainDb,
          gainTowerDb: state.devices.party.gainDb,
          barConnected: state.devices.soundbar.connected,
          towerConnected: state.devices.party.connected,
        })
        patchState({ audioAudition: true, commandError: null })
      } catch (error) {
        patchState({ commandError: error instanceof Error ? error.message : 'Could not start audio audition.' })
      }
    } else if (!enabled) {
      roomAudioSim.stop()
      patchState({ audioAudition: false })
    }
  },
}

/** Shared engine state and actions for dashboard components. */
export function useLockstepEngine(): LockstepState & LockstepActions {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot)

  useEffect(() => {
    mountedConsumers += 1
    startEngine()
    return () => {
      mountedConsumers = Math.max(0, mountedConsumers - 1)
      if (mountedConsumers === 0) stopEngine()
    }
  }, [])

  return { ...current, ...actions }
}

export const lockstepEngine = {
  getState: snapshot,
  subscribe,
  ...actions,
}
