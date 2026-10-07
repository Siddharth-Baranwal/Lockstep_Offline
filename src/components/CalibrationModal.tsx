import { useEffect, useState } from 'react'
import { Activity, ArrowRight, Check, CheckCircle2, Headphones, Radio, ShieldCheck, Volume2, X } from 'lucide-react'
import { BASE_LATENCY_DELTA_MS, DEVICES } from '../lib/devices'
import type { LockstepActions, LockstepState } from '../lib/store'

interface CalibrationModalProps {
  calibration: LockstepState['calibration']
  connection: LockstepState['connection']
  devices: LockstepState['devices']
  actions: Pick<LockstepActions, 'advanceCalibration' | 'cancelCalibration'>
}

const STEPS = [
  { title: 'Carrier verification', icon: Radio },
  { title: 'Impulse delta', icon: Activity },
  { title: 'Loudness match', icon: Volume2 },
  { title: 'Commit profile', icon: ShieldCheck },
]

export function CalibrationModal({ calibration, connection, devices, actions }: CalibrationModalProps) {
  const [pending, setPending] = useState(false)
  const cancelCalibration = actions.cancelCalibration

  useEffect(() => {
    if (!calibration.open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) cancelCalibration()
    }
    window.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [calibration.open, pending, cancelCalibration])

  if (!calibration.open) return null

  async function continueCalibration(): Promise<void> {
    setPending(true)
    try {
      await actions.advanceCalibration()
    } finally {
      setPending(false)
    }
  }

  const currentStep = calibration.step
  const activeStep = STEPS[currentStep - 1]
  const Icon = activeStep.icon

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) actions.cancelCalibration() }}>
      <section className="calibration-dialog" role="dialog" aria-modal="true" aria-labelledby="calibration-title" aria-describedby="calibration-description">
        <header className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4 sm:px-6">
          <div>
            <p className="eyebrow">Guided setup · {connection === 'live' ? 'Hardware connected' : 'Simulation profile'}</p>
            <h2 id="calibration-title" className="mt-1 text-lg font-semibold tracking-tight text-zinc-100">Speaker calibration</h2>
            <p id="calibration-description" className="mt-1 text-xs text-zinc-500">Verify routes, match timing and levels, then apply the profile.</p>
          </div>
          <button type="button" className="icon-button" onClick={actions.cancelCalibration} aria-label="Close calibration" disabled={pending}><X size={16} /></button>
        </header>

        <div className="px-5 pt-5 sm:px-6">
          <ol className="grid grid-cols-4 gap-1.5" aria-label="Calibration progress">
            {STEPS.map((step, index) => {
              const number = index + 1
              const complete = calibration.complete || number < currentStep
              const active = number === currentStep && !calibration.complete
              const StepIcon = complete ? Check : step.icon
              return (
                <li className="min-w-0" key={step.title}>
                  <div className={`step-progress ${active ? 'step-progress-active' : ''} ${complete ? 'step-progress-complete' : ''}`}>
                    <StepIcon size={14} />
                    <span className="hidden truncate sm:block">{step.title}</span>
                    <span className="sm:hidden">0{number}</span>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>

        <div className="min-h-[250px] px-5 py-6 sm:px-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="calibration-icon"><Icon size={20} /></div>
            <div>
              <p className="eyebrow">Step {currentStep} of 4</p>
              <h3 className="text-sm font-semibold text-zinc-100">{activeStep.title}</h3>
            </div>
          </div>

          {currentStep === 1 && <CarrierStep devices={devices} />}
          {currentStep === 2 && <LatencyStep values={calibration.measuredLatencyMs} />}
          {currentStep === 3 && <SensitivityStep values={calibration.measuredSensitivityDb} />}
          {currentStep === 4 && <CommitStep connection={connection} complete={calibration.complete} />}

          {calibration.error && <p role="alert" className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2 text-xs text-rose-200">{calibration.error}</p>}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-white/[0.07] px-5 py-4 sm:px-6">
          <button type="button" className="button-quiet" onClick={actions.cancelCalibration} disabled={pending}>Cancel</button>
          <button type="button" className="button-primary min-w-32 justify-center" onClick={() => void continueCalibration()} disabled={pending || calibration.complete}>
            {pending ? <span className="animate-pulse">Applying…</span> : currentStep === 4 ? <><CheckCircle2 size={15} /> Commit profile</> : <>Continue <ArrowRight size={15} /></>}
          </button>
        </footer>
      </section>
    </div>
  )
}

function CarrierStep({ devices }: { devices: LockstepState['devices'] }) {
  return <div>
    <p className="mb-4 text-xs leading-relaxed text-zinc-400">Confirm the two speaker carriers are routed from the Voicemeeter virtual input on Strip[5].</p>
    <div className="grid gap-2 sm:grid-cols-2">
      <CarrierCard name="A1 · Zebronics Juke Bar" connected={devices.soundbar.connected} />
      <CarrierCard name="A2 · UBON Rockstar" connected={devices.party.connected} />
    </div>
    <div className="mt-4 flex items-start gap-2 rounded-lg border border-lime-300/10 bg-lime-300/[0.04] p-3 text-[11px] leading-relaxed text-zinc-400">
      <Headphones size={14} className="mt-0.5 shrink-0 text-lime-300" />
      Keep both Bluetooth speakers powered on and connected before continuing.
    </div>
  </div>
}

function CarrierCard({ name, connected }: { name: string; connected: boolean }) {
  return <div className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-3">
    <span className="text-xs text-zinc-300">{name}</span>
    <span className={`text-[9px] font-bold tracking-wider ${connected ? 'text-lime-300' : 'text-rose-300'}`}>{connected ? 'READY' : 'MISSING'}</span>
  </div>
}

function LatencyStep({ values }: { values: Record<'soundbar' | 'party', number> | null }) {
  const bar = values?.soundbar ?? DEVICES.soundbar.nativeLatencyMs
  const tower = values?.party ?? DEVICES.party.nativeLatencyMs
  return <div>
    <p className="mb-4 text-xs leading-relaxed text-zinc-400">Impulse arrival estimates establish the native latency difference. The slower A2 path stays at zero added delay.</p>
    <div className="grid grid-cols-[1fr_auto] gap-y-3 rounded-lg border border-white/[0.07] bg-black/20 p-4 text-xs">
      <span className="text-zinc-400">{DEVICES.soundbar.shortName} · A1</span><strong className="font-mono font-medium text-zinc-200">{bar.toFixed(1)} ms</strong>
      <span className="text-zinc-400">{DEVICES.party.shortName} · A2</span><strong className="font-mono font-medium text-zinc-200">{tower.toFixed(1)} ms</strong>
      <span className="border-t border-white/[0.07] pt-3 text-zinc-300">Differential compensation</span><strong className="border-t border-white/[0.07] pt-3 font-mono text-lime-300">{(tower - bar).toFixed(1)} ms</strong>
    </div>
    <p className="mt-3 text-[10px] text-zinc-600">PRD reference differential: {BASE_LATENCY_DELTA_MS} ms. Calibration values are profile estimates.</p>
  </div>
}

function SensitivityStep({ values }: { values: Record<'soundbar' | 'party', number> | null }) {
  const bar = values?.soundbar ?? DEVICES.soundbar.sensitivityDb
  const tower = values?.party ?? DEVICES.party.sensitivityDb
  return <div>
    <p className="mb-4 text-xs leading-relaxed text-zinc-400">The profile matches relative output using the measured speaker sensitivities and the Seamless gain targets.</p>
    <div className="grid grid-cols-2 gap-2">
      <SensitivityCard title={DEVICES.soundbar.shortName} sensitivity={bar} gain={-bar} />
      <SensitivityCard title={DEVICES.party.shortName} sensitivity={tower} gain={-tower} />
    </div>
    <p className="mt-3 text-[10px] leading-relaxed text-zinc-600">The bridge reports output levels when available. These sensitivity figures are the PRD's starting calibration profile.</p>
  </div>
}

function SensitivityCard({ title, sensitivity, gain }: { title: string; sensitivity: number; gain: number }) {
  return <div className="rounded-lg border border-white/[0.07] bg-black/20 p-3">
    <p className="truncate text-[10px] text-zinc-500">{title}</p>
    <p className="mt-2 font-mono text-sm text-zinc-200">{sensitivity > 0 ? '+' : ''}{sensitivity.toFixed(1)} dBFS</p>
    <p className="mt-1 text-[10px] text-lime-300">Target gain {gain >= 0 ? '+' : ''}{gain.toFixed(1)} dB</p>
  </div>
}

function CommitStep({ connection, complete }: { connection: LockstepState['connection']; complete: boolean }) {
  return <div>
    <p className="mb-4 text-xs leading-relaxed text-zinc-400">Apply the aligned Seamless profile and enable the 20 Hz autopilot control loop.</p>
    <div className="rounded-lg border border-white/[0.07] bg-black/20 p-4">
      <div className="grid grid-cols-[1fr_auto] gap-y-3 text-xs">
        <span className="text-zinc-400">A1 added delay</span><strong className="font-mono font-medium text-zinc-200">{BASE_LATENCY_DELTA_MS} ms</strong>
        <span className="text-zinc-400">A1 output gain</span><strong className="font-mono font-medium text-zinc-200">+1.8 dB</strong>
        <span className="text-zinc-400">A2 output gain</span><strong className="font-mono font-medium text-zinc-200">−2.4 dB</strong>
        <span className="text-zinc-400">Control loop</span><strong className="font-mono font-medium text-zinc-200">20 Hz</strong>
      </div>
    </div>
    {complete && <p className="mt-3 flex items-center gap-2 text-xs text-lime-300"><CheckCircle2 size={15} /> Profile committed successfully.</p>}
    {connection !== 'live' && <p className="mt-3 text-[10px] leading-relaxed text-amber-200/80">Bridge is simulated. The profile will be committed to the offline control state.</p>}
  </div>
}
