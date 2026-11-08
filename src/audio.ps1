# R75 Customiser: per-application volume through the Windows Core Audio API.
# Long-running helper: reads one command per line on stdin, answers one line on stdout.
#   list                 -> JSON array of process names that own an audio session
#   vol <TAB> name <TAB> delta  -> new volume in percent, or -1 if the app has no session
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace R75 {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
  }

  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection {
    int GetCount(out int count);
    int Item(int index, out IMMDevice device);
  }

  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  }

  [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    int GetAudioSessionControl(IntPtr groupingParam, int flags, out IntPtr control);
    int GetSimpleAudioVolume(IntPtr groupingParam, int flags, out IntPtr volume);
    int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
  }

  [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    int GetCount(out int count);
    int GetSession(int index, out IAudioSessionControl2 session);
  }

  [Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    int GetState(out int state);
    int GetDisplayName(out IntPtr name);
    int SetDisplayName(IntPtr name, IntPtr ctx);
    int GetIconPath(out IntPtr path);
    int SetIconPath(IntPtr path, IntPtr ctx);
    int GetGroupingParam(out Guid param);
    int SetGroupingParam(IntPtr param, IntPtr ctx);
    int RegisterAudioSessionNotification(IntPtr client);
    int UnregisterAudioSessionNotification(IntPtr client);
    int GetSessionIdentifier(out IntPtr id);
    int GetSessionInstanceIdentifier(out IntPtr id);
    int GetProcessId(out uint pid);
  }

  [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume {
    int SetMasterVolume(float level, ref Guid ctx);
    int GetMasterVolume(out float level);
  }

  public static class Audio {
    // Every audio session on every active playback device.
    static List<IAudioSessionControl2> Sessions() {
      var list = new List<IAudioSessionControl2>();
      var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
      IMMDeviceCollection devices;
      Marshal.ThrowExceptionForHR(en.EnumAudioEndpoints(0, 1, out devices)); // eRender, DEVICE_STATE_ACTIVE
      int n;
      devices.GetCount(out n);
      Guid iid = typeof(IAudioSessionManager2).GUID;
      for (int d = 0; d < n; d++) {
        IMMDevice dev;
        object o;
        if (devices.Item(d, out dev) != 0 || dev.Activate(ref iid, 23, IntPtr.Zero, out o) != 0) continue;
        IAudioSessionEnumerator se;
        if (((IAudioSessionManager2)o).GetSessionEnumerator(out se) != 0) continue;
        int c;
        se.GetCount(out c);
        for (int i = 0; i < c; i++) {
          IAudioSessionControl2 s;
          if (se.GetSession(i, out s) == 0) list.Add(s);
        }
      }
      return list;
    }

    static string Name(IAudioSessionControl2 s) {
      uint pid;
      if (s.GetProcessId(out pid) != 0 || pid == 0) return null;
      try { return Process.GetProcessById((int)pid).ProcessName; } catch { return null; }
    }

    public static string List() {
      var names = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
      foreach (var s in Sessions()) {
        var n = Name(s);
        if (n != null) names.Add(n);
      }
      var sb = new StringBuilder("[");
      foreach (var n in names) {
        if (sb.Length > 1) sb.Append(',');
        sb.Append('"').Append(n.Replace("\\", "\\\\").Replace("\"", "\\\"")).Append('"');
      }
      return sb.Append(']').ToString();
    }

    public static int Change(string app, int deltaPercent) {
      float level = -1;
      Guid ctx = Guid.Empty;
      foreach (var s in Sessions()) {
        if (!string.Equals(Name(s), app, StringComparison.OrdinalIgnoreCase)) continue;
        var v = (ISimpleAudioVolume)s;
        if (level < 0) {
          float cur;
          v.GetMasterVolume(out cur);
          level = Math.Max(0f, Math.Min(100f, (float)Math.Round(cur * 100) + deltaPercent)) / 100f;
        }
        v.SetMasterVolume(level, ref ctx);
      }
      return level < 0 ? -1 : (int)Math.Round(level * 100);
    }
  }
}
'@

while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $p = $line.Split("`t")
    switch ($p[0]) {
      'list' { [Console]::Out.WriteLine([R75.Audio]::List()) }
      'vol' { [Console]::Out.WriteLine([R75.Audio]::Change($p[1], [int]$p[2])) }
      default { [Console]::Out.WriteLine('ERR unknown command') }
    }
  } catch {
    [Console]::Out.WriteLine('ERR ' + $_.Exception.Message.Replace("`n", ' '))
  }
}
