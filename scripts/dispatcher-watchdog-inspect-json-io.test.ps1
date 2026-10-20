# Offline regression tests for UTF-8-no-BOM Docker inspect JSON writers.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'DispatcherWatchdogInspectJsonIo.ps1')

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$fixturesDir = Join-Path $repoRoot 'scripts\fixtures\dispatcher-watchdog'
$failed = 0

function Assert-True {
    param([bool]$Condition, [string]$Name)
    if (-not $Condition) {
        Write-Host "FAIL: $Name"
        $script:failed++
    }
}

function Assert-Throws {
    param([scriptblock]$ScriptBlock, [string]$Pattern, [string]$Name)
    try {
        & $ScriptBlock
        Write-Host "FAIL: $Name (expected throw)"
        $script:failed++
    }
    catch {
        if ($_.Exception.Message -notmatch $Pattern) {
            Write-Host "FAIL: $Name (got '$($_.Exception.Message)')"
            $script:failed++
        }
    }
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("tf-watchdog-utf8-" + [guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

try {
    $jsonPath = Join-Path $tempRoot 'sample.json'
    $sample = @'
[
  {
    "Name": "/tf-watchdog-pg-run-abc123",
    "unicode": "cafe-u00e9",
    "nested": { "ports": { "5432/tcp": null } }
  }
]
'@
    Write-IntegrationUtf8NoBomFile -Path $jsonPath -Content $sample
    Assert-True (Test-Path -LiteralPath $jsonPath) 'JSON file is created successfully'

    $bytes = [System.IO.File]::ReadAllBytes($jsonPath)
    $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    Assert-True (-not $hasBom) 'First bytes are not EF BB BF'

    $text = [System.IO.File]::ReadAllText($jsonPath, (New-Object System.Text.UTF8Encoding($false)))
    Assert-True ($text.TrimStart().StartsWith('[')) 'File begins with expected JSON syntax'

    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $parseOutput = & node -e "const fs=require('fs'); JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log('parse_ok');" $jsonPath 2>&1 | Out-String
    $parseExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    Assert-True (($parseExit -eq 0) -and ($parseOutput -match 'parse_ok')) 'JSON.parse accepts the generated file'

    $parsed = $text | ConvertFrom-Json
    Assert-True ($parsed.Count -eq 1) 'Valid JSON structure is preserved'
    Assert-True ($parsed[0].unicode -eq 'cafe-u00e9') 'Unicode-oriented content is preserved'
    $portNames = @($parsed[0].nested.ports.PSObject.Properties.Name)
    Assert-True ($portNames -contains '5432/tcp') 'Nested arrays and objects are preserved'

    Assert-Throws {
        Write-IntegrationUtf8NoBomFile -Path (Join-Path $tempRoot 'null.json') -Content $null
    } 'integration_utf8_write_content_null' 'Null content rejected'

    Assert-Throws {
        Write-IntegrationDockerInspectJsonText -Path (Join-Path $tempRoot 'empty.json') -InspectJsonText '   '
    } 'docker_inspect_output_empty' 'Empty inspect output rejected'

    $badJsonPath = Join-Path $tempRoot 'bad.json'
    Write-IntegrationUtf8NoBomFile -Path $badJsonPath -Content 'not-json'
    $ErrorActionPreference = 'Continue'
    & node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));" $badJsonPath 2>&1 | Out-Null
    $badParseExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    Assert-True ($badParseExit -ne 0) 'Malformed JSON is not silently accepted by parser'

    Assert-Throws {
        Write-DockerCommandJsonOutputFile -Path (Join-Path $tempRoot 'missing-container.json') -ArgumentList @(
            'inspect',
            'tf-watchdog-nonexistent-container-for-offline-test'
        )
    } 'docker_inspect_command_failed' 'Native command failure is not treated as success'

    try {
        Write-DockerCommandJsonOutputFile -Path (Join-Path $tempRoot 'missing-container.json') -ArgumentList @(
            'inspect',
            'tf-watchdog-nonexistent-container-for-offline-test'
        )
    }
    catch {
        Assert-True ($_.Exception.Message -notmatch 'postgresql://') 'No credentials in docker inspect failure messages'
    }

    $containerFixture = Get-Content -LiteralPath (Join-Path $fixturesDir 'docker-inspect-isolated.json') -Raw -Encoding UTF8
    $networkFixture = Get-Content -LiteralPath (Join-Path $fixturesDir 'docker-network-internal.json') -Raw -Encoding UTF8
    $containerPath = Join-Path $tempRoot 'container.inspect.json'
    $networkPath = Join-Path $tempRoot 'network.inspect.json'
    Write-IntegrationUtf8NoBomFile -Path $containerPath -Content $containerFixture
    Write-IntegrationUtf8NoBomFile -Path $networkPath -Content $networkFixture

    $ErrorActionPreference = 'Continue'
    $isoOutput = & node (Join-Path $repoRoot 'scripts\dispatcher-watchdog-validate-isolation-cli.mjs') $containerPath $networkPath 'tf-watchdog-pg-run-abc123' 'tf-watchdog-net-run-abc123' '-' 2>&1 | Out-String
    $isoExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    Assert-True (($isoExit -eq 0) -and ($isoOutput -match 'docker_isolation_ok')) 'Existing Node validator accepts BOM-free fixture output'

    $publishedFixture = Get-Content -LiteralPath (Join-Path $fixturesDir 'docker-inspect-published-port.json') -Raw -Encoding UTF8
    $publishedPath = Join-Path $tempRoot 'published.inspect.json'
    Write-IntegrationUtf8NoBomFile -Path $publishedPath -Content $publishedFixture
    $ErrorActionPreference = 'Continue'
    $badOutput = & node (Join-Path $repoRoot 'scripts\dispatcher-watchdog-validate-isolation-cli.mjs') $publishedPath $networkPath 'tf-watchdog-pg-run-abc123' 'tf-watchdog-net-run-abc123' '-' 2>&1 | Out-String
    $badExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    Assert-True (($badExit -ne 0) -and ($badOutput -match 'docker_isolation')) 'Unsafe published-port fixture rejected'

    $wrongNamePath = Join-Path $tempRoot 'wrong-name.inspect.json'
    Write-IntegrationUtf8NoBomFile -Path $wrongNamePath -Content $containerFixture
    $ErrorActionPreference = 'Continue'
    $nameOutput = & node (Join-Path $repoRoot 'scripts\dispatcher-watchdog-validate-isolation-cli.mjs') $wrongNamePath $networkPath 'tf-watchdog-pg-wrong' 'tf-watchdog-net-run-abc123' '-' 2>&1 | Out-String
    $nameExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    Assert-True (($nameExit -ne 0) -and ($nameOutput -match 'docker_isolation')) 'Incorrect container identity rejected'

    $externalNetworkFixture = '[{"Name":"tf-watchdog-net-run-abc123","Internal":false,"Driver":"bridge"}]'
    $externalNetworkPath = Join-Path $tempRoot 'external-network.inspect.json'
    Write-IntegrationUtf8NoBomFile -Path $externalNetworkPath -Content $externalNetworkFixture
    $ErrorActionPreference = 'Continue'
    $netOutput = & node (Join-Path $repoRoot 'scripts\dispatcher-watchdog-validate-isolation-cli.mjs') $containerPath $externalNetworkPath 'tf-watchdog-pg-run-abc123' 'tf-watchdog-net-run-abc123' '-' 2>&1 | Out-String
    $netExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    Assert-True (($netExit -ne 0) -and ($netOutput -match 'docker_isolation')) 'Non-internal network rejected'

    Assert-True ($PSVersionTable.PSEdition -eq 'Desktop' -or $PSVersionTable.PSEdition -eq 'Core') 'Windows PowerShell 5.1 compatibility path exercised'
}
finally {
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if ($failed -gt 0) {
    Write-Host "FAILED $failed test(s)"
    exit 1
}

Write-Host 'PASS dispatcher-watchdog-inspect-json-io.test.ps1'
exit 0
