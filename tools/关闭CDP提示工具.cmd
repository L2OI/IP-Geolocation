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
  Write-Host '1. 安装或修复隐藏参数'
  Write-Host '2. 恢复浏览器启动设置'
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
    [Environment]::GetFolderPath('CommonStartMenu'),
    (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'),
    (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\StartMenu')
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
      $found.Add([pscustomobject]@{ Name=$definition.Name; Path=$file.FullName })
    }
  }
  return @($found)
}

function Remove-Flag([string]$Value) {
  if (!$Value) { return $Value }
  return [regex]::Replace($Value, "(?i)(^|\s+)$([regex]::Escape($Flag))(?=\s|$)", '$1').Trim()
}

function Update-BrowserShortcuts($Browser) {
  $shell = New-Object -ComObject WScript.Shell
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
      if ($updated -eq $current) { continue }
      if ($DryRun) {
        Write-Host "[预览] 快捷方式：$shortcutPath"
      } else {
        $shortcut.Arguments = $updated
        $shortcut.Save()
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

  Write-Host $(if ($DryRun) { '正在预览...' } elseif ($Remove) { '正在恢复启动设置...' } else { '正在安装或修复隐藏参数...' })
  $shortcutChanges = 0
  foreach ($browser in $browsers) {
    Write-Host "`n$($browser.Name)：$($browser.Path)"
    $shortcutChanges += Update-BrowserShortcuts $browser
  }

  Write-Host ''
  if ($DryRun) {
    Write-Host "预览完成：将修改快捷方式 $shortcutChanges 项。" -ForegroundColor Green
  } elseif ($Remove) {
    Write-Host "恢复完成：快捷方式 $shortcutChanges 项。" -ForegroundColor Green
  } else {
    Write-Host "安装完成：快捷方式 $shortcutChanges 项。" -ForegroundColor Green
    Write-Host "启动参数：$Flag"
  }
  Write-Host '请完全退出相关浏览器进程后重新打开。'
  Write-Host '本脚本不会读取或修改注册表。请从处理后的快捷方式启动浏览器。'
  Write-Host '浏览器未运行时，直接点击外部链接或双击原始 exe 不会带上该参数。'
  Write-Host '浏览器更新覆盖启动设置后，重新运行本脚本即可。'
  Complete-Script 0
} catch {
  Write-Host "执行失败：$($_.Exception.Message)" -ForegroundColor Red
  Complete-Script 1
}
