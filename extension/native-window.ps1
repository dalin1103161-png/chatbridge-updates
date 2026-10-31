# SPDX-License-Identifier: AGPL-3.0-only
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ChatBridgeWindows {
 [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
 [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
 [DllImport("user32.dll", SetLastError=true)] public static extern int GetWindowLong(IntPtr h, int i);
 [DllImport("user32.dll", SetLastError=true)] public static extern int SetWindowLong(IntPtr h, int i, int value);
 [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int height, uint flags);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int mode);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 public static void Apply(long child, long parent, uint expectedPid, int x, int y, int width, int height, bool visible, bool attach) {
  var c = new IntPtr(child); uint pid; GetWindowThreadProcessId(c, out pid);
  if(pid != expectedPid || pid == 0) throw new Exception("Window process mismatch");
  if(attach) {
   var style=GetWindowLong(c,-16);style=(style & ~unchecked((int)0x80CF0000)) | 0x40000000;
   SetWindowLong(c,-16,style);
   SetParent(c,new IntPtr(parent));
   if(GetParent(c)!=new IntPtr(parent)) throw new Exception("Embedding parent mismatch");
  }
  if(!SetWindowPos(c,IntPtr.Zero,x,y,Math.Max(1,width),Math.Max(1,height),0x0034)) throw new Exception("Window positioning failed");
  ShowWindow(c,visible?4:0);
 }
}
'@
[Console]::Out.WriteLine('{"ready":true}')
while ($null -ne ($line=[Console]::ReadLine())) {
 try {
  $c=$line | ConvertFrom-Json
  [ChatBridgeWindows]::Apply([long]$c.child,[long]$c.parent,[uint32]$c.pid,[int]$c.x,[int]$c.y,[int]$c.width,[int]$c.height,[bool]$c.visible,[bool]$c.attach)
  [Console]::Out.WriteLine((@{id=$c.id;ok=$true;parent=[ChatBridgeWindows]::GetParent([IntPtr]([long]$c.child)).ToInt64().ToString()}|ConvertTo-Json -Compress))
 } catch { [Console]::Out.WriteLine((@{id=$c.id;error=$_.Exception.Message}|ConvertTo-Json -Compress)) }
}
