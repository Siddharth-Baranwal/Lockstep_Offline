import { Headphones, Radio, Speaker } from 'lucide-react'
import { DEVICES, type DeviceId } from '../lib/devices'
import type { DeviceTelemetry } from '../lib/store'

interface RoomStageProps {
  devices: Record<DeviceId, DeviceTelemetry>
  residualMs: number
  audioAudition: boolean
}

const SAGE = '#8FA396'
const AMBER = '#D4A359'

/** Detailed room view with stylized hardware and animated arrival wavefronts. */
export function RoomStage({ devices, residualMs, audioAudition }: RoomStageProps) {
  const soundbar = devices.soundbar
  const party = devices.party
  const locked = Math.abs(residualMs) < 12 && soundbar.connected && party.connected
  const waveColor = locked ? SAGE : AMBER
  const phaseLabel = locked ? 'LOCKED' : 'ALIGNING'

  return (
    <section className="panel overflow-hidden" aria-labelledby="room-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Acoustic preview</p>
          <h2 id="room-title" className="panel-title">Room stage</h2>
        </div>
        <span className={`status-pill ${audioAudition ? 'status-pill-live' : ''}`}>
          <span className="status-dot" />{audioAudition ? 'Audio audition' : 'Signal map'}
        </span>
      </div>

      <div className="room-canvas relative overflow-hidden rounded-xl border border-zinc-700/70 bg-[#101214]">
        <svg viewBox="0 0 640 320" className="block h-auto w-full" role="img" aria-labelledby="room-svg-title room-svg-desc">
          <title id="room-svg-title">Lockstep speaker timing and room arrival diagram</title>
          <desc id="room-svg-desc">A Zebronics soundbar and subwoofer on the left, a UBON tower speaker on the right, and the listening sweet spot at the center bottom. Curved paths show both arrival wavefronts.</desc>
          <defs>
            <pattern id="room-grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#24272a" strokeWidth="0.7" />
            </pattern>
            <linearGradient id="room-wash" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor={waveColor} stopOpacity="0.08" />
              <stop offset="1" stopColor={waveColor} stopOpacity="0.015" />
            </linearGradient>
            <linearGradient id="bar-metal" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#454b4c" />
              <stop offset="0.48" stopColor="#202426" />
              <stop offset="1" stopColor="#111415" />
            </linearGradient>
            <linearGradient id="tower-metal" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#151a18" />
              <stop offset="0.5" stopColor="#39413c" />
              <stop offset="1" stopColor="#171b19" />
            </linearGradient>
            <filter id="speaker-shadow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="4" />
              <feOffset dy="4" />
              <feComponentTransfer><feFuncA type="linear" slope="0.38" /></feComponentTransfer>
              <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <radialGradient id="woofer-cone">
              <stop offset="0" stopColor="#101211" />
              <stop offset="0.43" stopColor="#303633" />
              <stop offset="0.68" stopColor="#171b19" />
              <stop offset="0.84" stopColor="#69736d" />
              <stop offset="1" stopColor="#242a26" />
            </radialGradient>
            <radialGradient id="sweet-spot">
              <stop offset="0" stopColor={waveColor} stopOpacity="0.18" />
              <stop offset="1" stopColor={waveColor} stopOpacity="0" />
            </radialGradient>
          </defs>

          <rect x="12" y="12" width="616" height="296" rx="14" fill="url(#room-grid)" stroke="#393d3f" />
          <rect x="13" y="13" width="614" height="294" rx="13" fill="url(#room-wash)" />
          <text x="320" y="37" textAnchor="middle" className="room-svg-label" fill={waveColor}>ACOUSTIC ARRIVAL DELTA</text>
          <text x="320" y="59" textAnchor="middle" className="room-svg-readout" fill={waveColor}>{residualMs >= 0 ? '+' : ''}{residualMs.toFixed(1)} ms · {phaseLabel}</text>

          {/* Soundbar wavefront paths curve down toward the listening sweet spot. */}
          <g fill="none" stroke={waveColor} strokeWidth="1.8" strokeLinecap="round" className={locked ? 'propagation-locked' : 'propagation-aligning'}>
            <path d="M205 135 C238 133 268 157 300 220" />
            <path d="M205 148 C244 148 271 172 303 220" />
            <path d="M205 161 C241 162 270 187 306 220" />
            <path d="M435 135 C402 133 372 157 340 220" />
            <path d="M435 148 C396 148 369 172 337 220" />
            <path d="M435 161 C399 162 370 187 334 220" />
          </g>
          <g fill={waveColor} className="travel-pulse" filter="url(#speaker-shadow)">
            <circle r="2.5"><animateMotion dur="1.8s" repeatCount="indefinite" path="M205 148 C244 148 271 172 303 220" /></circle>
            <circle r="2.5"><animateMotion dur="1.8s" begin="0.6s" repeatCount="indefinite" path="M205 148 C244 148 271 172 303 220" /></circle>
            <circle r="2.5"><animateMotion dur="1.8s" begin="0.9s" repeatCount="indefinite" path="M435 148 C396 148 369 172 337 220" /></circle>
            <circle r="2.5"><animateMotion dur="1.8s" begin="1.5s" repeatCount="indefinite" path="M435 148 C396 148 369 172 337 220" /></circle>
          </g>

          {/* A1 Zebronics Juke Bar chassis: long three-cone enclosure and subwoofer. */}
          <g filter="url(#speaker-shadow)" className={soundbar.connected ? '' : 'hardware-muted'}>
            <rect x="38" y="126" width="130" height="42" rx="9" fill="url(#bar-metal)" stroke="#87908b" strokeOpacity="0.55" />
            <path d="M48 132h110" stroke="#bbc2bd" strokeOpacity="0.24" />
            <rect x="45" y="134" width="116" height="26" rx="5" fill="#101312" stroke="#68716b" strokeOpacity="0.6" />
            <circle cx="66" cy="147" r="10" fill="url(#woofer-cone)" stroke="#87908b" strokeOpacity="0.8" />
            <circle cx="102" cy="147" r="10" fill="url(#woofer-cone)" stroke="#87908b" strokeOpacity="0.8" />
            <circle cx="138" cy="147" r="10" fill="url(#woofer-cone)" stroke="#87908b" strokeOpacity="0.8" />
            <circle cx="66" cy="147" r="2.2" fill="#aab2ac" fillOpacity="0.7" />
            <circle cx="102" cy="147" r="2.2" fill="#aab2ac" fillOpacity="0.7" />
            <circle cx="138" cy="147" r="2.2" fill="#aab2ac" fillOpacity="0.7" />
            <path d="M53 173h99" stroke="#8FA396" strokeOpacity="0.7" strokeWidth="1.4" strokeLinecap="round" />

            <rect x="174" y="116" width="34" height="64" rx="7" fill="url(#bar-metal)" stroke="#78817b" strokeOpacity="0.65" />
            <path d="M180 121h22" stroke="#c2c8c3" strokeOpacity="0.18" />
            <circle cx="191" cy="148" r="12" fill="url(#woofer-cone)" stroke="#89928c" strokeOpacity="0.85" />
            <circle cx="191" cy="148" r="3" fill="#aab2ac" fillOpacity="0.75" />
            <rect x="187" y="168" width="8" height="3" rx="1.5" fill="#101312" stroke="#6f7872" strokeWidth="0.6" />
          </g>

          {/* A2 UBON Rockstar tower with handle and dual stacked woofers. */}
          <g filter="url(#speaker-shadow)" className={party.connected ? '' : 'hardware-muted'}>
            <path d="M461 116v-6c0-8 6-13 13-13h10c7 0 13 5 13 13v6" fill="none" stroke="#99a69d" strokeWidth="4" strokeLinecap="round" />
            <rect x="450" y="111" width="58" height="91" rx="13" fill="url(#tower-metal)" stroke="#89958d" strokeOpacity="0.7" />
            <rect x="456" y="117" width="46" height="79" rx="10" fill="#121614" stroke="#b0bbb3" strokeOpacity="0.2" />
            <circle cx="479" cy="139" r="15" fill="url(#woofer-cone)" stroke="#8FA396" strokeWidth="1.5" />
            <circle cx="479" cy="139" r="4" fill="#aab7ae" fillOpacity="0.75" />
            <circle cx="479" cy="174" r="15" fill="url(#woofer-cone)" stroke="#8FA396" strokeWidth="1.5" />
            <circle cx="479" cy="174" r="4" fill="#aab7ae" fillOpacity="0.75" />
            <path d="M463 203h32" stroke="#8FA396" strokeOpacity="0.75" strokeWidth="1.5" strokeLinecap="round" />
          </g>

          {/* Couch silhouette and seated listener mark the acoustic sweet spot. */}
          <ellipse cx="320" cy="246" rx="65" ry="39" fill="url(#sweet-spot)" />
          <g filter="url(#speaker-shadow)">
            <rect x="270" y="238" width="100" height="32" rx="10" fill="#242a27" stroke="#718078" strokeOpacity="0.7" />
            <rect x="278" y="233" width="84" height="21" rx="8" fill="#303833" stroke="#8FA396" strokeOpacity="0.65" />
            <path d="M281 250v13M359 250v13" stroke="#87948a" strokeWidth="3" strokeLinecap="round" />
            <path d="M290 255h60" stroke="#59645d" strokeWidth="1" />
            <circle cx="320" cy="214" r="8" fill="#c4c9c5" />
            <path d="M307 234c1-12 6-17 13-17s12 5 13 17" fill="#aab4ac" stroke="#d0d6d1" strokeOpacity="0.6" />
          </g>

          <text x="122" y="198" textAnchor="middle" className="room-svg-label">A1 · ZEBRONICS JUKE BAR</text>
          <text x="122" y="215" textAnchor="middle" className="room-svg-sub">BAR + COMPANION SUB · {soundbar.delayMs.toFixed(1)} ms</text>
          <text x="479" y="221" textAnchor="middle" className="room-svg-label">A2 · UBON SP-29</text>
          <text x="320" y="286" textAnchor="middle" className="room-svg-sub">LISTENING SWEET SPOT</text>
        </svg>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <SpeakerLegend device="soundbar" connected={soundbar.connected} levelDb={soundbar.rmsDb} color={SAGE} />
        <SpeakerLegend device="party" connected={party.connected} levelDb={party.rmsDb} color={waveColor} />
      </div>
    </section>
  )
}

function SpeakerLegend({ device, connected, levelDb, color }: { device: DeviceId; connected: boolean; levelDb: number; color: string }) {
  const profile = DEVICES[device]
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
      {device === 'soundbar' ? <Speaker size={15} className="shrink-0" style={{ color }} /> : <Radio size={15} className="shrink-0" style={{ color }} />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[10px] font-semibold text-zinc-300">{profile.shortName}</p>
        <p className="font-mono text-[9px] text-zinc-500">{connected ? `${levelDb.toFixed(1)} dBFS` : 'Route muted'}</p>
      </div>
      {!connected && <Headphones size={13} className="text-zinc-600" aria-hidden="true" />}
      <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-lime-400' : 'bg-zinc-600'}`} />
    </div>
  )
}
