/** Hardware profiles and control math for the Lockstep Offline room setup. */

export type DeviceId = 'soundbar' | 'party'
export type BusIndex = 0 | 1
export type EqBands = readonly [number, number, number]
export type ListeningModeId = 'seamless' | 'cinema' | 'party' | 'karaoke' | 'night'

export interface DeviceProfile {
  readonly id: DeviceId
  readonly name: string
  readonly shortName: string
  readonly busName: string
  readonly busIndex: BusIndex
  readonly delayIndex: BusIndex
  readonly watts: number
  readonly nativeLatencyMs: number
  readonly jitterMs: number
  readonly clockPpm: number
  readonly sensitivityDb: number
}

export const DEVICES: Readonly<Record<DeviceId, DeviceProfile>> = {
  soundbar: {
    id: 'soundbar',
    name: 'Zebronics Juke Bar 200 A',
    shortName: 'Zebronics Juke Bar',
    busName: 'A1 · Bus[0]',
    busIndex: 0,
    delayIndex: 0,
    watts: 50,
    nativeLatencyMs: 148,
    jitterMs: 6,
    clockPpm: 12,
    sensitivityDb: -1.8,
  },
  party: {
    id: 'party',
    name: 'UBON Rockstar SP-29',
    shortName: 'UBON Rockstar',
    busName: 'A2 · Bus[1]',
    busIndex: 1,
    delayIndex: 1,
    watts: 30,
    nativeLatencyMs: 196,
    jitterMs: 14,
    clockPpm: 38,
    sensitivityDb: 2.4,
  },
}

export const HARDWARE = DEVICES
export const BASE_LATENCY_DELTA_MS = DEVICES.party.nativeLatencyMs - DEVICES.soundbar.nativeLatencyMs
export const HAAS_LIMIT_MS = 12
export const HAAS_TARGET_LEAD_MS = 8
export const DEAD_BAND_MS = 5
export const MAX_SLEW_PER_STEP_MS = 1.35
export const CONTROL_LOOP_HZ = 20
export const DELAY_RANGE_MS = [0, 500] as const
export const GAIN_RANGE_DB = [-60, 12] as const

export interface ListeningMode {
  readonly id: ListeningModeId
  readonly label: string
  readonly name: string
  readonly description: string
  readonly lead: DeviceId
  readonly delayBiasMs: number
  readonly gainBiasDb: Readonly<Record<DeviceId, number>>
  readonly gainDb: Readonly<Record<DeviceId, number>>
  readonly eqDb: Readonly<Record<DeviceId, EqBands>>
  readonly mono: boolean
}

function mode(
  id: ListeningModeId,
  label: string,
  description: string,
  lead: DeviceId,
  delayBiasMs: number,
  gainBiasDb: Record<DeviceId, number>,
  eqDb: Record<DeviceId, EqBands>,
  mono: boolean,
): ListeningMode {
  return {
    id, label, name: label, description, lead, delayBiasMs, gainBiasDb,
    // Gains compensate for measured speaker sensitivity plus the mode bias.
    gainDb: {
      soundbar: -DEVICES.soundbar.sensitivityDb + gainBiasDb.soundbar,
      party: -DEVICES.party.sensitivityDb + gainBiasDb.party,
    },
    eqDb,
    mono,
  }
}

export const MODES: Readonly<Record<ListeningModeId, ListeningMode>> = {
  seamless: mode('seamless', 'Seamless', 'Balanced room fill', 'soundbar', 0,
    { soundbar: 0, party: 0 },
    { soundbar: [-2.5, 1.2, 1.8], party: [2.2, -1.0, -2.4] }, true),
  cinema: mode('cinema', 'Cinema', 'Dialogue focused', 'soundbar', -4,
    { soundbar: 1.2, party: -3.5 },
    { soundbar: [-4.0, 2.4, 1.5], party: [5.5, -8.5, -10.5] }, false),
  party: mode('party', 'Party', 'Full room energy', 'soundbar', 0,
    { soundbar: -2.8, party: 1.6 },
    { soundbar: [-5.0, 0.5, 3.2], party: [3.8, 0.4, -1.2] }, true),
  karaoke: mode('karaoke', 'Karaoke', 'Vocal timing priority', 'party', 4,
    { soundbar: -1.5, party: 0.8 },
    { soundbar: [-3.0, 1.8, 2.0], party: [1.2, 1.5, 0.4] }, true),
  night: mode('night', 'Night', 'Reduced late night output', 'soundbar', 0,
    { soundbar: -6.0, party: -8.0 },
    { soundbar: [-6.0, 0.8, 0.4], party: [-5.0, -1.0, -2.0] }, true),
}

export const LISTENING_MODES = MODES
export const MODE_LIST: readonly ListeningMode[] = Object.values(MODES)

/** Clamp a finite number to an inclusive range (bounds may be supplied either way). */
export function clamp(value: number, min: number, max: number): number {
  const lower = Math.min(min, max)
  const upper = Math.max(min, max)
  if (!Number.isFinite(value)) return lower
  return Math.min(upper, Math.max(lower, value))
}

export const clampDelayMs = (value: number): number => clamp(value, ...DELAY_RANGE_MS)
export const clampGainDb = (value: number): number => clamp(value, ...GAIN_RANGE_DB)

/** A1 receives the compensating delay; the slower A2 device remains at zero. */
export function getTargetDelays(mode: ListeningMode, manualTrimMs = 0): Record<DeviceId, number> {
  return {
    soundbar: clampDelayMs(BASE_LATENCY_DELTA_MS + mode.delayBiasMs + manualTrimMs),
    party: 0,
  }
}

export interface PotatoParameterOptions {
  stripIndex: number
  stripA1: boolean
  stripA2: boolean
  delayBarMs: number
  delayTowerMs: number
  gainBarDb: number
  gainTowerDb: number
  eqBarDb: EqBands
  eqTowerDb: EqBands
  mono?: boolean
}

/** Build the semicolon-delimited ASCII assignment string accepted by VBVMR_SetParameters. */
export function buildSetParametersScript(params: PotatoParameterOptions): string {
  const parts = [
    `Strip[${Math.trunc(params.stripIndex)}].A1=${params.stripA1 ? 1 : 0}`,
    `Strip[${Math.trunc(params.stripIndex)}].A2=${params.stripA2 ? 1 : 0}`,
    `Option.delay[0]=${Math.round(clampDelayMs(params.delayBarMs))}`,
    `Option.delay[1]=${Math.round(clampDelayMs(params.delayTowerMs))}`,
    `Bus[0].Gain=${clampGainDb(params.gainBarDb).toFixed(1)}`,
    `Bus[1].Gain=${clampGainDb(params.gainTowerDb).toFixed(1)}`,
    `Bus[0].EQ.cell[0].gain=${params.eqBarDb[0].toFixed(1)}`,
    `Bus[0].EQ.cell[1].gain=${params.eqBarDb[1].toFixed(1)}`,
    `Bus[0].EQ.cell[2].gain=${params.eqBarDb[2].toFixed(1)}`,
    `Bus[1].EQ.cell[0].gain=${params.eqTowerDb[0].toFixed(1)}`,
    `Bus[1].EQ.cell[1].gain=${params.eqTowerDb[1].toFixed(1)}`,
    `Bus[1].EQ.cell[2].gain=${params.eqTowerDb[2].toFixed(1)}`,
  ]
  if (typeof params.mono === 'boolean') {
    parts.push(`Strip[${Math.trunc(params.stripIndex)}].Mono=${params.mono ? 1 : 0}`)
  }
  return `${parts.join('; ')};`
}

export interface VoicemeeterCommandOptions {
  mode: ListeningMode
  manualTrimMs?: number
  gainDb?: Partial<Record<DeviceId, number>>
  mono?: boolean
  stripIndex?: number
  stripA1?: boolean
  stripA2?: boolean
}

/** Convenience builder for applying one mode's target values to the routed input strip. */
export function buildVoicemeeterCommand({
  mode, manualTrimMs = 0, gainDb = {}, mono = mode.mono,
  stripIndex = 5, stripA1 = true, stripA2 = true,
}: VoicemeeterCommandOptions): string {
  const delays = getTargetDelays(mode, manualTrimMs)
  return buildSetParametersScript({
    stripIndex, stripA1, stripA2,
    delayBarMs: delays.soundbar,
    delayTowerMs: delays.party,
    gainBarDb: gainDb.soundbar ?? mode.gainDb.soundbar,
    gainTowerDb: gainDb.party ?? mode.gainDb.party,
    eqBarDb: mode.eqDb.soundbar,
    eqTowerDb: mode.eqDb.party,
    mono,
  })
}

export const buildVoicemeeterCommandString = buildVoicemeeterCommand
