# Docker cleanup presence verification for disposable integration (offline-testable).
# Dot-source only — no executable entry point.

Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'DispatcherWatchdogNativeProcessCapture.ps1')

function Test-DockerInspectMissingObjectMessage {
    param([string]$Stderr)

    if ([string]::IsNullOrWhiteSpace($Stderr)) {
        return $false
    }
    return [bool]([regex]::IsMatch($Stderr, '(?i)no such (object|image|container|network|volume)'))
}

function Assert-DockerInspectRecordKind {
    param(
        [Parameter(Mandatory = $true)]$Record,
        [Parameter(Mandatory = $true)][ValidateSet('container', 'network', 'volume')][string]$Kind
    )

    switch ($Kind) {
        'container' {
            if (-not ($Record.PSObject.Properties.Name -contains 'State')) {
                throw 'docker_cleanup_verify_kind_mismatch:container'
            }
        }
        'network' {
            if (-not ($Record.PSObject.Properties.Name -contains 'IPAM')) {
                throw 'docker_cleanup_verify_kind_mismatch:network'
            }
        }
        'volume' {
            if (-not ($Record.PSObject.Properties.Name -contains 'Mountpoint')) {
                throw 'docker_cleanup_verify_kind_mismatch:volume'
            }
        }
    }
}

function Resolve-DockerInspectAbsenceFromCapture {
    param(
        [Parameter(Mandatory = $true)][bool]$Started,
        [AllowNull()][string]$StartError,
        [AllowNull()][int]$ExitCode,
        [AllowNull()][string]$Stdout,
        [AllowNull()][string]$Stderr,
        [Parameter(Mandatory = $true)][string]$ExpectedId,
        [ValidateSet('container', 'network', 'volume')][string]$Kind
    )

    if (-not $Started) {
        throw "docker_cleanup_verify_start_failed:$StartError"
    }

    if ($ExitCode -eq 0) {
        if ([string]::IsNullOrWhiteSpace($Stdout)) {
            throw 'docker_cleanup_verify_empty_stdout'
        }
        try {
            $parsed = $Stdout | ConvertFrom-Json
        }
        catch {
            throw 'docker_cleanup_verify_invalid_json'
        }
        $records = @($parsed)
        if ($records.Count -lt 1) {
            throw 'docker_cleanup_verify_empty_inspect'
        }
        $record = $records[0]
        $recordId = [string]$record.Id
        if ([string]::IsNullOrWhiteSpace($recordId)) {
            throw 'docker_cleanup_verify_missing_id'
        }
        if ($recordId -ne $ExpectedId) {
            throw 'docker_cleanup_verify_identity_mismatch'
        }
        if ($Kind) {
            Assert-DockerInspectRecordKind -Record $record -Kind $Kind
        }
        return 'present'
    }

    if ($ExitCode -eq 1 -and (Test-DockerInspectMissingObjectMessage -Stderr $Stderr)) {
        return 'absent'
    }

    $stderrSnippet = if ([string]::IsNullOrWhiteSpace($Stderr)) { '<empty>' } else { $Stderr.Trim() }
    throw "docker_cleanup_verify_unexpected:exit=$ExitCode:stderr=$stderrSnippet"
}

function Invoke-DockerInspectAbsenceState {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [ValidateSet('container', 'network', 'volume')][string]$Kind
    )

    $capture = Invoke-DisposableIntegrationNativeCapture `
        -Stage 'docker_cleanup_verify' `
        -FilePath 'docker' `
        -ArgumentList @('inspect', $Id)

    return Resolve-DockerInspectAbsenceFromCapture `
        -Started $capture.Started `
        -StartError $capture.StartError `
        -ExitCode $capture.ExitCode `
        -Stdout $capture.Stdout `
        -Stderr $capture.Stderr `
        -ExpectedId $Id `
        -Kind $Kind
}

function Test-DockerResourceAbsent {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][ValidateSet('container', 'network', 'volume')][string]$Kind
    )

    $state = Invoke-DockerInspectAbsenceState -Id $Id -Kind $Kind
    return ($state -eq 'absent')
}

function Get-DispatcherWatchdogIntegrationProcessExitCode {
    param(
        [int]$IntegrationExitCode = 0,
        [int]$TestExitCode = 0,
        [int]$CleanupExitCode = 0
    )

    $exit = $IntegrationExitCode
    if ($TestExitCode -ne 0) {
        $exit = 1
    }
    if ($CleanupExitCode -ne 0) {
        $exit = 1
    }
    return $exit
}
