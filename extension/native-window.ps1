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
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr h);
 [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; public uint reserved; }
 [DllImport("user32.dll")] public static extern bool PeekMessage(out MSG message, IntPtr h, uint min, uint max, uint flags);
 [StructLayout(LayoutKind.Sequential)] public struct GUIINFO { public uint size; public uint flags; public IntPtr active,focus,capture,menuOwner,moveSize,caret; public int left,top,right,bottom; }
 [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint thread, ref GUIINFO info);
 [DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent, IntPtr child);
 public static bool FocusHost(long window, uint expectedPid, uint[] allowedPids, bool preserveCurrentFocus) {
  var h=new IntPtr(window); uint pid; var target=GetWindowThreadProcessId(h,out pid);
  if(pid!=expectedPid || pid==0) throw new Exception("Focus process mismatch");
  MSG message; PeekMessage(out message,IntPtr.Zero,0,0,0);
  var current=GetCurrentThreadId(); uint foregroundPid; var foreground=GetWindowThreadProcessId(GetForegroundWindow(),out foregroundPid);
  if(foregroundPid!=expectedPid && Array.IndexOf(allowedPids,foregroundPid)<0)return false;
  if(preserveCurrentFocus) {
   var info=new GUIINFO();info.size=(uint)Marshal.SizeOf(typeof(GUIINFO));
   if(GetGUIThreadInfo(target,ref info)) {
    uint focusPid;GetWindowThreadProcessId(info.focus,out focusPid);
    if(focusPid==expectedPid && (info.focus==h || IsChild(h,info.focus)))return true;
   }
  }
  bool toTarget=false,toForeground=false;
  try {
   if(current!=target) toTarget=AttachThreadInput(current,target,true);
   if(foreground!=0 && foreground!=target && foreground!=current) toForeground=AttachThreadInput(current,foreground,true);
   SetForegroundWindow(h);SetActiveWindow(h);SetFocus(h);
  } finally {
   if(toForeground)AttachThreadInput(current,foreground,false);
   if(toTarget)AttachThreadInput(current,target,false);
  }
  return true;
 }
 public static void Apply(long child, long parent, uint expectedPid, int x, int y, int width, int height, bool visible, bool attach) {
  var c = new IntPtr(child); uint pid; GetWindowThreadProcessId(c, out pid);
  if(pid != expectedPid || pid == 0) throw new Exception("Window process mismatch");
  if(attach) {
   var style=GetWindowLong(c,-16);style=parent==0 ? ((style & ~0x40000000) | unchecked((int)0x80000000)) : ((style & ~unchecked((int)0x80CF0000)) | 0x40000000);
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
  if ($c.focusHost) {
   $focused = [ChatBridgeWindows]::FocusHost([long]$c.window,[uint32]$c.pid,[uint32[]]$c.allowedPids,[bool]$c.preserveCurrentFocus)
   [Console]::Out.WriteLine((@{id=$c.id;ok=$focused}|ConvertTo-Json -Compress))
   continue
  }
  [ChatBridgeWindows]::Apply([long]$c.child,[long]$c.parent,[uint32]$c.pid,[int]$c.x,[int]$c.y,[int]$c.width,[int]$c.height,[bool]$c.visible,[bool]$c.attach)
  [Console]::Out.WriteLine((@{id=$c.id;ok=$true;parent=[ChatBridgeWindows]::GetParent([IntPtr]([long]$c.child)).ToInt64().ToString()}|ConvertTo-Json -Compress))
 } catch { [Console]::Out.WriteLine((@{id=$c.id;error=$_.Exception.Message}|ConvertTo-Json -Compress)) }
}
