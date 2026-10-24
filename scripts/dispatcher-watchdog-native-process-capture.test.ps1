# Offline regression tests for secure native-process diagnostic capture (Windows PowerShell 5.1).
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'DispatcherWatchdogNativeProcessCapture.ps1')

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

function Invoke-CmdCapture {
    param([string[]]$CmdArgs)
    return Invoke-DisposableIntegrationNativeCapture -Stage 'test_stage' -FilePath 'cmd.exe' -ArgumentList $CmdArgs
}

# T1 exit 0 with stdout
$r1 = Invoke-CmdCapture @('/c', 'echo stdout_ok')
Assert-True ($r1.Started -and $r1.ExitCode -eq 0 -and $r1.Stdout -match 'stdout_ok') 'T1 exit 0 with stdout'

# T2 exit 0 with stderr
$r2 = Invoke-CmdCapture @('/c', 'echo stderr_ok 1>&2')
Assert-True ($r2.Started -and $r2.ExitCode -eq 0 -and $r2.Stderr -match 'stderr_ok') 'T2 exit 0 with stderr'

# T3 nonzero with stdout and stderr
$r3 = Invoke-CmdCapture @('/c', 'echo out_fail& echo err_fail 1>&2& exit 7')
Assert-True ($r3.Started -and $r3.ExitCode -eq 7 -and $r3.Stdout -match 'out_fail' -and $r3.Stderr -match 'err_fail') 'T3 nonzero stdout stderr'

# T4 launch failure distinguishable
$r4 = Invoke-DisposableIntegrationNativeCapture -Stage 'test_stage' -FilePath 'tf_watchdog_missing_executable_xyz.exe' -ArgumentList @()
Assert-True ((-not $r4.Started) -and $r4.StartError) 'T4 launch failure distinguishable'

# T5 real exit preserved
Assert-True ($r3.ExitCode -eq 7) 'T5 exit code preserved'

# T6 stale LASTEXITCODE cannot overwrite
$LASTEXITCODE = 0
$r6 = Invoke-CmdCapture @('/c', 'exit 9')
Assert-True ($r6.ExitCode -eq 9) 'T6 stale LASTEXITCODE ignored'

# T7 database URL redacted
$url = 'postgresql://user:SuperSecretPwd@tf-watchdog-pg-run-abc:5432/db'
$s7 = Sanitize-DisposableIntegrationDiagnosticText -Text "failed: $url" -AdditionalSecrets @('SuperSecretPwd')
Assert-True ($s7 -notmatch 'SuperSecretPwd' -and $s7 -match '\[REDACTED_DATABASE_URL\]') 'T7 database URL redacted'

# T8 plaintext password redacted
$s8 = Sanitize-DisposableIntegrationDiagnosticText -Text 'POSTGRES_PASSWORD=plain_secret_value' -AdditionalSecrets @('plain_secret_value')
Assert-True ($s8 -notmatch 'plain_secret_value' -and $s8 -match '\[REDACTED_SECRET\]') 'T8 plaintext password redacted'

# T9 URL-encoded password redacted
$enc = 'p%40ss%3Aword'
$s9 = Sanitize-DisposableIntegrationDiagnosticText -Text "postgresql://u:${enc}@tf-watchdog-pg-x:5432/db" -AdditionalSecrets @($enc)
Assert-True ($s9 -notmatch $enc -and $s9 -match '\[REDACTED') 'T9 encoded password redacted'

# T10 known disposable secret redacted
$secret = 'WdPABCDEF0123456789ABCDEF0123456789'
$s10 = Sanitize-DisposableIntegrationDiagnosticText -Text "error near $secret end" -AdditionalSecrets @($secret)
Assert-True ($s10 -notmatch $secret -and $s10 -match '\[REDACTED_SECRET\]') 'T10 known secret redacted'

# T11 credential argument never logged via diagnostic writer
$script:logLines = @()
$cap11 = [pscustomobject]@{
    Stage = 'disposable_schema_apply'
    Started = $true
    ExitCode = 1
    StartError = $null
    Stdout = ''
    Stderr = '-e MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL=postgresql://u:SECRET11@tf-watchdog-pg-x:5432/db'
    StdoutTruncated = $false
    StderrTruncated = $false
    PersistedTruncated = $false
}
Write-DisposableIntegrationStageDiagnostic -CaptureResult $cap11 -AdditionalSecrets @('SECRET11') -LogLine {
    param($m)
    $script:logLines += $m
}
$joined = ($script:logLines -join "`n")
Assert-True (
    ($joined -notmatch 'SECRET11') -and (
        $joined -match 'REDACTED_DATABASE_URL' -or $joined -match 'REDACTED_SECRET' -or $joined -match 'REDACTED_DIAGNOSTIC'
    )
) 'T11 credential arg redacted in logs'

# T12 ErrorRecord-shaped text redacted
$errText = "ErrorRecord: postgres://leak:LeakPass123@tf-watchdog-pg-x:5432/db"
$s12 = Sanitize-DisposableIntegrationDiagnosticText -Text $errText -AdditionalSecrets @('LeakPass123')
Assert-True ($s12 -notmatch 'LeakPass123') 'T12 ErrorRecord-shaped leak redacted'

# T13 unicode readable after sanitization
$unicodeSample = "safe_prefix_$([char]0x00FC)_unicode_marker"
$s13 = Sanitize-DisposableIntegrationDiagnosticText -Text $unicodeSample -AdditionalSecrets @()
Assert-True ($s13 -match 'unicode_marker' -and $s13 -match 'safe_prefix') 'T13 unicode preserved'

# T14 large stdout bounded
$r14 = Invoke-DisposableIntegrationNativeCapture -Stage 'test_stage' -FilePath 'cmd.exe' -ArgumentList @(
    '/c', 'for /L %i in (1,1,3000) do @echo 01234567890123456789012345678901234567890'
) -MaxStreamBytes 4096
Assert-True ($r14.StdoutTruncated -or $r14.PersistedTruncated -or $r14.Stdout -match 'truncated') 'T14 large stdout bounded'

# T15 large stderr bounded
$r15 = Invoke-DisposableIntegrationNativeCapture -Stage 'test_stage' -FilePath 'cmd.exe' -ArgumentList @(
    '/c', 'for /L %i in (1,1,3000) do @echo err_padding 1>&2'
) -MaxStreamBytes 4096
Assert-True ($r15.StderrTruncated -or $r15.PersistedTruncated -or $r15.Stderr -match 'truncated') 'T15 large stderr bounded'

# T16 truncation reported
Assert-True (
    $r14.StdoutTruncated -or $r14.PersistedTruncated -or ($r14.Stdout -match 'truncated')
) 'T16 truncation reported'

# T17 sanitized path only to disk
$tmp = Join-Path $env:TEMP "tf-watchdog-capture-test-$([guid]::NewGuid().ToString('N')).log"
try {
    $script:diskLines = @()
    $cap17 = Invoke-CmdCapture @('/c', 'echo leak_marker 1>&2')
    $cap17.Stderr = 'postgresql://u:DiskSecret@tf-watchdog-pg-x:5432/db'
    Write-DisposableIntegrationStageDiagnostic -CaptureResult $cap17 -AdditionalSecrets @('DiskSecret') -LogLine {
        param($m)
        $script:diskLines += $m
        Add-Content -LiteralPath $tmp -Value $m
    }
    $disk = Get-Content -LiteralPath $tmp -Raw
    Assert-True ($disk -notmatch 'DiskSecret') 'T17 no raw secret on disk'
}
finally {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
}

# T18 schema failure identifier retained in wrapper source
$wrapper = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'run-dispatcher-watchdog-postgres-integration.ps1') -Raw
Assert-True ($wrapper -match "throw 'disposable_schema_apply_failed'") 'T18 schema failure identifier retained'

# T19 integration test failure identifier retained
Assert-True ($wrapper -match 'Integration tests failed with exit code') 'T19 integration failure identifier retained'

# T20 cleanup/failure flow markers retained
Assert-True ($wrapper -match 'Invoke-RunCleanup' -and $wrapper -match 'Invoke-DisposableIntegrationNativeCapture') 'T20 wrapper flow retained'

if ($failed -gt 0) {
    Write-Host "FAIL dispatcher-watchdog-native-process-capture.test.ps1 ($passed passed, $failed failed)"
    exit 1
}

Write-Host "PASS dispatcher-watchdog-native-process-capture.test.ps1 ($passed checks)"
exit 0
