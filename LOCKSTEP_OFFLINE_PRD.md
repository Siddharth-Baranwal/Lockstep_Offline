# Lockstep Offline — Master Technical Specification & Architecture Blueprint

# Dual Bluetooth Voicemeeter Potato Autopilot

> **Purpose:** This document is the authoritative technical blueprint for recreating **Lockstep Offline** locally. It contains all exact mathematical algorithms, Win32 P/Invoke signatures, Web Audio graphs, TypeScript schemas, and component contracts.

---

## 1. Executive Summary & Offline Topology

Lockstep Offline synchronizes two physical Bluetooth speakers in the same room via **VB-Audio Voicemeeter Potato (Kind 3)**:

- **Bus A1 (Bus[0])**: Zebronics Juke Bar 200 A (50W, ~148 ms native latency, -1.8 dBFS sensitivity).
- **Bus A2 (Bus[1])**: UBON Rockstar SP-29 (30W, ~196 ms native latency, +2.4 dBFS sensitivity).

### Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                   LOCAL BROWSER (PORT 5173 / 3000)                │
│  - React 19 + TypeScript + Vite + Tailwind CSS v4                │
│  - Web Audio API Room Acoustic Audition Simulator (audioSim.ts)  │
│  - Recharts 60s Rolling Stability Monitor (ResidualTimingChart)   │
│  - Virtual 20 Hz Autopilot Control Loop (when offline/simulated) │
└────────────────────────▲─────────────────────────┬───────────────┘
                         │ GET / (JSON telemetry)  │ POST /cmd (Script)
                         │ HTTP 127.0.0.1:4780     │ HTTP 127.0.0.1:4780
┌────────────────────────┴─────────────────────────▼───────────────┐
│        WINDOWS ZERO-DEPENDENCY NATIVE BRIDGE (Lockstep-Bridge.bat)│
│  - Built-in PowerShell + in-memory C# P/Invoke via Add-Type      │
│  - Binds: VoicemeeterRemote64.dll                                │
│  - Embedded HttpListener with CORS on http://127.0.0.1:4780/     │
└──────────────────────────────────┬───────────────────────────────┘
                                   │ VBVMR API calls
┌──────────────────────────────────▼───────────────────────────────┐
│        LOCAL VOICEMEETER POTATO (Kind 3, 64-bit)                 │
│  - Strip[5]: Virtual Input (VAIO - System / Spotify / YouTube)   │
│  - Bus[0] (A1): Zebronics Juke Bar (Option.delay[0] = 48 ms)     │
│  - Bus[1] (A2): UBON Rockstar SP-29 (Option.delay[1] = 0 ms)     │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Audio Physics, Algorithms & Mathematical Specifications

### 2.1 Hardware Bus Constants

```typescript
export const DEVICES = {
  soundbar: {
    id: 'soundbar',
    name: 'Zebronics Juke Bar 200 A',
    shortName: 'Zebronics Juke Bar',
    busName: 'A1 · Bus[0]',
    busIndex: 0,
    delayIndex: 0,
    nativeLatencyMs: 148.0,
    jitterMs: 6.0,
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
    nativeLatencyMs: 196.0,
    jitterMs: 14.0,
    clockPpm: 38,
    sensitivityDb: 2.4,
  },
};
```

### 2.2 Slew Rate & Delay Math

- **Base Differential:**
  $$\Delta L = \text{Latency}_{\text{Tower}} - \text{Latency}_{\text{Bar}} = 196.0 - 148.0 = 48.0\text{ ms}$$
- **Target Delay Formula (Bus A1):**
  $$\text{TargetDelay}_{\text{Bar}} = \text{clamp}(\Delta L + \text{DelayBias}_{\text{Mode}} + \text{ManualTrim},\; 0,\; 500\text{ ms})$$
- **Slew Rate Limiting (Prevent Slap / Pitch Wobble):**
  When outside deadband ($> 5.0\text{ ms}$), delay is slewed at maximum $1.35\text{ ms}$ per step ($20\text{ Hz}$ control loop = $\approx 27\text{ ms/s}$):
  $$\text{NextDelay} = \text{CurrentDelay} + \text{sign}(\text{diff}) \times \min(|\text{diff}|,\; 1.35)$$
- **Target Gain Formula (Bus A1 & A2):**
  $$\text{TargetGain}_{\text{Bar}} = \text{clamp}(-\text{Sensitivity}_{\text{Bar}} + \text{GainBias}_{\text{Mode}},\; -60.0,\; +12.0\text{ dB}) = +1.8\text{ dB}$$
  $$\text{TargetGain}_{\text{Tower}} = \text{clamp}(-\text{Sensitivity}_{\text{Tower}} + \text{GainBias}_{\text{Mode}},\; -60.0,\; +12.0\text{ dB}) = -2.4\text{ dB}$$
- **Coherence Metric:**
  $$\text{Coherence} = \exp\left(-\frac{|\text{Residual}|}{28.0}\right) - \text{JitterPenalty}$$

### 2.3 The 5 Listening Modes

```typescript
export const MODES = {
  seamless: {
    id: 'seamless',
    label: 'Seamless',
    lead: 'soundbar',
    delayBiasMs: 0,
    gainBiasDb: { soundbar: 0.0, party: 0.0 },
    eqDb: { soundbar: [-2.5, 1.2, 1.8], party: [2.2, -1.0, -2.4] },
    mono: true,
  },
  cinema: {
    id: 'cinema',
    label: 'Cinema',
    lead: 'soundbar',
    delayBiasMs: -4,
    gainBiasDb: { soundbar: 1.2, party: -3.5 },
    eqDb: { soundbar: [-4.0, 2.4, 1.5], party: [5.5, -8.5, -10.5] },
    mono: false,
  },
  party: {
    id: 'party',
    label: 'Party',
    lead: 'soundbar',
    delayBiasMs: 0,
    gainBiasDb: { soundbar: -2.8, party: 1.6 },
    eqDb: { soundbar: [-5.0, 0.5, 3.2], party: [3.8, 0.4, -1.2] },
    mono: true,
  },
  karaoke: {
    id: 'karaoke',
    label: 'Karaoke',
    lead: 'party',
    delayBiasMs: 4,
    gainBiasDb: { soundbar: -1.5, party: 0.8 },
    eqDb: { soundbar: [-3.0, 1.8, 2.0], party: [1.2, 1.5, 0.4] },
    mono: true,
  },
  night: {
    id: 'night',
    label: 'Night',
    lead: 'soundbar',
    delayBiasMs: 0,
    gainBiasDb: { soundbar: -6.0, party: -8.0 },
    eqDb: { soundbar: [-6.0, 0.8, 0.4], party: [-5.0, -1.0, -2.0] },
    mono: true,
  },
};
```

---

## 3. Voicemeeter Potato Remote Command Builder

Potato parameters must be formatted as semicolon-delimited ASCII strings sent to `VBVMR_SetParameters()`:

```typescript
export function buildSetParametersScript(params: {
  stripIndex: number;
  stripA1: boolean;
  stripA2: boolean;
  delayBarMs: number;
  delayTowerMs: number;
  gainBarDb: number;
  gainTowerDb: number;
  eqBarDb: [number, number, number];
  eqTowerDb: [number, number, number];
  mono?: boolean;
}): string {
  const parts = [
    `Strip[${params.stripIndex}].A1=${params.stripA1 ? 1 : 0}`,
    `Strip[${params.stripIndex}].A2=${params.stripA2 ? 1 : 0}`,
    `Option.delay[0]=${Math.round(params.delayBarMs)}`,
    `Option.delay[1]=${Math.round(params.delayTowerMs)}`,
    `Bus[0].Gain=${params.gainBarDb.toFixed(1)}`,
    `Bus[1].Gain=${params.gainTowerDb.toFixed(1)}`,
    `Bus[0].EQ.cell[0].gain=${params.eqBarDb[0].toFixed(1)}`,
    `Bus[0].EQ.cell[1].gain=${params.eqBarDb[1].toFixed(1)}`,
    `Bus[0].EQ.cell[2].gain=${params.eqBarDb[2].toFixed(1)}`,
    `Bus[1].EQ.cell[0].gain=${params.eqTowerDb[0].toFixed(1)}`,
    `Bus[1].EQ.cell[1].gain=${params.eqTowerDb[1].toFixed(1)}`,
    `Bus[1].EQ.cell[2].gain=${params.eqTowerDb[2].toFixed(1)}`,
  ];
  if (typeof params.mono === 'boolean') {
    parts.push(`Strip[${params.stripIndex}].Mono=${params.mono ? 1 : 0}`);
  }
  return parts.join('; ') + ';';
}
```

---

## 4. Native Windows Bridge Specification (`Lockstep-Bridge.bat`)

Because modern browsers prohibit direct Win32 DLL loading, `Lockstep-Bridge.bat` runs a lightweight, in-memory C# P/Invoke bridge via Windows PowerShell that opens a local HTTP server on port 4780.

### 4.1 C# P/Invoke Class Definition

```csharp
using System;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;

public class LockstepBridgeEngine {
    [DllImport("VoicemeeterRemote64.dll", EntryPoint = "VBVMR_Login")]
    public static extern int Login();

    [DllImport("VoicemeeterRemote64.dll", EntryPoint = "VBVMR_Logout")]
    public static extern int Logout();

    [DllImport("VoicemeeterRemote64.dll", EntryPoint = "VBVMR_GetVoicemeeterType")]
    public static extern int GetVoicemeeterType(out int pType);

    [DllImport("VoicemeeterRemote64.dll", EntryPoint = "VBVMR_IsParametersDirty")]
    public static extern int IsParametersDirty();

    [DllImport("VoicemeeterRemote64.dll", EntryPoint = "VBVMR_GetParameterFloat", CharSet = CharSet.Ansi)]
    public static extern int GetParameterFloat(string szParamName, out float pValue);

    [DllImport("VoicemeeterRemote64.dll", EntryPoint = "VBVMR_SetParameters", CharSet = CharSet.Ansi)]
    public static extern int SetParameters(string szParamScript);

    [DllImport("VoicemeeterRemote64.dll", EntryPoint = "VBVMR_GetLevel")]
    public static extern int GetLevel(int nType, int nuChannel, out float pValue);
}
```

### 4.2 In-Memory HTTP Listener

- **Port:** `127.0.0.1:4780`
- **CORS Headers:** `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, POST, OPTIONS`
- **GET / State Payload:**

  ```json
  {
    "t": "state",
    "conn": "live",
    "autopilot": true,
    "mode": "seamless",
    "lock": "locked",
    "residualMs": 2.1,
    "coherence": 0.92,
    "devices": {
      "soundbar": { "rmsDb": -14.2, "delayMs": 48.0, "gainDb": 1.8, "connected": true },
      "party": { "rmsDb": -16.0, "delayMs": 0.0, "gainDb": -2.4, "connected": true }
    }
  }
  ```

- **POST /cmd Payload:** Parses `{ "script": "Option.delay[0]=48; Bus[0].Gain=1.8;" }` and calls `VBVMR_SetParameters()`.

---

## 5. Web Audio API Room Acoustic Simulator (`audioSim.ts`)

Allows complete offline testing of Haas alignment in browser headphones without needing physical hardware:

```typescript
export class RoomAudioSimulator {
  private ctx: AudioContext | null = null;
  private barDelayNode: DelayNode | null = null;
  private towerDelayNode: DelayNode | null = null;
  private barGainNode: GainNode | null = null;
  private towerGainNode: GainNode | null = null;
  public active = false;

  start(params: {
    delayBarMs: number;
    delayTowerMs: number;
    gainBarDb: number;
    gainTowerDb: number;
    towerConnected: boolean;
    barConnected: boolean;
  }) {
    if (this.ctx) this.stop();
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AudioContextClass();

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, this.ctx.currentTime);

    this.barDelayNode = this.ctx.createDelay(1.0);
    this.towerDelayNode = this.ctx.createDelay(1.0);
    this.barGainNode = this.ctx.createGain();
    this.towerGainNode = this.ctx.createGain();

    this.updateParameters(params);

    osc.connect(this.barDelayNode);
    osc.connect(this.towerDelayNode);
    this.barDelayNode.connect(this.barGainNode).connect(this.ctx.destination);
    this.towerDelayNode.connect(this.towerGainNode).connect(this.ctx.destination);

    osc.start();
    this.active = true;
  }

  updateParameters(params: {
    delayBarMs: number;
    delayTowerMs: number;
    gainBarDb: number;
    gainTowerDb: number;
    towerConnected: boolean;
    barConnected: boolean;
  }) {
    if (!this.ctx || !this.barDelayNode || !this.towerDelayNode) return;
    const now = this.ctx.currentTime;
    this.barDelayNode.delayTime.setValueAtTime((148 + params.delayBarMs) / 1000, now);
    this.towerDelayNode.delayTime.setValueAtTime((196 + params.delayTowerMs) / 1000, now);

    if (this.barGainNode) {
      const gBar = params.barConnected ? Math.pow(10, params.gainBarDb / 20) * 0.4 : 0;
      this.barGainNode.gain.setValueAtTime(gBar, now);
    }
    if (this.towerGainNode) {
      const gTow = params.towerConnected ? Math.pow(10, params.gainTowerDb / 20) * 0.4 : 0;
      this.towerGainNode.gain.setValueAtTime(gTow, now);
    }
  }

  stop() {
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
    this.active = false;
  }
}

export const roomAudioSim = new RoomAudioSimulator();
```

---

## 6. Recharts 60s Real-Time Stability Chart (`ResidualTimingChart.tsx`)

Maintains a 60-second sliding buffer updated every 1.0 second:

- **Reference Lines:**
  - `0 ms`: Center exact lockline (dashed `#7D8792`)
  - `+8 ms`: Target bias reference (`#8FA396`)
  - `±12 ms`: Haas precedence window limits (dashed amber `#D4A359`)
- **Key Metrics Strip:** Current Error, 60s Mean Error, 60s Peak Abs Drift, Haas Window Stability %.
- **Performance:** `isAnimationActive={false}` prevents animation overhead during 1 Hz real-time ticks.

---

## 7. Interactive 4-Step Calibration State Machine

1. **Step 1 (Carrier Verification):** Verifies Strip[5] routing and carriers on both A1 and A2.
2. **Step 2 (GetLevel Impulse Delta):** Measures arrival latency (Zebronics = 148 ms, UBON = 196 ms, $\Delta = 48\text{ ms}$).
3. **Step 3 (Broadband Loudness Match):** Measures K-weighted RMS sensitivity (-1.8 dBFS vs +2.4 dBFS).
4. **Step 4 (Commit Profile):** Applies `Option.delay[0] = 48`, `Bus[0].Gain = +1.8`, `Bus[1].Gain = -2.4`, activates autopilot.

---

## 8. Step-by-Step Prompts to Build the Project (Credit Optimized)

To prevent Copilot context overflow, build the app in **3 targeted steps**:

### 🎯 Step 1 Prompt: Scaffolding & Audio Engine

```text
Read the attached PRD.md. Implement Phase 1:
1. `package.json`, `tsconfig.json`, `vite.config.ts`, and `index.html`.
2. `src/index.css` (Tailwind CSS v4 with custom range slider styling).
3. `src/lib/devices.ts` containing the hardware specifications, 5 listening modes, clamp utilities, and the Voicemeeter Potato command string builder.
4. `src/lib/audioSim.ts` containing the RoomAudioSimulator Web Audio API class.
```

### 🎯 Step 2 Prompt: Bridge Installer & State Engine

```text
Read the attached PRD.md. Implement Phase 2:
1. `src/lib/bridgeInstaller.ts` implementing downloadBridgeFile and generating the complete Lockstep-Bridge.bat file with C# P/Invoke.
2. `src/lib/store.ts` implementing useLockstepEngine with the 20 Hz simulation control loop, localhost bridge polling at 127.0.0.1:4780, and the 4-step calibration wizard.
```

### 🎯 Step 3 Prompt: UI Components & Dashboard

```text
Read the attached PRD.md. Implement Phase 3:
1. `src/components/ResidualTimingChart.tsx` (Recharts 60s real-time line chart).
2. `src/components/RoomStage.tsx` (2D top-down SVG room diagram with animated wavefronts).
3. `src/components/DeviceCards.tsx` (Hardware bus cards with level meters, faders, and 3-band EQ).
4. `src/components/BridgeAndRoutingPanel.tsx` (Diagnostic panel with batch bridge download and command log).
5. `src/components/CalibrationModal.tsx` (4-step calibration wizard).
6. `src/App.tsx` and `src/main.tsx` connecting all components into the dark industrial console.
```
