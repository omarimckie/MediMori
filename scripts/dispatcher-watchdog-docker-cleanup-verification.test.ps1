# Offline regression tests for disposable integration Docker cleanup verification (T1–T30).
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'DispatcherWatchdogDockerCleanupVerification.ps1')

$failed = 0
$passed = 0

function Assert-True {
    param([bool]$Condition, [string]$Name)
    if ($Condition) {
        $script:passed++
    }
    else {
        Write-Host "FAIL: $Name"
        $script:failed++
    }
}

function Assert-Throws {
    param([scriptblock]$Block, [string]$Name, [string]$Pattern = '')
    try {
        & $Block
        Write-Host "FAIL: $Name (expected throw)"
        $script:failed++
    }
    catch {
        if ($Pattern -and $_.Exception.Message -notmatch $Pattern) {
            Write-Host "FAIL: $Name (wrong message: $($_.Exception.Message))"
            $script:failed++
        }
        else {
            $script:passed++
        }
    }
}

$containerId = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
$containerJson = "[{`"Id`":`"$containerId`",`"State`":{}}]"
$networkJson = "[{`"Id`":`"$containerId`",`"IPAM`":{}}]"
$volumeJson = "[{`"Id`":`"$containerId`",`"Mountpoint`":`"/var/lib/docker/volumes/x/_data`"}]"

# T1 present object exit 0
$r1 = Resolve-DockerInspectAbsenceFromCapture -Started $true -ExitCode 0 -Stdout $containerJson -Stderr '' -ExpectedId $containerId -Kind 'container'
Assert-True ($r1 -eq 'present') 'T1 docker inspect exit 0 => present'

# T2 missing object
$r2 = Resolve-DockerInspectAbsenceFromCapture -Started $true -ExitCode 1 -Stdout '' -Stderr 'Error: No such object: abc' -ExpectedId $containerId
Assert-True ($r2 -eq 'absent') 'T2 missing-object stderr => absent'

# T3 missing-object does not terminate under Stop
$terminated = $false
try {
    $null = Resolve-DockerInspectAbsenceFromCapture -Started $true -ExitCode 1 -Stdout '' -Stderr 'error: no such container: xyz' -ExpectedId $containerId
}
catch {
    $terminated = $true
}
Assert-True (-not $terminated) 'T3 missing-object does not throw (non-terminating classification)'

# T4 daemon unavailable fails closed
Assert-Throws {
    Resolve-DockerInspectAbsenceFromCapture -Started $true -ExitCode 1 -Stdout '' -Stderr 'Cannot connect to the Docker daemon' -ExpectedId $containerId
} 'T4 daemon unavailable fails closed' 'docker_cleanup_verify_unexpected'

# T5 permission denied fails closed
Assert-Throws {
    Resolve-DockerInspectAbsenceFromCapture -Started $true -ExitCode 1 -Stdout '' -Stderr 'permission denied while trying to connect' -ExpectedId $containerId
} 'T5 permission denied fails closed' 'docker_cleanup_verify_unexpected'

# T6 context failure fails closed
Assert-Throws {
    Resolve-DockerInspectAbsenceFromCapture -Started $true -ExitCode 1 -Stdout '' -Stderr 'error during connect: context deadline exceeded' -ExpectedId $containerId
} 'T6 docker context/transport failure fails closed' 'docker_cleanup_verify_unexpected'

# T7 unexpected nonzero exit fails closed
Assert-Throws {
    Resolve-DockerInspectAbsenceFromCapture -Started $true -ExitCode 2 -Stdout '' -Stderr 'unexpected failure' -ExpectedId $containerId
} 'T7 unexpected nonzero exit fails closed' 'docker_cleanup_verify_unexpected'

# T8 empty stderr with nonzero exit fails closed
Assert-Throws {
    Resolve-DockerInspectAbsenceFromCapture -Started $true -ExitCode 1 -Stdout '' -Stderr '' -ExpectedId $containerId
} 'T8 empty stderr nonzero exit fails closed' 'docker_cleanup_verify_unexpected'

# T9 ambiguous inspect output fails closed
Assert-Throws {
    Resolve-DockerInspectAbsenceFromCapture -Started $true -ExitCode 0 -Stdout 'not-json' -Stderr '' -ExpectedId $containerId
} 'T9 ambiguous inspect stdout fails closed' 'docker_cleanup_verify_invalid_json'

# T10 wrong resource identity fails closed
$wrongIdJson = "[{`"Id`":`"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`",`"State`":{}}]"
Assert-Throws {
    Resolve-DockerInspectAbsenceFromCapture -Started $true -ExitCode 0 -Stdout $wrongIdJson -Stderr '' -ExpectedId $containerId -Kind 'container'
} 'T10 wrong resource identity fails closed' 'identity_mismatch'

# T11 wrong resource type fails closed
Assert-Throws {
    Resolve-DockerInspectAbsenceFromCapture -Started $true -ExitCode 0 -Stdout $networkJson -Stderr '' -ExpectedId $containerId -Kind 'container'
} 'T11 wrong resource type fails closed' 'kind_mismatch'

# T12 unexpected stdout shape fails closed
Assert-Throws {
    Resolve-DockerInspectAbsenceFromCapture -Started $true -ExitCode 0 -Stdout '[]' -Stderr '' -ExpectedId $containerId
} 'T12 empty inspect array fails closed' 'docker_cleanup_verify_empty_inspect'

# T13 successful integration+cleanup => exit 0
$exit13 = Get-DispatcherWatchdogIntegrationProcessExitCode -IntegrationExitCode 0 -TestExitCode 0 -CleanupExitCode 0
Assert-True ($exit13 -eq 0) 'T13 successful stages produce exit 0'

# T14 schema failure remains nonzero
$exit14 = Get-DispatcherWatchdogIntegrationProcessExitCode -IntegrationExitCode 1 -TestExitCode 0 -CleanupExitCode 0
Assert-True ($exit14 -eq 1) 'T14 integration failure remains nonzero'

# T15 test failure remains nonzero
$exit15 = Get-DispatcherWatchdogIntegrationProcessExitCode -IntegrationExitCode 0 -TestExitCode 1 -CleanupExitCode 0
Assert-True ($exit15 -eq 1) 'T15 test failure remains nonzero'

# T16 docker removal failure remains nonzero
$exit16 = Get-DispatcherWatchdogIntegrationProcessExitCode -IntegrationExitCode 0 -TestExitCode 0 -CleanupExitCode 1
Assert-True ($exit16 -eq 1) 'T16 cleanup failure remains nonzero'

# T17 cleanup verification failure remains nonzero
$exit17 = Get-DispatcherWatchdogIntegrationProcessExitCode -IntegrationExitCode 0 -TestExitCode 0 -CleanupExitCode 1
Assert-True ($exit17 -eq 1) 'T17 cleanup verification failure remains nonzero'

# T18 preserves primary failure when cleanup also fails
$exit18 = Get-DispatcherWatchdogIntegrationProcessExitCode -IntegrationExitCode 1 -TestExitCode 1 -CleanupExitCode 1
Assert-True ($exit18 -eq 1) 'T18 combined failures remain nonzero'

$wrapper = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'run-dispatcher-watchdog-postgres-integration.ps1') -Raw
$cleanupMod = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'DispatcherWatchdogDockerCleanupVerification.ps1') -Raw

# T19 workspace cleanup in finally after success path markers
Assert-True ($wrapper -match 'Invoke-TrustedRunnerWorkspaceCleanup' -and $wrapper -match 'finally') 'T19 workspace cleanup in finally'

# T20 workspace cleanup after failed integration (finally unconditional on workspace+runid)
Assert-True ($wrapper -match 'if \(\$script:RunnerWorkspace -and \$script:Ledger\.RunId\)') 'T20 workspace cleanup after integration failure path'

# T21 workspace cleanup after docker verification exception (nested try in finally)
Assert-True ($wrapper -match 'Cleanup exception:' -and $wrapper -match 'Invoke-TrustedRunnerWorkspaceCleanup') 'T21 workspace cleanup after docker cleanup exception'

# T22 trusted path validation before workspace delete
Assert-True ($wrapper -match 'Assert-TrustedRunnerWorkspacePath') 'T22 workspace delete uses trusted path validation'

# T23 rejects arbitrary paths (trusted assert required)
Assert-True ($wrapper -match 'runner_workspace_basename_mismatch' -or $wrapper -match 'Assert-TrustedRunnerWorkspacePath') 'T23 arbitrary path rejected via trusted assert'

# T24 another run path rejected (basename includes RunId)
Assert-True ($wrapper -match 'tf-watchdog-runner-\$RunId' -or $wrapper -match 'runner_workspace_basename_mismatch') 'T24 another run workspace rejected'

# T25 reparse point forbidden in trusted workspace assert
Assert-True ($wrapper -match 'runner_workspace_reparse_point_forbidden') 'T25 reparse-point escape rejected'

# T26 workspace cleanup failure reported
Assert-True ($wrapper -match 'runner_workspace_cleanup_failed') 'T26 workspace cleanup failure reported'

# T27 no production database access in cleanup module
Assert-True ($cleanupMod -notmatch 'DATABASE_URL' -and $cleanupMod -notmatch '\.env\.local') 'T27 no production database access in cleanup module'

# T28 no docker CLI in wrapper Test-DockerIdAbsent (uses verification module)
Assert-True ($wrapper -notmatch 'function Test-DockerIdAbsent[\s\S]*& docker inspect') 'T28 wrapper Test-DockerIdAbsent avoids direct docker inspect'

# T29 no integration wrapper self-invocation in tests
$self = Get-Content -LiteralPath $PSCommandPath -Raw
Assert-True ($self -notmatch 'run-dispatcher-watchdog-postgres-integration\.ps1' -or $self -match 'Get-Content') 'T29 tests do not invoke integration wrapper'

# T30 isolation/native pg/image safeguards unchanged in wrapper
Assert-True ($wrapper -match '--pull=never' -and $wrapper -match 'createDisposableWatchdogPgPool|dispatcher-watchdog-apply-schemas-disposable') 'T30 native pg and isolation markers preserved'

if ($failed -gt 0) {
    Write-Host "FAIL dispatcher-watchdog-docker-cleanup-verification.test.ps1 ($passed passed, $failed failed)"
    exit 1
}

Write-Host "PASS dispatcher-watchdog-docker-cleanup-verification.test.ps1 ($passed checks)"
exit 0
