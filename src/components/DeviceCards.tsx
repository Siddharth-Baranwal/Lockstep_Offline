import { useId } from 'react'
import type { CSSProperties } from 'react'
import { Activity, AudioLines, Power, Radio, Speaker } from 'lucide-react'
import { DEVICES, GAIN_RANGE_DB, type DeviceId } from '../lib/devices'
import type { DeviceTelemetry, LockstepState } from '../lib/store'

interface DeviceCardsProps {
  devices: Record<DeviceId, DeviceTelemetry>
  eqDb: LockstepState['eqDb']
  setGain: (device: DeviceId, gainDb: number) => void
  setEqBand: (device: DeviceId, band: 0 | 1 | 2, gainDb: number) => void
  setDeviceConnected: (device: DeviceId, connected: boolean) => void
}

export function DeviceCards({ devices, eqDb, setGain, setEqBand, setDeviceConnected }: DeviceCardsProps) {
  return (
    <section aria-labelledby="devices-title">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <p className="eyebrow">Hardware output</p>
          <h2 id="devices-title" className="panel-title">Speaker buses</h2>
        </div>
        <span className="hidden font-mono text-[10px] uppercase tracking-wider text-zinc-500 sm:block">Voicemeeter Potato · Kind 3</span>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <DeviceCard device="soundbar" telemetry={devices.soundbar} eq={eqDb.soundbar} onGain={setGain} onEq={setEqBand} onConnected={setDeviceConnected} />
        <DeviceCard device="party" telemetry={devices.party} eq={eqDb.party} onGain={setGain} onEq={setEqBand} onConnected={setDeviceConnected} />
      </div>
    </section>
  )
}

function DeviceCard({
  device, telemetry, eq, onGain, onEq, onConnected,
}: {
  device: DeviceId
  telemetry: DeviceTelemetry
  eq: readonly [number, number, number]
  onGain: DeviceCardsProps['setGain']
  onEq: DeviceCardsProps['setEqBand']
  onConnected: DeviceCardsProps['setDeviceConnected']
}) {
  const profile = DEVICES[device]
  const idPrefix = useId()
  const meterPercent = telemetry.connected ? Math.max(2, Math.min(100, ((telemetry.rmsDb + 60) / 60) * 100)) : 0
  const gainPercent = ((telemetry.gainDb - GAIN_RANGE_DB[0]) / (GAIN_RANGE_DB[1] - GAIN_RANGE_DB[0])) * 100
  const SpeakerIcon = device === 'soundbar' ? Speaker : Radio

  return (
    <article className={`panel device-panel ${device === 'party' ? 'device-panel-party' : ''}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`device-icon ${device === 'party' ? 'device-icon-party' : ''}`}><SpeakerIcon size={19} strokeWidth={1.7} /></div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-zinc-100">{profile.name}</h3>
              <span className="bus-badge">{profile.busName}</span>
            </div>
            <p className="mt-1 text-[10px] text-zinc-500">{profile.watts} W · native {profile.nativeLatencyMs} ms · {profile.clockPpm} ppm clock</p>
          </div>
        </div>
        <button
          type="button"
          className={`icon-button ${telemetry.connected ? 'icon-button-on' : ''}`}
          aria-label={`${telemetry.connected ? 'Mute' : 'Enable'} ${profile.shortName}`}
          aria-pressed={telemetry.connected}
          onClick={() => onConnected(device, !telemetry.connected)}
        >
          <Power size={15} />
        </button>
      </header>

      <div className="mt-4 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500"><Activity size={12} /> Output level</span>
          <span className="font-mono text-xs tabular-nums text-zinc-200">{telemetry.connected ? `${telemetry.rmsDb.toFixed(1)} dBFS` : '−∞ dBFS'}</span>
        </div>
        <div className="level-track" aria-label="Output level meter" role="meter" aria-valuemin={-60} aria-valuemax={0} aria-valuenow={telemetry.connected ? telemetry.rmsDb : -60}>
          <span className={`level-fill ${device === 'party' ? 'level-fill-party' : ''}`} style={{ width: `${meterPercent}%` }} />
          <span className="level-ticks" />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1">
        <label htmlFor={`${idPrefix}-gain`} className="eyebrow">Bus gain</label>
        <output htmlFor={`${idPrefix}-gain`} className="font-mono text-xs tabular-nums text-lime-200">{telemetry.gainDb >= 0 ? '+' : ''}{telemetry.gainDb.toFixed(1)} dB</output>
        <RangeInput
          id={`${idPrefix}-gain`}
          label={`${profile.shortName} bus gain`}
          min={GAIN_RANGE_DB[0]}
          max={GAIN_RANGE_DB[1]}
          step={0.1}
          value={telemetry.gainDb}
          progress={gainPercent}
          disabled={!telemetry.connected}
          onChange={(value) => onGain(device, value)}
          className="col-span-2"
        />
      </div>

      <div className="mt-4 border-t border-white/[0.06] pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="eyebrow inline-flex items-center gap-1.5"><AudioLines size={12} /> 3-band equalizer</span>
          <span className="text-[9px] uppercase tracking-widest text-zinc-600">Low · Mid · High</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {(['Low', 'Mid', 'High'] as const).map((label, band) => {
            const index = band as 0 | 1 | 2
            const rangeProgress = ((eq[index] + 12) / 24) * 100
            return (
              <div className="min-w-0" key={label}>
                <div className="mb-1 flex items-center justify-between gap-1">
                  <label htmlFor={`${idPrefix}-eq-${band}`} className="text-[10px] text-zinc-500">{label}</label>
                  <output htmlFor={`${idPrefix}-eq-${band}`} className="font-mono text-[10px] tabular-nums text-zinc-300">{eq[index] >= 0 ? '+' : ''}{eq[index].toFixed(1)}</output>
                </div>
                <RangeInput
                  id={`${idPrefix}-eq-${band}`}
                  label={`${profile.shortName} ${label.toLowerCase()} EQ`}
                  min={-12}
                  max={12}
                  step={0.1}
                  value={eq[index]}
                  progress={rangeProgress}
                  disabled={!telemetry.connected}
                  onChange={(value) => onEq(device, index, value)}
                />
              </div>
            )
          })}
        </div>
      </div>

      <footer className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-3 text-[10px]">
        <span className="inline-flex items-center gap-1.5 text-zinc-500"><span className={`h-1.5 w-1.5 rounded-full ${telemetry.connected ? 'bg-lime-400' : 'bg-zinc-600'}`} />{telemetry.connected ? 'Route active' : 'Route muted'}</span>
        <span className="font-mono text-zinc-400">Delay {telemetry.delayMs.toFixed(1)} ms</span>
      </footer>
    </article>
  )
}

function RangeInput({
  id, label, min, max, step, value, progress, disabled, onChange, className = '',
}: {
  id: string
  label: string
  min: number
  max: number
  step: number
  value: number
  progress: number
  disabled: boolean
  onChange: (value: number) => void
  className?: string
}) {
  return (
    <input
      id={id}
      className={`range-input ${className}`}
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      style={{ '--range-progress': `${progress}%` } as CSSProperties}
      onChange={(event) => onChange(Number(event.currentTarget.value))}
    />
  )
}
