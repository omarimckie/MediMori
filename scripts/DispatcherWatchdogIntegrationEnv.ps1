# Disposable integration environment normalization and credential-safe diagnostics.
# Dot-source only — no executable entry point.

Set-StrictMode -Version Latest

$script:DisposableIntegrationEnvKeys = @(
    'MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW'
    'MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID'
    'MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST'
    'MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL'
)

$script:RunIdPattern = '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$'

function Redact-IntegrationSensitiveText {
    param(
        [AllowNull()][string]$Text,
        [string[]]$AdditionalSecrets = @()
    )

    if ([string]::IsNullOrEmpty($Text)) {
        return ''
    }

    $result = $Text
    $result = [regex]::Replace(
        $result,
        '(?i)(postgresql|postgres)://[^@\s''"]+@',
        '${1}://[redacted]@'
    )
    $result = [regex]::Replace(
        $result,
        '(?i)MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL\s*=\s*[^\s;''"]+',
        'MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL=[redacted]'
    )
    $result = [regex]::Replace(
        $result,
        '(?i)POSTGRES_PASSWORD\s*=\s*[^\s''"]+',
        'POSTGRES_PASSWORD=[redacted]'
    )
    $result = [regex]::Replace(
        $result,
        '(?i)MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_PG_PASSWORD\s*=\s*[^\s''"]+',
        'MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_PG_PASSWORD=[redacted]'
    )

    foreach ($secret in $AdditionalSecrets) {
        if ($secret -and $secret.Length -ge 4) {
            $result = $result.Replace($secret, '[redacted]')
        }
    }

    return $result
}

function Get-KnownIntegrationSecrets {
    $secrets = @()
    foreach ($name in @(
            'MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_PG_PASSWORD'
            'MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL'
        )) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if ($value) {
            $secrets += $value
            if ($name -eq 'MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL' -and $value -match '(?i)^postgres(?:ql)?://([^@]+)@') {
                $userInfo = $Matches[1]
                if ($userInfo -match ':') {
                    $secrets += $userInfo.Split(':', 2)[1]
                }
            }
        }
    }
    return $secrets | Select-Object -Unique
}

function Get-SafeIntegrationFailureMessage {
    param(
        [Parameter(Mandatory = $true)]
        $ErrorRecord
    )

    $exception = $ErrorRecord.Exception
    $exceptionTypeName = $exception.GetType().FullName
    if (
        $exception -is [System.Management.Automation.ParameterBindingException] -or
        $exceptionTypeName -like '*ParameterBinding*'
    ) {
        return 'integration_env_parameter_binding_failed'
    }

    $message = [string]$exception.Message
    if ([string]::IsNullOrWhiteSpace($message)) {
        $message = [string]$ErrorRecord.ToString()
    }

    return Redact-IntegrationSensitiveText -Text $message -AdditionalSecrets (Get-KnownIntegrationSecrets)
}

function ConvertTo-DisposableIntegrationEnvHashtable {
    param(
        $InputObject
    )

    if ($null -eq $InputObject) {
        throw 'integration_env_null'
    }

    $map = @{}

    if ($InputObject -is [hashtable]) {
        foreach ($key in $InputObject.Keys) {
            $map[[string]$key] = $InputObject[$key]
        }
    }
    elseif ($InputObject -is [System.Collections.Specialized.OrderedDictionary]) {
        foreach ($key in $InputObject.Keys) {
            $map[[string]$key] = $InputObject[$key]
        }
    }
    elseif ($InputObject -is [pscustomobject]) {
        foreach ($prop in $InputObject.PSObject.Properties) {
            $map[[string]$prop.Name] = $prop.Value
        }
    }
    else {
        throw 'integration_env_unsupported_type'
    }

    foreach ($required in $script:DisposableIntegrationEnvKeys) {
        if (-not $map.ContainsKey($required)) {
            throw "integration_env_missing_property:$required"
        }
        $value = [string]$map[$required]
        if ([string]::IsNullOrWhiteSpace($value)) {
            throw "integration_env_empty_property:$required"
        }
        $map[$required] = $value.Trim()
    }

    foreach ($key in $map.Keys) {
        if ($script:DisposableIntegrationEnvKeys -notcontains $key) {
            throw "integration_env_unexpected_property:$key"
        }
    }

    if ($map['MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW'] -ne 'disposable-local-only') {
        throw 'integration_env_allow_invalid'
    }

    $runId = $map['MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID']
    if ($runId -notmatch $script:RunIdPattern) {
        throw 'integration_env_run_id_invalid'
    }

    $expectedHost = $map['MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST']
    $canonicalHost = "tf-watchdog-pg-$runId"
    if ($expectedHost -ne $canonicalHost) {
        throw 'integration_env_expected_host_run_id_mismatch'
    }

    if ($map['MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL'] -notmatch '(?i)^postgres(?:ql)?://') {
        throw 'integration_env_database_url_protocol_invalid'
    }

    return $map
}
