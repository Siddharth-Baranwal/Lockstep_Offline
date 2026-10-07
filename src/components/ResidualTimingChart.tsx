import { useEffect, useRef, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts'
import type { TimingSample } from '../lib/store'

interface ChartPoint {
  timestamp: number
  time: string
  residualMs: number
}

interface ResidualTimingChartProps {
  samples: readonly TimingSample[]
  residualMs: number
}

function TimingTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null
  const value = Number(payload[0]?.value ?? 0)
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-950/95 px-3 py-2 shadow-xl">
      <p className="font-mono text-sm text-lime-300">{value >= 0 ? '+' : ''}{value.toFixed(1)} ms</p>
      <p className="mt-1 text-[10px] uppercase tracking-widest text-zinc-500">Arrival delta</p>
    </div>
  )
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })
}

/** One-second snapshots of the engine feed, displayed as a rolling 60 second trace. */
export function ResidualTimingChart({ samples, residualMs }: ResidualTimingChartProps) {
  const samplesRef = useRef(samples)
  const residualRef = useRef(residualMs)
  const [points, setPoints] = useState<ChartPoint[]>([])

  samplesRef.current = samples
  residualRef.current = residualMs

  useEffect(() => {
    const takeSnapshot = () => {
      const now = Date.now()
      const source = samplesRef.current
      const latest = source[source.length - 1]
      const value = latest ? latest.residualMs : residualRef.current
      setPoints((current) => {
        const cutoff = now - 60_000
        const retained = current.filter((point) => point.timestamp >= cutoff)
        return [...retained, { timestamp: now, time: formatTime(now), residualMs: value }]
      })
    }
    takeSnapshot()
    const timer = window.setInterval(takeSnapshot, 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const visible = points.filter((point) => point.timestamp >= Date.now() - 60_000)
  const values = visible.map((point) => point.residualMs)
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : residualMs
  const peak = values.length ? Math.max(...values.map(Math.abs)) : Math.abs(residualMs)
  const insideWindow = values.length ? (values.filter((value) => Math.abs(value) <= 12).length / values.length) * 100 : 100
  const current = values.at(-1) ?? residualMs

  return (
    <section className="panel min-w-0" aria-labelledby="timing-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Alignment telemetry</p>
          <h2 id="timing-title" className="panel-title">Residual timing</h2>
        </div>
        <span className="live-tag"><span className="pulse-dot" />60 second window</span>
      </div>

      <div className="grid grid-cols-2 gap-2 border-y border-white/[0.06] py-3 md:grid-cols-4">
        <Metric label="Current error" value={`${current >= 0 ? '+' : ''}${current.toFixed(1)} ms`} accent />
        <Metric label="60s mean error" value={`${mean >= 0 ? '+' : ''}${mean.toFixed(1)} ms`} />
        <Metric label="Peak abs drift" value={`${peak.toFixed(1)} ms`} />
        <Metric label="Haas window" value={`${insideWindow.toFixed(0)}%`} />
      </div>

      <div className="mt-3 h-52 w-full" role="img" aria-label="Residual timing error over the last 60 seconds">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={visible} margin={{ top: 10, right: 10, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="#27272a" strokeDasharray="2 6" vertical={false} />
            <XAxis dataKey="time" tick={{ fill: '#71717a', fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={38} />
            <YAxis domain={[-24, 24]} ticks={[-12, 0, 12, 24]} tick={{ fill: '#71717a', fontSize: 10 }} tickLine={false} axisLine={false} />
            <Tooltip content={<TimingTooltip />} cursor={{ stroke: '#52525b', strokeDasharray: '3 4' }} />
            <ReferenceLine y={0} stroke="#7D8792" strokeDasharray="4 5" />
            <ReferenceLine y={8} stroke="#8FA396" strokeDasharray="2 5" />
            <ReferenceLine y={12} stroke="#D4A359" strokeDasharray="4 5" />
            <ReferenceLine y={-12} stroke="#D4A359" strokeDasharray="4 5" />
            <Line type="monotone" dataKey="residualMs" name="Residual" stroke="#a3e635" strokeWidth={2} dot={false} activeDot={{ r: 3, fill: '#d9f99d', stroke: '#09090b', strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        <LegendDot color="#7D8792" label="Zero lockline" />
        <LegendDot color="#8FA396" label="+8 ms target" />
        <LegendDot color="#D4A359" label="±12 ms Haas limit" />
      </div>
    </section>
  )
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="px-1 py-1">
      <p className="eyebrow !text-[9px]">{label}</p>
      <p className={`mt-1 font-mono text-base tabular-nums ${accent ? 'text-lime-300' : 'text-zinc-200'}`}>{value}</p>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><i className="h-1.5 w-3 rounded-full" style={{ backgroundColor: color }} />{label}</span>
}
