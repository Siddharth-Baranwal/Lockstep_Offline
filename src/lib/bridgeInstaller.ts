/** Utilities for saving the local Windows Voicemeeter bridge. */

export const BRIDGE_FILENAME = 'Lockstep-Bridge.bat'
export const BRIDGE_ORIGIN = 'http://127.0.0.1:4780'

/** Complete PowerShell payload run by the generated batch file. */
export const BRIDGE_POWERSHELL = String.raw`
$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.Globalization;
using System.IO;
using System.Net;
using System.ComponentModel;
using Microsoft.Win32;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class LockstepBridgeEngine {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool SetDllDirectory(string lpPathName);

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

  private static readonly object Gate = new object();
  private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;
  private static bool loggedIn = false;
  private static bool autopilot = false;
  private static bool delayControlEnabled = false;
  private static volatile bool stopping = false;
  private static string mode = "seamless";
  private static double trimMs = 0.0;
  private static double targetDelayBarMs = 48.0;
  private static int delayWriteCount = 0;

  private static double DelayBiasForMode(string modeId) {
    switch ((modeId ?? "").ToLowerInvariant()) {
      case "cinema": return -4.0;
      case "karaoke": return 4.0;
      default: return 0.0;
    }
  }
  // Keep the bridge's expected A1 delay in sync with the UI trim. Hardware
  // changes are still performed in small increments by the store's 20 Hz slew.
  private static void ApplyModeToPotato() {
    targetDelayBarMs = Math.Max(0.0, Math.Min(500.0, Math.Round(48.0 + DelayBiasForMode(mode) + trimMs)));
  }
  // This is the sole physical delay writer. Keeping the slew in the bridge
  // avoids a browser controller and a bridge watchdog pulling A1 in opposite
  // directions through Voicemeeter's output delay buffer.
  private static void DelayControlLoop() {
    while (!stopping) {
      try {
        lock (Gate) {
          if (loggedIn && delayControlEnabled) {
            float current;
            if (GetParameterFloat("Option.delay[0]", out current) == 0) {
              double difference = targetDelayBarMs - current;
              if (Math.Abs(difference) >= 0.5) {
                double next = Math.Abs(difference) <= 1.0
                  ? targetDelayBarMs
                  : current + Math.Sign(difference) * 1.0;
                int rounded = (int)Math.Round(Math.Max(0.0, Math.Min(500.0, next)));
                if (Math.Abs(rounded - Math.Round(current)) >= 1.0 && SetParameters("Option.delay[0]=" + rounded.ToString(Invariant)) == 0) {
                  delayWriteCount++;
                }
              }
            }
          }
        }
      } catch {}
      Thread.Sleep(50);
    }
  }
  private static string ExtractJsonString(string json, string key, string fallback) {
    try {
      string pattern = "\\\"" + System.Text.RegularExpressions.Regex.Escape(key) + "\\\"\\s*:\\s*\\\"([^\\\"]*)\\\"";
      System.Text.RegularExpressions.Match match = System.Text.RegularExpressions.Regex.Match(json, pattern);
      return match.Success ? match.Groups[1].Value : fallback;
    } catch { return fallback; }
  }
  private static double ExtractJsonDouble(string json, string key, double fallback) {
    try {
      string pattern = "\\\"" + System.Text.RegularExpressions.Regex.Escape(key) + "\\\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)";
      System.Text.RegularExpressions.Match match = System.Text.RegularExpressions.Regex.Match(json, pattern);
      double value;
      return match.Success && Double.TryParse(match.Groups[1].Value, NumberStyles.Float, Invariant, out value) ? value : fallback;
    } catch { return fallback; }
  }

  private static string DirectoryFromRegistry(RegistryView view) {
    try {
      using (RegistryKey baseKey = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view))
      using (RegistryKey productKey = baseKey.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\VB:Voicemeeter {17359A74-1236-5467}")) {
        if (productKey == null) return null;
        string uninstall = productKey.GetValue("UninstallString") as string;
        if (String.IsNullOrWhiteSpace(uninstall)) return null;
        string executable = uninstall.Trim();
        if (executable.StartsWith("\"", StringComparison.Ordinal)) {
          int closingQuote = executable.IndexOf('"', 1);
          if (closingQuote > 1) executable = executable.Substring(1, closingQuote - 1);
        } else {
          int exeEnd = executable.IndexOf(".exe", StringComparison.OrdinalIgnoreCase);
          if (exeEnd >= 0) executable = executable.Substring(0, exeEnd + 4);
        }
        string directory = Path.GetDirectoryName(executable);
        string dll = String.IsNullOrEmpty(directory) ? null : Path.Combine(directory, "VoicemeeterRemote64.dll");
        return dll != null && File.Exists(dll) ? directory : null;
      }
    } catch { return null; }
  }

  private static string FindVoicemeeterDirectory() {
    string fromRegistry = DirectoryFromRegistry(RegistryView.Registry32);
    if (!String.IsNullOrEmpty(fromRegistry)) return fromRegistry;
    fromRegistry = DirectoryFromRegistry(RegistryView.Registry64);
    if (!String.IsNullOrEmpty(fromRegistry)) return fromRegistry;

    string[] roots = new string[] {
      Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
      Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles)
    };
    string[] relativePaths = new string[] {
      Path.Combine("VB", "Voicemeeter"),
      Path.Combine("VB-Audio", "Voicemeeter")
    };
    foreach (string root in roots) {
      if (String.IsNullOrEmpty(root)) continue;
      foreach (string relative in relativePaths) {
        string directory = Path.Combine(root, relative);
        if (File.Exists(Path.Combine(directory, "VoicemeeterRemote64.dll"))) return directory;
      }
    }
    return null;
  }

  private static float ReadParameter(string name, float fallback) {
    float value;
    try { return GetParameterFloat(name, out value) == 0 ? value : fallback; }
    catch { return fallback; }
  }
  private static float ReadLevelDb(int channel) {
    float value;
    try {
      if (GetLevel(3, channel, out value) != 0 || value <= 0.0000316f) return -90.0f;
      return (float)(20.0 * Math.Log10(value));
    } catch { return -90.0f; }
  }
  private static string N(float value) { return value.ToString("0.0", Invariant); }
  private static string StateJson() {
    lock (Gate) {
      float barDelay = ReadParameter("Option.delay[0]", 48.0f);
      float towerDelay = ReadParameter("Option.delay[1]", 0.0f);
      float barGain = ReadParameter("Bus[0].Gain", 1.8f);
      float towerGain = ReadParameter("Bus[1].Gain", -2.4f);
      float barLevel = loggedIn ? ReadLevelDb(0) : -30.0f;
      float towerLevel = loggedIn ? ReadLevelDb(1) : -32.0f;
      float residual = (148.0f + barDelay) - (196.0f + towerDelay);
      float coherence = (float)Math.Max(0.0, Math.Min(1.0, Math.Exp(-Math.Abs(residual) / 28.0) - 0.1));
      string conn = loggedIn ? "live" : "offline";
      string lockState = Math.Abs(residual) <= 5.0f ? "locked" : "adjusting";
      return "{\"t\":\"state\",\"bridgeVersion\":3,\"conn\":\"" + conn + "\",\"autopilot\":" + (autopilot ? "true" : "false") +
        ",\"mode\":\"" + mode + "\",\"lock\":\"" + lockState + "\",\"residualMs\":" + N(residual) +
        ",\"manualTrimMs\":" + trimMs.ToString("0", Invariant) + ",\"targetDelayBarMs\":" + targetDelayBarMs.ToString("0", Invariant) +
        ",\"delayWriteCount\":" + delayWriteCount.ToString(Invariant) +
        ",\"coherence\":" + N(coherence) + ",\"devices\":{" +
        "\"soundbar\":{\"rmsDb\":" + N(barLevel) + ",\"delayMs\":" + N(barDelay) + ",\"gainDb\":" + N(barGain) + ",\"connected\":" + (loggedIn ? "true" : "false") + "}," +
        "\"party\":{\"rmsDb\":" + N(towerLevel) + ",\"delayMs\":" + N(towerDelay) + ",\"gainDb\":" + N(towerGain) + ",\"connected\":" + (loggedIn ? "true" : "false") + "}}}";
    }
  }
  private static void Reply(HttpListenerContext context, int status, string body) {
    byte[] bytes = Encoding.UTF8.GetBytes(body);
    context.Response.StatusCode = status;
    context.Response.ContentType = "application/json; charset=utf-8";
    context.Response.Headers["Access-Control-Allow-Origin"] = "*";
    context.Response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    context.Response.Headers["Access-Control-Allow-Headers"] = "Content-Type";
    context.Response.ContentLength64 = bytes.Length;
    context.Response.OutputStream.Write(bytes, 0, bytes.Length);
    context.Response.Close();
  }
  private static string ReadBody(HttpListenerRequest request) {
    using (StreamReader reader = new StreamReader(request.InputStream, request.ContentEncoding)) return reader.ReadToEnd();
  }
  public static void Run() {
    try {
      string installDirectory = FindVoicemeeterDirectory();
      if (String.IsNullOrEmpty(installDirectory)) {
        throw new FileNotFoundException("VoicemeeterRemote64.dll was not found. Install or repair Voicemeeter Potato, then run this bridge again.");
      }
      if (!SetDllDirectory(installDirectory)) {
        throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows could not add the Voicemeeter install folder to the DLL search path: " + installDirectory);
      }
      Console.WriteLine("Voicemeeter DLL found: " + Path.Combine(installDirectory, "VoicemeeterRemote64.dll"));
      ApplyModeToPotato();
      int result = Login();
      int vmType = 0;
      loggedIn = result == 0 && GetVoicemeeterType(out vmType) == 0 && vmType == 3;
      if (result == 0 && !loggedIn) { try { Logout(); } catch {} }
    } catch (Exception ex) {
      Console.WriteLine("Voicemeeter Remote API could not initialize: " + ex.Message);
      loggedIn = false;
    }

    HttpListener listener = new HttpListener();
    listener.Prefixes.Add("http://127.0.0.1:4780/");
    try {
      listener.Start();
      stopping = false;
      Thread delayController = new Thread(new ThreadStart(DelayControlLoop));
      delayController.IsBackground = true;
      delayController.Start();
      Console.WriteLine("Lockstep bridge listening at http://127.0.0.1:4780/ (Ctrl+C to stop)");
      Console.WriteLine(loggedIn ? "Connected to Voicemeeter Potato." : "Voicemeeter unavailable; state endpoint remains available.");
      while (listener.IsListening) {
        HttpListenerContext context;
        try { context = listener.GetContext(); }
        catch (HttpListenerException) { break; }
        catch (ObjectDisposedException) { break; }
        try {
          string path = context.Request.Url.AbsolutePath.TrimEnd('/');
          string method = context.Request.HttpMethod.ToUpperInvariant();
          if (method == "OPTIONS") { Reply(context, 204, "{}"); continue; }
          if (method == "GET" && (path == "" || path == "/state")) { Reply(context, 200, StateJson()); continue; }
          if (method == "POST" && path == "/cmd") {
            string body = ReadBody(context.Request);
            string cmdType = ExtractJsonString(body, "cmdType", "");
            if (cmdType == "setTrim") {
              double requestedTrim = ExtractJsonDouble(body, "ms", 0.0);
              lock (Gate) {
                trimMs = Math.Max(-100.0, Math.Min(100.0, Math.Round(requestedTrim)));
                ApplyModeToPotato();
                delayControlEnabled = true;
                autopilot = true;
              }
              Reply(context, 200, "{\"ok\":true,\"manualTrimMs\":" + trimMs.ToString("0", Invariant) + ",\"targetDelayBarMs\":" + targetDelayBarMs.ToString("0", Invariant) + "}");
              continue;
            }
            if (cmdType == "setMode") {
              string requestedMode = ExtractJsonString(body, "mode", "seamless");
              string[] supportedModes = new string[] { "seamless", "cinema", "party", "karaoke", "night" };
              bool supported = false;
              foreach (string supportedMode in supportedModes) if (String.Equals(supportedMode, requestedMode, StringComparison.OrdinalIgnoreCase)) supported = true;
              if (!supported) { Reply(context, 400, "{\"ok\":false,\"message\":\"Unknown listening mode\"}"); continue; }
              lock (Gate) {
                mode = requestedMode.ToLowerInvariant();
                ApplyModeToPotato();
                if (delayControlEnabled) autopilot = true;
              }
              Reply(context, 200, "{\"ok\":true,\"mode\":\"" + mode + "\",\"targetDelayBarMs\":" + targetDelayBarMs.ToString("0", Invariant) + "}");
              continue;
            }
            string script = "";
            try {
              System.Text.RegularExpressions.Match match = System.Text.RegularExpressions.Regex.Match(body, "\\\"script\\\"\\s*:\\s*\\\"((?:\\\\.|[^\\\"])*)\\\"");
              if (match.Success) script = System.Text.RegularExpressions.Regex.Unescape(match.Groups[1].Value);
            } catch {}
            if (script.Length == 0) { Reply(context, 400, "{\"ok\":false,\"error\":\"Missing script\"}"); continue; }
            int code = -1;
            if (loggedIn) { try { code = SetParameters(script); } catch { code = -1; } }
            if (script.IndexOf("Option.delay[", StringComparison.OrdinalIgnoreCase) >= 0) {
              autopilot = true;
              if (code == 0) lock (Gate) { delayWriteCount++; }
            }
            string message = loggedIn ? (code == 0 ? "ok" : "Voicemeeter rejected command") : "Bridge is offline; command not applied";
            Reply(context, loggedIn && code == 0 ? 200 : 503, "{\"ok\":" + (loggedIn && code == 0 ? "true" : "false") + ",\"message\":\"" + message + "\"}");
            continue;
          }
          Reply(context, 404, "{\"error\":\"Not found\"}");
        } catch (Exception ex) {
          try { Reply(context, 500, "{\"error\":\"" + ex.Message.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"}"); } catch {}
        }
      }
    } finally {
      stopping = true;
      if (listener.IsListening) listener.Stop();
      listener.Close();
      if (loggedIn) { try { Logout(); } catch {} }
    }
  }
}
'@
Add-Type -TypeDefinition $source -Language CSharp
try { [LockstepBridgeEngine]::Run() }
catch { Write-Host $_.Exception.Message -ForegroundColor Red; Read-Host 'Press Enter to close' }
`

/** Encode UTF-16LE as used by PowerShell's encoded command format. */
function encodePowerShellCommand(command: string): string {
  const bytes = new Uint8Array(command.length * 2)
  for (let index = 0; index < command.length; index += 1) {
    const codeUnit = command.charCodeAt(index)
    bytes[index * 2] = codeUnit & 0xff
    bytes[index * 2 + 1] = codeUnit >>> 8
  }
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Generate a self-contained batch launcher with its C# bridge embedded. */
export function buildBridgeBatchFile(): string {
  const encoded = encodePowerShellCommand(BRIDGE_POWERSHELL)
  const chunks = encoded.match(/.{1,120}/g) ?? []
  const lines = [
    '@echo off',
    'setlocal',
    'title Lockstep Offline - Voicemeeter Bridge',
    'set "LOCKSTEP_PAYLOAD=%TEMP%\\Lockstep-Bridge-%RANDOM%-%RANDOM%.b64"',
    ...(chunks.length > 0 ? [`> "%LOCKSTEP_PAYLOAD%" echo ${chunks[0]}`] : []),
    ...chunks.slice(1).map((chunk) => `>> "%LOCKSTEP_PAYLOAD%" echo ${chunk}`),
    'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$payload=[IO.File]::ReadAllText($env:LOCKSTEP_PAYLOAD); $script=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($payload)); Invoke-Expression $script"',
    'set "LOCKSTEP_EXIT=%ERRORLEVEL%"',
    'del "%LOCKSTEP_PAYLOAD%" >nul 2>nul',
    'if not "%LOCKSTEP_EXIT%"=="0" echo Lockstep bridge exited with an error.',
    'endlocal',
    '',
  ]
  return lines.join('\r\n')
}

/** Download the generated bridge batch file using the browser's save dialog. */
export function downloadBridgeFile(): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    throw new Error('The bridge file can only be downloaded from a browser window.')
  }
  const blob = new Blob([buildBridgeBatchFile()], { type: 'text/plain;charset=utf-8' })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = BRIDGE_FILENAME
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}
