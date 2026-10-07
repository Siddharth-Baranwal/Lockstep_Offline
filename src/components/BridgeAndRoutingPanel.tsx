import { useEffect, useState } from 'react'
import { Activity, ArrowDownToLine, Check, Clipboard, Cpu, ExternalLink, Radio, RefreshCw, Terminal } from 'lucide-react'
import { downloadBridgeFile } from '../lib/bridgeInstaller'
import { DEVICES } from '../lib/devices'
import type { LockstepActions, LockstepState } from '../lib/store'

interface BridgeAndRoutingPanelProps {
  state: LockstepState
  actions: Pick<LockstepActions, 'reconnect' | 'setAutopilot' | 'setAudioAudition' | 'startCalibration'>
}

export function BridgeAndRoutingPanel({ state, actions }: BridgeAndRoutingPanelProps) {
  const [log, setLog] = useState<Array<{ at: string; text: string }>>([])
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!state.lastCommand) return
    setLog((current) => {
      if (current[0]?.text === state.lastCommand) return current
      return [{ at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), text: state.lastCommand! }, ...current].slice(0, 5)
    })
  }, [state.lastCommand])

  async function copyCommand(): Promise<void> {
    if (!state.lastCommand || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(state.lastCommand)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  const bridgeTone = state.connection === 'live' ? 'text-lime-300' : state.connection === 'connecting' ? 'text-amber-300' : 'text-zinc-400'
  const bridgeLabel = state.connection === 'live' ? 'Bridge connected' : state.connection === 'connecting' ? 'Checking bridge' : 'Simulation mode'

  return (
    <section className="panel" aria-labelledby="bridge-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Local diagnostics</p>
          <h2 id="bridge-title" className="panel-title">Bridge & routing</h2>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider ${bridgeTone}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${state.connection === 'live' ? 'bg-lime-400 shadow-[0_0_8px_#a3e635]' : state.connection === 'connecting' ? 'animate-pulse bg-amber-400' : 'bg-zinc-500'}`} />
          {bridgeLabel}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Diagnostic label="Endpoint" value="127.0.0.1:4780" mono />
        <Diagnostic label="Voicemeeter" value={state.connection === 'live' ? 'Potato · Kind 3' : 'Not detected'} />
      </div>

      <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/20 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="eyebrow inline-flex items-center gap-1.5"><Radio size={12} /> Input routing</span>
          <span className="font-mono text-[9px] text-zinc-600">STRIP[5]</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <RouteStatus label="A1 · Zebronics" enabled={state.devices.soundbar.connected} />
          <RouteStatus label="A2 · UBON" enabled={state.devices.party.connected} />
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-white/[0.06] pt-2 text-[10px] text-zinc-500">
          <span>Last state poll</span>
          <span className="font-mono">{state.lastBridgePollAt ? new Date(state.lastBridgePollAt).toLocaleTimeString() : 'Waiting…'}</span>
        </div>
      </div>

      {state.commandError && (
        <p role="status" className="mt-3 rounded-md border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">{state.commandError}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="button-primary flex-1" onClick={downloadBridgeFile}>
          <ArrowDownToLine size={14} /> Download bridge
        </button>
        <button type="button" className="button-secondary" onClick={actions.reconnect} title="Retry connection to the local bridge">
          <RefreshCw size={14} /><span className="sr-only">Retry bridge connection</span>
        </button>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">Run the downloaded batch file on this PC, then reconnect to Voicemeeter Potato.</p>

      <div className="mt-4 border-t border-white/[0.06] pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="eyebrow inline-flex items-center gap-1.5"><Terminal size={12} /> Command log</span>
          {state.lastCommand && <button type="button" className="inline-flex items-center gap-1 text-[9px] text-zinc-500 hover:text-zinc-200" onClick={() => void copyCommand()}>{copied ? <Check size={11} /> : <Clipboard size={11} />}{copied ? 'Copied' : 'Copy latest'}</button>}
        </div>
        <div className="command-log" aria-live="polite">
          {log.length ? log.map((entry) => (
            <div className="command-entry" key={`${entry.at}-${entry.text.slice(0, 18)}`}>
              <span className="shrink-0 text-zinc-600">{entry.at}</span>
              <code>{entry.text}</code>
            </div>
          )) : <p className="px-2 py-4 text-center text-[10px] text-zinc-600">No commands sent this session.</p>}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <button type="button" className={`utility-toggle ${state.autopilot ? 'utility-toggle-active' : ''}`} onClick={() => actions.setAutopilot(!state.autopilot)} aria-pressed={state.autopilot}>
          <Activity size={13} /><span>Autopilot</span><b>{state.autopilot ? 'ON' : 'OFF'}</b>
        </button>
        <button type="button" className={`utility-toggle ${state.audioAudition ? 'utility-toggle-active' : ''}`} onClick={() => actions.setAudioAudition(!state.audioAudition)} aria-pressed={state.audioAudition}>
          <Cpu size={13} /><span>Audition</span><b>{state.audioAudition ? 'ON' : 'OFF'}</b>
        </button>
        <button type="button" className="utility-toggle" onClick={actions.startCalibration}>
          <ExternalLink size={13} /><span>Calibrate</span><b>4 STEP</b>
        </button>
      </div>
      <p className="mt-3 text-[9px] leading-relaxed text-zinc-600">Hardware: {DEVICES.soundbar.shortName} · {DEVICES.party.shortName}</p>
    </section>
  )
}

function Diagnostic({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
    <p className="eyebrow !text-[9px]">{label}</p>
    <p className={`mt-1 truncate text-[11px] text-zinc-200 ${mono ? 'font-mono' : 'font-medium'}`}>{value}</p>
  </div>
}

function RouteStatus({ label, enabled }: { label: string; enabled: boolean }) {
  return <div className="flex items-center justify-between gap-1 rounded-md bg-white/[0.025] px-2 py-1.5">
    <span className="truncate text-[10px] text-zinc-400">{label}</span>
    <span className={`shrink-0 font-mono text-[9px] ${enabled ? 'text-lime-300' : 'text-zinc-600'}`}>{enabled ? 'ROUTED' : 'MUTED'}</span>
  </div>
}
