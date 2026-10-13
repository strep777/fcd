[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param([switch]$IncludeLegacyProfile, [string[]]$ExcludePath = @(), [switch]$GeneratedOnly, [switch]$IncludeLegacyGenerated)
# Run only after verification has finished and FurryPattern CAD is closed.
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$legacyProfile = [IO.Path]::GetFullPath((Join-Path $env:APPDATA 'FurryPatternCAD'))
# Safe by default: never infer that the user's workspace is test data.
$targets = @('.local\tests','.local\auto-reference-fixture.json','.local\npm-cache','.local\electron-cache','.local\dependency-audit-before.json','target\debug','test-results') | ForEach-Object { [IO.Path]::GetFullPath((Join-Path $taskRoot $_)) }
if ($GeneratedOnly -and $IncludeLegacyProfile) { throw 'GeneratedOnly cannot include a user profile.' }
$targets += @('.local\runtime-probe.mjs','.local\write-final-audit.mjs') | ForEach-Object { [IO.Path]::GetFullPath((Join-Path $taskRoot $_)) }
$targets += @('.local\contour-evidence','.local\contour-debug.ts','.local\contour-evidence.mjs','.local\contour-evidence.ts','.local\cut-resume-build.mjs','.local\cut-resume-debug.mjs','.local\cut-resume-debug.ts','.local\cut-resume-project.json') | ForEach-Object { [IO.Path]::GetFullPath((Join-Path $taskRoot $_)) }
if ($IncludeLegacyGenerated) {
 $targets += @('.local\tests','.local\performance-fixture','.local\audit-original','test-results') | ForEach-Object { [IO.Path]::GetFullPath((Join-Path $taskRoot $_)) }
}
$targets += @('.local\pigment-evidence','.local\illustration-before-pastel.ts','.local\pigment-evidence.mjs','.local\pigment-evidence.ts','.local\pigment-fixtures.mjs','.local\pigment-whole.mjs','.local\pigment-whole.ts') | ForEach-Object { [IO.Path]::GetFullPath((Join-Path $taskRoot $_)) }
if ($IncludeLegacyProfile) { $targets += $legacyProfile }
$excluded = @($ExcludePath | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\') })
foreach ($path in $excluded) {
 if ($path -notin $targets) { throw "Excluded path is not a cleanup target: $path" }
 Write-Output "Explicitly excluded: $path"
}
$targets = @($targets | Where-Object { $_ -notin $excluded } | Select-Object -Unique)
$inventory = @()
# Validate all paths, links and database locks before deleting any data.
foreach ($target in $targets) {
 if (-not $target.StartsWith($taskRoot + '\', [StringComparison]::OrdinalIgnoreCase) -and -not ($IncludeLegacyProfile -and $target -eq $legacyProfile)) { throw "Target outside approved cleanup scope: $target" }
 if (-not (Test-Path -LiteralPath $target)) { continue }
 $ancestor = Get-Item -LiteralPath $target -Force
 while ($null -ne $ancestor) {
  if ($ancestor.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) { throw "Refusing linked path: $($ancestor.FullName)" }
  $ancestor = if ($ancestor.PSIsContainer) { $ancestor.Parent } else { $ancestor.Directory }
 }
 $targetItem = Get-Item -LiteralPath $target -Force
 $entries = if ($targetItem.PSIsContainer) { @(Get-ChildItem -LiteralPath $target -Recurse -Force) } else { @($targetItem) }
 if ($entries | Where-Object { $_.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint) }) { throw "Refusing linked contents: $target" }
 $files = @($entries | Where-Object { -not $_.PSIsContainer })
 foreach ($file in $files | Where-Object { $_.Name -eq 'lockfile' -or $_.Name -eq 'workspace.sqlite' }) {
  try { $handle = [IO.File]::Open($file.FullName, 'Open', 'Read', 'None'); $handle.Dispose() }
  catch { throw "Close the application using $($file.FullName). No cleanup has started." }
 }
 $inventory += [pscustomobject]@{ Path=$target; Files=$files.Count; Bytes=($files | Measure-Object Length -Sum).Sum }
}
$inventory | Format-Table -AutoSize
$failures = @()
foreach ($item in $inventory) {
 if ($PSCmdlet.ShouldProcess($item.Path, 'Remove generated test data, runtime projects, caches and archived test artifacts')) {
  try {
   Remove-Item -LiteralPath $item.Path -Recurse -Force
   if (Test-Path -LiteralPath $item.Path) { throw "Cleanup incomplete: $($item.Path)" }
   Write-Output "Cleared: $($item.Path)"
  } catch {
   $failures += $item.Path
   Write-Output "NOT cleared: $($item.Path). $($_.Exception.Message)"
  }
 }
}
Write-Output 'Source code, test programs, fixed regression fixtures, production assets, release builds and final audit records are retained.'
if (-not $IncludeLegacyProfile -and (Test-Path -LiteralPath $legacyProfile)) { Write-Output "Legacy profile not included: $legacyProfile. Run manually with -IncludeLegacyProfile to include it." }
if ($failures.Count) { throw "Cleanup incomplete. Failed paths: $($failures -join ', ')" }
