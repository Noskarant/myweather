param([Parameter(Mandatory=$true)][long]$Hwnd)
$ErrorActionPreference='Stop'
# Best-effort Windows 11 Explorer WorkerW attachment, no administrator required.
# If Explorer's private window layout changes, the widget stays non-topmost.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DesktopShell {
 public delegate bool EnumWindowsCallback(IntPtr hwnd,IntPtr value);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls,string name);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string cls,string name);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsCallback cb,IntPtr value);
 [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr hwnd,uint msg,IntPtr w,IntPtr l,uint flags,uint timeout,out IntPtr result);
 [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr child,IntPtr parent);
 [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr hwnd,int index);
 [DllImport("user32.dll",EntryPoint="SetWindowLongPtrW")] public static extern IntPtr SetWindowLongPtr(IntPtr hwnd,int index,IntPtr value);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd,IntPtr after,int x,int y,int cx,int cy,uint flags);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd,out Rect r);
 [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr hwnd,ref Point p);
 [StructLayout(LayoutKind.Sequential)] public struct Rect {public int Left,Top,Right,Bottom;}
 [StructLayout(LayoutKind.Sequential)] public struct Point {public int X,Y;}
}
'@
$progman=[DesktopShell]::FindWindow('Progman',$null)
if($progman -eq [IntPtr]::Zero){exit 2}
$result=[IntPtr]::Zero
[void][DesktopShell]::SendMessageTimeout($progman,0x052C,[IntPtr]::Zero,[IntPtr]::Zero,0,700,[ref]$result)
$script:worker=[IntPtr]::Zero
$callback=[DesktopShell+EnumWindowsCallback]{
 param($top,$ignored)
 $view=[DesktopShell]::FindWindowEx($top,[IntPtr]::Zero,'SHELLDLL_DefView',$null)
 if($view -ne [IntPtr]::Zero){
  $candidate=[DesktopShell]::FindWindowEx([IntPtr]::Zero,$top,'WorkerW',$null)
  if($candidate -ne [IntPtr]::Zero){$script:worker=$candidate;return $false}
 }
 return $true
}
[void][DesktopShell]::EnumWindows($callback,[IntPtr]::Zero)
if($script:worker -eq [IntPtr]::Zero){exit 3}
$window=[IntPtr]::new($Hwnd)
$rect=New-Object 'DesktopShell+Rect'
if(-not [DesktopShell]::GetWindowRect($window,[ref]$rect)){exit 4}
$p=New-Object 'DesktopShell+Point'
$p.X=$rect.Left;$p.Y=$rect.Top
[void][DesktopShell]::ScreenToClient($script:worker,[ref]$p)
$old=[DesktopShell]::GetWindowLongPtr($window,-16).ToInt64()
$newStyle=($old -bor 0x40000000L) -band (-bnot 0x80000000L)
[void][DesktopShell]::SetWindowLongPtr($window,-16,[IntPtr]::new([long]$newStyle))
[void][DesktopShell]::SetParent($window,$script:worker)
[void][DesktopShell]::SetWindowPos($window,[IntPtr]::Zero,$p.X,$p.Y,($rect.Right-$rect.Left),($rect.Bottom-$rect.Top),0x0050)
exit 0
