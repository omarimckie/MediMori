# Offline regression tests for disposable integration env normalization and redaction.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'DispatcherWatchdogIntegrationEnv.ps1')

$failed = 0

function Assert-True {
    param([bool]$Condition, [string]$Name)
    if (-not $Condition) {
        Write-Host "FAIL: $Name"
        $script:failed++
    }
}

function Assert-Throws {
    param(
        [scriptblock]$ScriptBlock,
        [string]$Pattern,
        [string]$Name
    )
    try {
        & $ScriptBlock
        Write-Host "FAIL: $Name (expected throw matching $Pattern)"
        $script:failed++
    }
    catch {
        $message = $_.Exception.Message
        if ($message -notmatch $Pattern) {
            Write-Host "FAIL: $Name (got '$message')"
            $script:failed++
        }
    }
}

function New-ValidIntegrationEnv {
    param([string]$RunId = 'run-test-1')
    $hostName = "tf-watchdog-pg-$RunId"
    return [pscustomobject]@{
        MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW                 = 'disposable-local-only'
        MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID                = $RunId
        MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST      = $hostName
        MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL           = "postgresql://fake_user:FAKE_PASSWORD_SHOULD_NOT_APPEAR@$hostName:5432/fake_db"
    }
}

$valid = New-ValidIntegrationEnv
$normalized = ConvertTo-DisposableIntegrationEnvHashtable -InputObject $valid
Assert-True ($normalized -is [hashtable]) 'valid PSCustomObject accepted'
Assert-True ($normalized.MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID -eq 'run-test-1') 'run id preserved'

$fromHash = ConvertTo-DisposableIntegrationEnvHashtable -InputObject @{
    MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW            = 'disposable-local-only'
    MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID           = 'run-hash'
    MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST  = 'tf-watchdog-pg-run-hash'
    MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL    = 'postgresql://u:FAKE_SECRET@tf-watchdog-pg-run-hash:5432/db'
}
Assert-True ($fromHash.MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID -eq 'run-hash') 'valid hashtable accepted'

Assert-Throws { ConvertTo-DisposableIntegrationEnvHashtable -InputObject $null } 'integration_env_null' 'null rejected'
Assert-Throws { ConvertTo-DisposableIntegrationEnvHashtable -InputObject 42 } 'integration_env_unsupported_type' 'unsupported type rejected'
Assert-Throws {
    ConvertTo-DisposableIntegrationEnvHashtable -InputObject @{
        MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW           = 'disposable-local-only'
        MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID          = 'run-missing'
        MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST = 'tf-watchdog-pg-run-missing'
    }
} 'integration_env_missing_property' 'missing property rejected'

Assert-Throws {
    $bad = New-ValidIntegrationEnv
    $bad.MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL = ''
    ConvertTo-DisposableIntegrationEnvHashtable -InputObject $bad
} 'integration_env_empty_property' 'incorrect property type rejected'

Assert-Throws {
    ConvertTo-DisposableIntegrationEnvHashtable -InputObject (New-ValidIntegrationEnv -RunId 'bad id')
} 'integration_env_run_id_invalid' 'invalid RUN_ID rejected'

Assert-Throws {
    $bad = New-ValidIntegrationEnv -RunId 'run-mismatch'
    $bad.MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST = 'tf-watchdog-pg-other'
    ConvertTo-DisposableIntegrationEnvHashtable -InputObject $bad
} 'integration_env_expected_host_run_id_mismatch' 'hostname mismatch rejected'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $repoRoot
try {
    $env:MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW = 'disposable-local-only'
    $env:MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID = 'run-neon'
    $env:MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST = 'tf-watchdog-pg-run-neon'
    $env:MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL = 'postgresql://u:FAKE_NEON_SECRET@ep-example.neon.tech/db'
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $neonOutput = & node -e "import { resolveMarketingDispatcherWatchdogTestDatabaseUrl } from './scripts/resolve-marketing-dispatcher-watchdog-test-database-url.mjs'; resolveMarketingDispatcherWatchdogTestDatabaseUrl(process.env);" 2>&1 | Out-String
    $neonExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    Assert-True (($neonExit -ne 0) -and ($neonOutput -match 'dispatcher_watchdog_test_database_url_host_forbidden')) 'production-like hostname rejected by resolver'

    $env:DATABASE_URL = 'postgresql://u:p@ep-example.neon.tech/db'
    $env:MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW = 'disposable-local-only'
    $env:MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID = 'run1'
    $env:MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST = 'tf-watchdog-pg-run1'
    Remove-Item Env:MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL -ErrorAction SilentlyContinue
    $ErrorActionPreference = 'Continue'
    $missingUrlOutput = & node -e "import { resolveMarketingDispatcherWatchdogTestDatabaseUrl } from './scripts/resolve-marketing-dispatcher-watchdog-test-database-url.mjs'; resolveMarketingDispatcherWatchdogTestDatabaseUrl(process.env);" 2>&1 | Out-String
    $missingUrlExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    Assert-True (($missingUrlExit -ne 0) -and ($missingUrlOutput -match 'dispatcher_watchdog_test_database_url_missing')) 'no DATABASE_URL fallback'
}
finally {
    Remove-Item Env:DATABASE_URL, Env:MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW, Env:MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID, Env:MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST, Env:MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL -ErrorAction SilentlyContinue
    Pop-Location
}

Assert-Throws {
    $bad = New-ValidIntegrationEnv
    $bad.MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW = 'yes'
    ConvertTo-DisposableIntegrationEnvHashtable -InputObject $bad
} 'integration_env_allow_invalid' 'missing disposable-only authorization rejected'

Assert-Throws {
    $bad = New-ValidIntegrationEnv
    $bad | Add-Member -NotePropertyName 'DATABASE_URL' -NotePropertyValue 'postgresql://x' -Force
    ConvertTo-DisposableIntegrationEnvHashtable -InputObject $bad
} 'integration_env_unexpected_property' 'unexpected property rejected'

# PSCustomObject no longer fails binding when passed to normalization path used by wrapper.
try {
    [void](ConvertTo-DisposableIntegrationEnvHashtable -InputObject (New-ValidIntegrationEnv))
    Assert-True $true 'PSCustomObject binding path works'
}
catch {
    Assert-True $false 'PSCustomObject binding path works'
}

$leakText = 'Cannot convert value postgresql://user:SUPER_SECRET_PASSWORD@tf-watchdog-pg-run1:5432/db'
$redacted = Redact-IntegrationSensitiveText -Text $leakText -AdditionalSecrets @('SUPER_SECRET_PASSWORD')
Assert-True ($redacted -notmatch 'SUPER_SECRET_PASSWORD') 'password absent from sanitized text'
Assert-True ($redacted -notmatch 'postgresql://user:') 'full credential userinfo absent from sanitized text'
Assert-True ($redacted -match '\[redacted\]') 'non-sensitive diagnostics retained marker'

$stderrSample = 'docker: MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL=postgresql://u:SECRET@host/db'
$stderrRedacted = Redact-IntegrationSensitiveText -Text $stderrSample -AdditionalSecrets @('SECRET')
Assert-True ($stderrRedacted -notmatch 'SECRET') 'password-bearing stderr sanitized'
Assert-True ($stderrRedacted -match 'DATABASE_URL=\[redacted\]') 'env assignment redacted'

function Test-IntegrationEnvBindingOnly {
    param([hashtable]$IntegrationEnv)
    return $IntegrationEnv
}
try {
    Test-IntegrationEnvBindingOnly -IntegrationEnv ([pscustomobject]@{
            MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL = 'postgresql://u:BINDING_SECRET@tf-watchdog-pg-x:5432/db'
        })
}
catch {
    $safeBinding = Get-SafeIntegrationFailureMessage -ErrorRecord $_
}
Assert-True ($safeBinding -eq 'integration_env_parameter_binding_failed') 'parameter binding sanitized'
Assert-True ($safeBinding -notmatch 'BINDING_SECRET') 'binding error hides password'

$runtimeError = Get-SafeIntegrationFailureMessage -ErrorRecord ([System.Management.Automation.ErrorRecord]::new(
    [System.InvalidOperationException]::new('failed at postgresql://u:RUNTIME_SECRET@tf-watchdog-pg-x:5432/db'),
    'x',
    [System.Management.Automation.ErrorCategory]::InvalidOperation,
    $null
))
Assert-True ($runtimeError -notmatch 'RUNTIME_SECRET') 'runtime exception sanitized'
Assert-True ($runtimeError -match 'failed at') 'non-sensitive diagnostics retained'

if ($failed -gt 0) {
    Write-Host "FAILED $failed test(s)"
    exit 1
}

Write-Host "PASS dispatcher-watchdog-integration-env.test.ps1 ($((24)) checks)"
exit 0
