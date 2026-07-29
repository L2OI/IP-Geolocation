@echo off
chcp 65001 >nul
set "SILENT_CDP_SCRIPT=%~f0"
set "SILENT_CDP_ACTION=%~1"
set "SILENT_CDP_ELEVATED=%~2"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:SILENT_CDP_SCRIPT; $t=[IO.File]::ReadAllText($p,[Text.UTF8Encoding]::new($false)); $m=('#'+'__POWERSHELL_PAYLOAD__'); $i=$t.IndexOf($m); if($i -lt 0){exit 2}; Invoke-Expression $t.Substring($i+$m.Length)"
exit /b %errorlevel%

#__POWERSHELL_PAYLOAD__
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Flag = '--silent-debugger-extension-api'
$ScriptPath = $env:SILENT_CDP_SCRIPT
$StartedFromMenu = [string]::IsNullOrWhiteSpace($env:SILENT_CDP_ACTION)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class ShortcutAppIdWriter {
  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  struct PROPERTYKEY { public Guid fmtid; public uint pid; }

  [StructLayout(LayoutKind.Explicit)]
  struct PROPVARIANT {
    [FieldOffset(0)] public ushort vt;
    [FieldOffset(8)] public IntPtr ptr;
  }

  [ComImport, Guid("0000010b-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPersistFile {
    [PreserveSig] int GetClassID(out Guid classId);
    [PreserveSig] int IsDirty();
    [PreserveSig] int Load([MarshalAs(UnmanagedType.LPWStr)] string fileName, uint mode);
    [PreserveSig] int Save([MarshalAs(UnmanagedType.LPWStr)] string fileName, bool remember);
    [PreserveSig] int SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string fileName);
    [PreserveSig] int GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string fileName);
  }

  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int GetAt(uint index, out PROPERTYKEY key);
    [PreserveSig] int GetValue(ref PROPERTYKEY key, out PROPVARIANT value);
    [PreserveSig] int SetValue(ref PROPERTYKEY key, ref PROPVARIANT value);
    [PreserveSig] int Commit();
  }

  [DllImport("ole32.dll")]
  static extern int PropVariantClear(ref PROPVARIANT value);

  public static void Set(string path, string appId) {
    object link = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("00021401-0000-0000-C000-000000000046")));
    try {
      var persist = (IPersistFile)link;
      int hr = persist.Load(path, 2);
      if (hr != 0) Marshal.ThrowExceptionForHR(hr);
      var store = (IPropertyStore)link;
      var key = new PROPERTYKEY { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
      var value = new PROPVARIANT { vt = 31, ptr = Marshal.StringToCoTaskMemUni(appId) };
      try {
        hr = store.SetValue(ref key, ref value);
        if (hr != 0) Marshal.ThrowExceptionForHR(hr);
        hr = store.Commit();
        if (hr != 0) Marshal.ThrowExceptionForHR(hr);
        hr = persist.Save(path, true);
        if (hr != 0) Marshal.ThrowExceptionForHR(hr);
      } finally {
        PropVariantClear(ref value);
      }
    } finally {
      if (Marshal.IsComObject(link)) Marshal.FinalReleaseComObject(link);
    }
  }
}
'@

function Complete-Script([int]$Code) {
  if ($StartedFromMenu -or $env:SILENT_CDP_ELEVATED -eq 'elevated') {
    Write-Host ''
    Read-Host '按回车键关闭窗口'
  }
  exit $Code
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

$Action = ([string]$env:SILENT_CDP_ACTION).Trim().ToLowerInvariant()
if (!$Action) {
  Write-Host 'Chromium 浏览器 CDP 调试提示管理'
  Write-Host ''
  Write-Host '1. 安装或修复普通快捷方式隐藏参数'
  Write-Host '2. 移除普通快捷方式隐藏参数'
  Write-Host '3. 仅预览，不修改'
  Write-Host '0. 退出'
  Write-Host ''
  switch (Read-Host '请选择') {
    '1' { $Action = 'install' }
    '2' { $Action = 'remove' }
    '3' { $Action = 'dry-run' }
    default { exit 0 }
  }
}

if ($Action -notin @('install', 'remove', 'dry-run', 'dry-remove')) {
  Write-Host "未知操作：$Action" -ForegroundColor Red
  Complete-Script 2
}

$Remove = $Action -in @('remove', 'dry-remove')
$DryRun = $Action -in @('dry-run', 'dry-remove')

if (!$DryRun -and !(Test-IsAdministrator)) {
  try {
    $arguments = @('/d', '/c', ('"' + $ScriptPath + '"'), $Action, 'elevated')
    $process = Start-Process -FilePath $env:ComSpec -Verb RunAs -ArgumentList $arguments -Wait -PassThru
    exit $process.ExitCode
  } catch {
    Write-Host "未获得管理员权限：$($_.Exception.Message)" -ForegroundColor Red
    Complete-Script 1
  }
}

function Get-ShortcutPaths {
  $paths = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $roots = @(
    [Environment]::GetFolderPath('Desktop'),
    [Environment]::GetFolderPath('CommonDesktopDirectory'),
    [Environment]::GetFolderPath('StartMenu'),
    [Environment]::GetFolderPath('CommonStartMenu')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique

  foreach ($root in $roots) {
    Get-ChildItem -LiteralPath $root -Filter '*.lnk' -File -Recurse -ErrorAction SilentlyContinue |
      ForEach-Object { [void]$paths.Add($_.FullName) }
  }
  return @($paths)
}

function Get-BrowserDefinitions {
  @(
    [pscustomobject]@{
      Id='chrome'; Name='Google Chrome'; Executables=@('chrome.exe')
      Patterns=@('\\Google\\Chrome\\Application\\chrome\.exe$')
      Paths=@(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe' }),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
      )
    },
    [pscustomobject]@{
      Id='edge'; Name='Microsoft Edge'; Executables=@('msedge.exe')
      Patterns=@('\\Microsoft\\Edge\\Application\\msedge\.exe$')
      Paths=@(
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
        $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe' }),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
      )
    },
    [pscustomobject]@{
      Id='brave'; Name='Brave'; Executables=@('brave.exe')
      Patterns=@('\\BraveSoftware\\Brave-Browser\\Application\\brave\.exe$')
      Paths=@(
        (Join-Path $env:ProgramFiles 'BraveSoftware\Brave-Browser\Application\brave.exe'),
        $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'BraveSoftware\Brave-Browser\Application\brave.exe' }),
        (Join-Path $env:LOCALAPPDATA 'BraveSoftware\Brave-Browser\Application\brave.exe')
      )
    },
    [pscustomobject]@{
      Id='vivaldi'; Name='Vivaldi'; Executables=@('vivaldi.exe')
      Patterns=@('\\Vivaldi\\Application\\vivaldi\.exe$')
      Paths=@(
        (Join-Path $env:ProgramFiles 'Vivaldi\Application\vivaldi.exe'),
        $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'Vivaldi\Application\vivaldi.exe' }),
        (Join-Path $env:LOCALAPPDATA 'Vivaldi\Application\vivaldi.exe')
      )
    },
    [pscustomobject]@{
      Id='opera'; Name='Opera / Opera GX'; Executables=@('launcher.exe','opera.exe')
      Patterns=@('\\Opera( GX)?\\.*\\(launcher|opera)\.exe$', '\\Opera( GX)?\\(launcher|opera)\.exe$')
      Paths=@(
        (Join-Path $env:LOCALAPPDATA 'Programs\Opera\launcher.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Opera GX\launcher.exe'),
        (Join-Path $env:ProgramFiles 'Opera\launcher.exe'),
        (Join-Path $env:ProgramFiles 'Opera GX\launcher.exe')
      )
    },
    [pscustomobject]@{
      Id='chromium'; Name='Chromium / Ungoogled Chromium'; Executables=@('chrome.exe')
      Patterns=@(
        '(?i)\\Chromium(\\|_).*\\chrome\.exe$',
        '(?i)\\ungoogled-chromium(\\|_).*\\chrome\.exe$',
        '(?i)\\Fingerprint browser\\.*\\chrome\.exe$'
      )
      Paths=@(
        (Join-Path $env:LOCALAPPDATA 'Chromium\Application\chrome.exe'),
        (Join-Path $env:ProgramFiles 'Chromium\chrome.exe')
      )
    }
  )
}

function Test-BrowserDefinition([System.IO.FileInfo]$File, $Definition) {
  foreach ($pattern in $Definition.Patterns) {
    if ($File.FullName -match $pattern) { return $true }
  }
  if ($Definition.Id -eq 'chromium') {
    return $File.VersionInfo.ProductName -match '(?i)Chromium'
  }
  return $File.VersionInfo.ProductName -match [regex]::Escape($Definition.Name.Split('/')[0].Trim())
}

function Find-InstalledBrowsers {
  $found = [System.Collections.Generic.List[object]]::new()
  $shell = New-Object -ComObject WScript.Shell
  $shortcutTargets = [System.Collections.Generic.List[string]]::new()
  foreach ($shortcutPath in Get-ShortcutPaths) {
    try {
      $target = [Environment]::ExpandEnvironmentVariables([string]$shell.CreateShortcut($shortcutPath).TargetPath)
      if ($target) { $shortcutTargets.Add($target) }
    } catch {}
  }

  foreach ($definition in Get-BrowserDefinitions) {
    $candidates = [System.Collections.Generic.List[string]]::new()
    foreach ($path in $definition.Paths) { if ($path) { $candidates.Add([string]$path) } }
    foreach ($path in $shortcutTargets) {
      if ($definition.Executables -contains [IO.Path]::GetFileName($path)) { $candidates.Add($path) }
    }

    foreach ($candidate in $candidates | Select-Object -Unique) {
      $expanded = [Environment]::ExpandEnvironmentVariables([string]$candidate).Trim('"')
      if (!(Test-Path -LiteralPath $expanded -PathType Leaf)) { continue }
      $file = Get-Item -LiteralPath $expanded
      if (!(Test-BrowserDefinition $file $definition)) { continue }
      if ($found | Where-Object { $_.Path -eq $file.FullName }) { continue }
      $found.Add([pscustomobject]@{ Id=$definition.Id; Name=$definition.Name; Path=$file.FullName })
    }
  }
  return @($found)
}

function Remove-Flag([string]$Value) {
  if (!$Value) { return $Value }
  return [regex]::Replace($Value, "(?i)(^|\s+)$([regex]::Escape($Flag))(?=\s|$)", '$1').Trim()
}

function Get-ShortcutAppUserModelId([string]$ShortcutPath) {
  try {
    $shellApplication = New-Object -ComObject Shell.Application
    $folder = $shellApplication.Namespace((Split-Path -Parent $ShortcutPath))
    $item = $folder.ParseName((Split-Path -Leaf $ShortcutPath))
    return [string]$item.ExtendedProperty('System.AppUserModel.ID')
  } catch {
    return ''
  }
}

function Find-BrowserAppUserModelId($Browser) {
  $shell = New-Object -ComObject WScript.Shell
  foreach ($shortcutPath in Get-ShortcutPaths) {
    try {
      $target = [Environment]::ExpandEnvironmentVariables([string]$shell.CreateShortcut($shortcutPath).TargetPath)
      if (![string]::Equals($target, $Browser.Path, [StringComparison]::OrdinalIgnoreCase)) { continue }
      $appId = Get-ShortcutAppUserModelId $shortcutPath
      if (![string]::IsNullOrWhiteSpace($appId)) { return $appId }
    } catch {}
  }

  try {
    $appsFolder = (New-Object -ComObject Shell.Application).Namespace('shell:AppsFolder')
    foreach ($item in $appsFolder.Items()) {
      $target = [Environment]::ExpandEnvironmentVariables([string]$item.ExtendedProperty('System.Link.TargetParsingPath'))
      if (![string]::Equals($target, $Browser.Path, [StringComparison]::OrdinalIgnoreCase)) { continue }
      $appId = [string]$item.ExtendedProperty('System.AppUserModel.ID')
      if (![string]::IsNullOrWhiteSpace($appId)) { return $appId }
    }
  } catch {}

  return ''
}

function Update-BrowserShortcuts($Browser) {
  $shell = New-Object -ComObject WScript.Shell
  $browserAppId = Find-BrowserAppUserModelId $Browser
  $changed = 0
  $matched = 0
  foreach ($shortcutPath in Get-ShortcutPaths) {
    try {
      $shortcut = $shell.CreateShortcut($shortcutPath)
      $target = [Environment]::ExpandEnvironmentVariables([string]$shortcut.TargetPath)
      if (![string]::Equals($target, $Browser.Path, [StringComparison]::OrdinalIgnoreCase)) { continue }
      $matched += 1
      $current = [string]$shortcut.Arguments
      $updated = if ($Remove) {
        Remove-Flag $current
      } elseif ($current -match "(?i)(^|\s)$([regex]::Escape($Flag))(?=\s|$)") {
        $current
      } else {
        "$current $Flag".Trim()
      }
      $needsArgumentUpdate = $updated -ne $current
      $needsAppIdUpdate = !$Remove -and ![string]::IsNullOrWhiteSpace($browserAppId) -and
        [string]::IsNullOrWhiteSpace((Get-ShortcutAppUserModelId $shortcutPath))
      if (!$needsArgumentUpdate -and !$needsAppIdUpdate) { continue }
      if ($DryRun) {
        Write-Host "[预览] 快捷方式：$shortcutPath"
      } else {
        if ($needsArgumentUpdate) {
          $shortcut.Arguments = $updated
          $shortcut.Save()
        }
        if ($needsAppIdUpdate) {
          [ShortcutAppIdWriter]::Set($shortcutPath, $browserAppId)
        }
        Write-Host "已更新快捷方式：$shortcutPath"
      }
      $changed += 1
    } catch {
      Write-Warning "无法更新快捷方式 $shortcutPath：$($_.Exception.Message)"
    }
  }

  if (!$Remove -and $matched -eq 0) {
    $safeName = [regex]::Replace($Browser.Name, '[\\/:*?"<>|]', '-')
    $shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) "$safeName - CDP静默.lnk"
    if ($DryRun) {
      Write-Host "[预览] 创建快捷方式：$shortcutPath"
    } else {
      $shortcut = $shell.CreateShortcut($shortcutPath)
      $shortcut.TargetPath = $Browser.Path
      $shortcut.Arguments = $Flag
      $shortcut.WorkingDirectory = Split-Path -Parent $Browser.Path
      $shortcut.IconLocation = "$($Browser.Path),0"
      $shortcut.Save()
      if (![string]::IsNullOrWhiteSpace($browserAppId)) {
        [ShortcutAppIdWriter]::Set($shortcutPath, $browserAppId)
      }
      Write-Host "已创建快捷方式：$shortcutPath"
    }
    $changed += 1
  }
  return $changed
}

try {
  $browsers = @(Find-InstalledBrowsers)
  if (!$browsers.Count) {
    Write-Host '未找到可处理的 Chromium 浏览器。' -ForegroundColor Red
    Complete-Script 1
  }

  Write-Host $(if ($DryRun) { '正在预览...' } elseif ($Remove) { '正在移除普通快捷方式隐藏参数...' } else { '正在安装或修复普通快捷方式隐藏参数...' })
  $shortcutChanges = 0
  foreach ($browser in $browsers) {
    Write-Host "`n$($browser.Name)：$($browser.Path)"
    $shortcutChanges += Update-BrowserShortcuts $browser
  }

  Write-Host ''
  if ($DryRun) {
    Write-Host "预览完成：将修改快捷方式 $shortcutChanges 项。" -ForegroundColor Green
  } elseif ($Remove) {
    Write-Host "移除完成：快捷方式 $shortcutChanges 项。" -ForegroundColor Green
  } else {
    Write-Host "安装完成：快捷方式 $shortcutChanges 项。" -ForegroundColor Green
    Write-Host "启动参数：$Flag"
  }
  Write-Host '请完全退出浏览器后，从处理后的快捷方式重新打开。'
  Write-Host '本脚本不读写注册表，也不处理任务栏固定项。'
  Complete-Script 0
} catch {
  Write-Host "执行失败：$($_.Exception.Message)" -ForegroundColor Red
  Complete-Script 1
}
