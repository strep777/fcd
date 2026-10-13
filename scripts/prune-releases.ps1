[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param([string[]]$Keep = @(), [switch]$IncludeLegacy)
$ErrorActionPreference = 'Stop'
if ($IncludeLegacy) { throw 'IncludeLegacy is no longer supported: cleanup is limited to this repository release directory.' }
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$latest = Get-Content -LiteralPath (Join-Path $projectRoot 'release/latest.json') -Raw | ConvertFrom-Json
$current = [IO.Path]::GetFullPath($latest.directory).TrimEnd('\')
$releaseRoot = Join-Path $projectRoot 'release'
if ([IO.Path]::GetDirectoryName($current) -ne $releaseRoot) { throw 'Latest package is outside the maintained release directory.' }
if (-not (Test-Path -LiteralPath (Join-Path $current 'FurryPatternCAD.exe'))) { throw 'Latest executable is missing.' }
$build = Get-Content -LiteralPath (Join-Path $current 'BUILD.json') -Raw | ConvertFrom-Json
if ($build.buildHash -ne $latest.buildHash) { throw 'Latest package manifest does not match.' }
foreach ($name in $Keep) { if ($name -notmatch '^FurryPatternCAD-[0-9.]+-win-x64-[0-9a-f]{8}$') { throw 'Invalid retained package name.' } }
$roots = @($releaseRoot)
$plan = @()
foreach ($releasePath in $roots) {
 if (-not (Test-Path -LiteralPath $releasePath)) { continue }
 $ancestor = Get-Item -LiteralPath $releasePath -Force
 while ($null -ne $ancestor) {
  if ($ancestor.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) { throw 'Refusing linked release ancestor.' }
  $ancestor = $ancestor.Parent
 }
 foreach ($directory in Get-ChildItem -LiteralPath $releasePath -Directory) {
  if ($directory.Name -notmatch '^FurryPatternCAD-[0-9.]+-win-x64-[0-9a-f]{8}$') { continue }
  $target = [IO.Path]::GetFullPath($directory.FullName)
  if ([IO.Path]::GetDirectoryName($target) -ne $releasePath) { throw 'Package is outside the expected release root.' }
  if ($target -eq $current -or $directory.Name -in $Keep) { continue }
  if ($directory.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) { throw 'Refusing linked package.' }
  $entries = @(Get-ChildItem -LiteralPath $target -Recurse -Force)
  if ($entries | Where-Object { $_.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint) }) { throw 'Refusing linked package contents.' }
  $files = @($entries | Where-Object { -not $_.PSIsContainer })
  $plan += [pscustomobject]@{Path=$target; Files=$files.Count; Bytes=($files | Measure-Object Length -Sum).Sum; Status='planned'; Error=$null}
 }
}
foreach ($item in $plan) {
 if ($PSCmdlet.ShouldProcess($item.Path,'Remove obsolete generated package')) {
  try { Remove-Item -LiteralPath $item.Path -Recurse -Force; $item.Status='removed' }
  catch { $item.Status='blocked'; $item.Error=$_.Exception.Message }
 }
}
$report = [pscustomobject]@{Time=(Get-Date).ToString('o'); Current=$current; Retained=$Keep; Packages=$plan}
if (-not $WhatIfPreference) {
 New-Item -ItemType Directory -Path (Join-Path $projectRoot 'test-results') -Force | Out-Null
 $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $projectRoot 'test-results/release-cleanup.json') -Encoding utf8
}
$plan | Group-Object Status | Select-Object Name,Count
if ($plan | Where-Object Status -eq 'blocked') { throw 'Some legacy packages could not be removed. See 57-release-cleanup.json.' }
