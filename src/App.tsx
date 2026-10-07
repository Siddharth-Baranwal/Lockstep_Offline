import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { AudioWaveform, Bluetooth, CheckCircle2, Clock3, Headphones, RadioTower, SlidersHorizontal, Waves } from 'lucide-react'
import { BridgeAndRoutingPanel } from './components/BridgeAndRoutingPanel'
import { CalibrationModal } from './components/CalibrationModal'
import { DeviceCards } from './components/DeviceCards'
import { ResidualTimingChart } from './components/ResidualTimingChart'
import { RoomStage } from './components/RoomStage'
import { BASE_LATENCY_DELTA_MS, MODE_LIST } from './lib/devices'
import { useLockstepEngine } from './lib/store'

export default function App() {
  const engine = useLockstepEngine()
  const [trimDraft, setTrimDraft] = useState(engine.manualTrimMs)
  const trimDraftRef = useRef(engine.manualTrimMs)
  const trimCommitTimer = useRef<number | undefined>(undefined)
  const trimPointerActive = useRef(false)
  const mode = MODE_LIST.find((entry) => entry.id === engine.mode) ?? MODE_LIST[0]
  const statusLabel = engine.connection === 'live'
    ? 'HARDWARE LINK'
    : engine.connection === 'connecting'
      ? 'CONNECTING'
      : 'OFFLINE SIM'
  const stabilityLabel = useMemo(() => {
    if (engine.lock === 'locked') return 'LOCKED'
    if (engine.lock === 'adjusting') return 'ALIGNING'
    return 'UNLOCKED'
  }, [engine.lock])

  useEffect(() => {
    trimDraftRef.current = engine.manualTrimMs
    setTrimDraft(engine.manualTrimMs)
  }, [engine.manualTrimMs])

  useEffect(() => () => {
    if (trimCommitTimer.current !== undefined) window.clearTimeout(trimCommitTimer.current)
  }, [])

  function commitTrim(value = trimDraftRef.current) {
    if (trimCommitTimer.current !== undefined) window.clearTimeout(trimCommitTimer.current)
    trimCommitTimer.current = undefined
    const boundedValue = Math.max(-40, Math.min(40, Number(value.toFixed(1))))
    trimDraftRef.current = boundedValue
    setTrimDraft(boundedValue)
    engine.setManualTrim(boundedValue)
  }

  function stageTrim(value: number) {
    const nextValue = Math.max(-40, Math.min(40, Number(value.toFixed(1))))
    trimDraftRef.current = nextValue
    setTrimDraft(nextValue)
    if (!trimPointerActive.current) {
      if (trimCommitTimer.current !== undefined) window.clearTimeout(trimCommitTimer.current)
      // Keyboard and assistive input still commits if there is no pointer-up.
      trimCommitTimer.current = window.setTimeout(() => commitTrim(trimDraftRef.current), 150)
    }
  }

  return (
    <div className="app-shell">
      <div className="ambient-glow" aria-hidden="true" />
      <header className="topbar">
        <div className="mx-auto flex w-full max-w-[1500px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <a href="#top" className="brand-mark" aria-label="Lockstep Offline home">
            <div className="brand-symbol"><AudioWaveform size={19} strokeWidth={1.8} /></div>
            <div>
              <p className="brand-name">LOCKSTEP <span>OFFLINE</span></p>
              <p className="brand-caption">DUAL SPEAKER SYNCHRONIZATION</p>
            </div>
          </a>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className={`connection-chip ${engine.connection === 'live' ? 'connection-chip-live' : ''}`}>
              {engine.connection === 'live' ? <Bluetooth size={13} /> : <RadioTower size={13} />}
              <span className="hidden sm:inline">{statusLabel}</span>
              <span className="sm:hidden">{engine.connection === 'live' ? 'LIVE' : 'SIM'}</span>
              <i />
            </div>
            <button type="button" className="button-primary !hidden sm:!inline-flex" onClick={engine.startCalibration}>
              <SlidersHorizontal size={14} /> Calibrate
            </button>
            <button type="button" className="icon-button sm:hidden" onClick={engine.startCalibration} aria-label="Start calibration"><SlidersHorizontal size={16} /></button>
          </div>
        </div>
      </header>

      <main id="top" className="relative mx-auto w-full max-w-[1500px] px-4 pb-8 pt-5 sm:px-6 lg:px-8 lg:pt-7">
        <section className="hero-row">
          <div>
            <div className="eyebrow flex items-center gap-2"><span className="hero-kicker-line" /> ROOM CONTROL / 01</div>
            <h1 className="hero-title">Two speakers.<br className="sm:hidden" /> One <span>room.</span></h1>
            <p className="mt-2 max-w-xl text-xs leading-relaxed text-zinc-500 sm:text-sm">Synchronize Bluetooth speaker timing, level, and room response from a local control surface.</p>
          </div>
          <div className="hero-readout">
            <div className="hero-readout-icon"><Clock3 size={16} /></div>
            <div><p className="eyebrow">Timing residual</p><p className="font-mono text-xl tabular-nums text-zinc-100">{engine.residualMs >= 0 ? '+' : ''}{engine.residualMs.toFixed(1)}<span className="ml-1 text-xs text-zinc-500">ms</span></p></div>
            <div className={`lock-state lock-state-${engine.lock}`}><span />{stabilityLabel}</div>
          </div>
        </section>

        <section className="control-strip" aria-label="Listening profile controls">
          <div className="flex min-w-0 items-center gap-2">
            <span className="control-strip-label"><Waves size={13} /> LISTENING MODE</span>
            <div className="mode-tabs" role="tablist" aria-label="Listening mode">
              {MODE_LIST.map((entry) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={engine.mode === entry.id}
                  className={`mode-tab ${engine.mode === entry.id ? 'mode-tab-active' : ''}`}
                  key={entry.id}
                  onClick={() => engine.setMode(entry.id)}
                >{entry.label}</button>
              ))}
            </div>
          </div>
          <div className="trim-control" role="group" aria-label="Manual timing trim">
            <span className="control-strip-label"><Headphones size={13} /> MANUAL TRIM</span>
            <button type="button" className="trim-step-button" onClick={() => commitTrim(trimDraftRef.current - 1)} aria-label="Decrease manual trim by 1 millisecond">−</button>
            <input
              type="range"
              min={-40}
              max={40}
              step={0.1}
              value={trimDraft}
              aria-label="Manual timing trim"
              style={{ '--range-progress': `${((trimDraft + 40) / 80) * 100}%` } as CSSProperties}
              onChange={(event) => stageTrim(Number(event.currentTarget.value))}
              onPointerDown={() => {
                trimPointerActive.current = true
                if (trimCommitTimer.current !== undefined) window.clearTimeout(trimCommitTimer.current)
              }}
              onPointerUp={() => { trimPointerActive.current = false; commitTrim() }}
              onPointerCancel={() => { trimPointerActive.current = false; commitTrim() }}
              onLostPointerCapture={() => {
                if (trimPointerActive.current) { trimPointerActive.current = false; commitTrim() }
              }}
              onKeyUp={() => commitTrim()}
              onBlur={() => { if (trimCommitTimer.current !== undefined) commitTrim() }}
            />
            <button type="button" className="trim-step-button" onClick={() => commitTrim(trimDraftRef.current + 1)} aria-label="Increase manual trim by 1 millisecond">+</button>
            <button type="button" className="trim-reset-button" onClick={() => commitTrim(0)} aria-label="Reset manual trim to zero">
              {trimDraft > 0 ? '+' : ''}{trimDraft.toFixed(1)} <span>ms</span><b>RESET</b>
            </button>
          </div>
        </section>

        <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_350px]">
          <div className="min-w-0 space-y-4">
            <div className="grid items-stretch gap-4 2xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,0.85fr)]">
              <ResidualTimingChart samples={engine.timingHistory} residualMs={engine.residualMs} />
              <RoomStage devices={engine.devices} residualMs={engine.residualMs} audioAudition={engine.audioAudition} />
            </div>
            <DeviceCards
              devices={engine.devices}
              eqDb={engine.eqDb}
              setGain={engine.setGain}
              setEqBand={engine.setEqBand}
              setDeviceConnected={engine.setDeviceConnected}
            />
          </div>
          <aside className="min-w-0">
            <BridgeAndRoutingPanel
              state={engine}
              actions={{ reconnect: engine.reconnect, setAutopilot: engine.setAutopilot, setAudioAudition: engine.setAudioAudition, startCalibration: engine.startCalibration }}
            />
          </aside>
        </div>

        <footer className="mt-7 flex flex-col gap-2 border-t border-white/[0.06] pt-4 text-[9px] uppercase tracking-[0.15em] text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
          <span>LOCAL FIRST <i className="mx-1.5 text-zinc-700">/</i> CONTROL LOOP {engine.running ? '20 HZ ACTIVE' : 'PAUSED'}</span>
          <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={11} className="text-lime-500/70" /> {mode.label} profile <i className="mx-1 text-zinc-700">·</i> {BASE_LATENCY_DELTA_MS} ms base differential</span>
        </footer>
      </main>

      <CalibrationModal
        calibration={engine.calibration}
        connection={engine.connection}
        devices={engine.devices}
        actions={{ advanceCalibration: engine.advanceCalibration, cancelCalibration: engine.cancelCalibration }}
      />
    </div>
  )
}
