[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param()
$ErrorActionPreference = 'Stop'
# Source now lives at the repository root. Never treat it as an obsolete checkout.
# Retain this historical command as an alias for verified release-package cleanup.
& (Join-Path $PSScriptRoot 'prune-releases.ps1') @PSBoundParameters
