# Secure native-process stdout/stderr capture for disposable integration stages (Windows PowerShell 5.1).
# Dot-source only — no executable entry point.

Set-StrictMode -Version Latest

$script:DefaultMaxStreamBytes = 65536
$script:DefaultMaxLineLength = 4096
$script:DefaultMaxPersistedChars = 32768

function ConvertTo-NativeProcessArgumentString {
    param([string[]]$ArgumentList)

    $parts = @()
    foreach ($arg in $ArgumentList) {
        if ($null -eq $arg) {
            $parts += '""'
            continue
        }
        if ($arg -notmatch '[\s"]') {
            $parts += $arg
        }
        else {
            $parts += '"' + ($arg -replace '(\\*)("|$)', '$1\$2') + '"'
        }
    }
    return ($parts -join ' ')
}

function Sanitize-DisposableIntegrationDiagnosticText {
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
        '(?i)-e\s+MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL=[^\s]+',
        '-e MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL=[REDACTED_SECRET]'
    )
    $result = [regex]::Replace(
        $result,
        '(?i)postgres(?:ql)?://[^\s''"]+',
        '[REDACTED_DATABASE_URL]'
    )
    $result = [regex]::Replace(
        $result,
        '(?i)MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL\s*=\s*[^\s;''"]+',
        'MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL=[REDACTED_SECRET]'
    )
    $result = [regex]::Replace(
        $result,
        '(?i)POSTGRES_PASSWORD\s*=\s*[^\s''"]+',
        'POSTGRES_PASSWORD=[REDACTED_SECRET]'
    )
    $result = [regex]::Replace(
        $result,
        '(?i)MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_PG_PASSWORD\s*=\s*[^\s''"]+',
        'MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_PG_PASSWORD=[REDACTED_SECRET]'
    )
    $result = [regex]::Replace(
        $result,
        '(?i)-e\s+MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL=[^\s]+',
        '-e MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL=[REDACTED_SECRET]'
    )

    foreach ($secret in $AdditionalSecrets) {
        if ($secret -and $secret.Length -ge 4) {
            $result = $result.Replace($secret, '[REDACTED_SECRET]')
        }
    }

    if ($result -match '(?i)postgres(?:ql)?://') {
        return '[REDACTED_DIAGNOSTIC_FRAGMENT]'
    }
    foreach ($secret in $AdditionalSecrets) {
        if ($secret -and $secret.Length -ge 4 -and $result.Contains($secret)) {
            return '[REDACTED_DIAGNOSTIC_FRAGMENT]'
        }
    }

    return $result
}

function Limit-DisposableIntegrationDiagnosticText {
    param(
        [string]$Text,
        [int]$MaxChars,
        [ref]$TruncatedFlag
    )

    if ([string]::IsNullOrEmpty($Text)) {
        return ''
    }

    $lines = $Text -split "`r?`n", -1
    $builder = New-Object System.Text.StringBuilder
    $total = 0
    foreach ($line in $lines) {
        $safeLine = $line
        if ($safeLine.Length -gt $script:DefaultMaxLineLength) {
            $safeLine = $safeLine.Substring(0, $script:DefaultMaxLineLength) + '...[line_truncated]'
            $TruncatedFlag.Value = $true
        }
        $segment = if ($builder.Length -eq 0) { $safeLine } else { "`n$safeLine" }
        if ($total + $segment.Length -gt $MaxChars) {
            $TruncatedFlag.Value = $true
            [void]$builder.Append('...[output_truncated]')
            break
        }
        [void]$builder.Append($segment)
        $total += $segment.Length
    }
    return $builder.ToString()
}

function Invoke-DisposableIntegrationNativeCapture {
    param(
        [Parameter(Mandatory = $true)][string]$Stage,
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [string[]]$AdditionalSecrets = @(),
        [int]$MaxStreamBytes = $script:DefaultMaxStreamBytes,
        [int]$MaxPersistedChars = $script:DefaultMaxPersistedChars
    )

    $result = [ordered]@{
        Stage               = $Stage
        FilePath            = $FilePath
        Started             = $false
        StartError          = $null
        ExitCode            = $null
        Stdout              = ''
        Stderr              = ''
        StdoutTruncated     = $false
        StderrTruncated     = $false
        PersistedTruncated  = $false
    }

    $stdoutTruncated = $false
    $stderrTruncated = $false
    $process = $null

    try {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $FilePath
        $psi.Arguments = ConvertTo-NativeProcessArgumentString -ArgumentList $ArgumentList
        $psi.UseShellExecute = $false
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.CreateNoWindow = $true
        $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
        $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8

        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = $psi

        try {
            $null = $process.Start()
        }
        catch {
            $result.StartError = Sanitize-DisposableIntegrationDiagnosticText -Text $_.Exception.Message -AdditionalSecrets $AdditionalSecrets
            return [pscustomobject]$result
        }

        $result.Started = $true
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $result.ExitCode = $process.ExitCode

        $stdoutRaw = $stdoutTask.GetAwaiter().GetResult()
        $stderrRaw = $stderrTask.GetAwaiter().GetResult()
        if ([System.Text.Encoding]::UTF8.GetByteCount($stdoutRaw) -gt $MaxStreamBytes) {
            $stdoutTruncated = $true
            $stdoutRaw = [System.Text.Encoding]::UTF8.GetString(
                [System.Text.Encoding]::UTF8.GetBytes($stdoutRaw), 0, $MaxStreamBytes
            ) + '...[stream_truncated]'
        }
        if ([System.Text.Encoding]::UTF8.GetByteCount($stderrRaw) -gt $MaxStreamBytes) {
            $stderrTruncated = $true
            $stderrRaw = [System.Text.Encoding]::UTF8.GetString(
                [System.Text.Encoding]::UTF8.GetBytes($stderrRaw), 0, $MaxStreamBytes
            ) + '...[stream_truncated]'
        }
    }
    finally {
        if ($null -ne $process) {
            $process.Dispose()
        }
    }

    if (-not $result.Started) {
        if (-not $result.StartError) {
            $result.StartError = 'native_process_start_returned_false'
        }
        return [pscustomobject]$result
    }
    $persistTrunc = $false
    $stdoutSan = Limit-DisposableIntegrationDiagnosticText -Text (
        Sanitize-DisposableIntegrationDiagnosticText -Text $stdoutRaw -AdditionalSecrets $AdditionalSecrets
    ) -MaxChars $MaxPersistedChars -TruncatedFlag ([ref]$persistTrunc)
    $stderrSan = Limit-DisposableIntegrationDiagnosticText -Text (
        Sanitize-DisposableIntegrationDiagnosticText -Text $stderrRaw -AdditionalSecrets $AdditionalSecrets
    ) -MaxChars $MaxPersistedChars -TruncatedFlag ([ref]$persistTrunc)

    $result.Stdout = $stdoutSan
    $result.Stderr = $stderrSan
    $result.StdoutTruncated = $stdoutTruncated
    $result.StderrTruncated = $stderrTruncated
    $result.PersistedTruncated = $persistTrunc
    return [pscustomobject]$result
}

function Write-DisposableIntegrationStageDiagnostic {
    param(
        [Parameter(Mandatory = $true)]
        $CaptureResult,
        [Parameter(Mandatory = $true)]
        [scriptblock]$LogLine,
        [string[]]$AdditionalSecrets = @()
    )

    $stage = [string]$CaptureResult.Stage
    $exit = if ($null -eq $CaptureResult.ExitCode) { 'n/a' } else { [string]$CaptureResult.ExitCode }
    $started = if ($CaptureResult.Started) { 'true' } else { 'false' }
    $flags = @()
    if ($CaptureResult.StdoutTruncated) { $flags += 'stdout_captured_truncated' }
    if ($CaptureResult.StderrTruncated) { $flags += 'stderr_captured_truncated' }
    if ($CaptureResult.PersistedTruncated) { $flags += 'persisted_truncated' }
    $flagText = if ($flags.Count -gt 0) { ($flags -join ',') } else { 'none' }

    & $LogLine "diagnostic stage=$stage started=$started exit=$exit truncation=$flagText"
    if ($CaptureResult.StartError) {
        & $LogLine "diagnostic stage=$stage start_error=$($CaptureResult.StartError)"
    }
    if ($CaptureResult.Stdout) {
        & $LogLine "diagnostic stage=$stage stdout_begin"
        foreach ($line in ($CaptureResult.Stdout -split "`n")) {
            if ($line) {
                $safe = Sanitize-DisposableIntegrationDiagnosticText -Text $line -AdditionalSecrets $AdditionalSecrets
                & $LogLine "diagnostic stdout: $safe"
            }
        }
        & $LogLine "diagnostic stage=$stage stdout_end"
    }
    if ($CaptureResult.Stderr) {
        & $LogLine "diagnostic stage=$stage stderr_begin"
        foreach ($line in ($CaptureResult.Stderr -split "`n")) {
            if ($line) {
                $safe = Sanitize-DisposableIntegrationDiagnosticText -Text $line -AdditionalSecrets $AdditionalSecrets
                & $LogLine "diagnostic stderr: $safe"
            }
        }
        & $LogLine "diagnostic stage=$stage stderr_end"
    }
}
