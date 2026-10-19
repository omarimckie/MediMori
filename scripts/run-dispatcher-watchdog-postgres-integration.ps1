# Disposable PostgreSQL integration runner for dispatcher watchdog persistence.
# Executable when MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_RUN_AUTHORIZED=execute.
# Do not run without explicit owner authorization.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'DispatcherWatchdogIntegrationEnv.ps1')
. (Join-Path $PSScriptRoot 'DispatcherWatchdogInspectJsonIo.ps1')
. (Join-Path $PSScriptRoot 'DispatcherWatchdogNativeProcessCapture.ps1')
. (Join-Path $PSScriptRoot 'DispatcherWatchdogDockerCleanupVerification.ps1')

$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$script:ExitCode = 0
$script:TestExitCode = 0
$script:CleanupExitCode = 0
$script:CleanupFailures = @()
$script:Ledger = @{
    RunId = $null
    Containers = @()
    Networks = @()
    Volumes = @()
}
$script:LogDir = $null
$script:RunnerWorkspace = $null

function Write-IntegrationLog {
    param([string]$Message)
    $line = "[dispatcher-watchdog-integration] $Message"
    Write-Host $line
    if ($script:LogDir) {
        Add-Content -LiteralPath (Join-Path $script:LogDir 'integration.log') -Value $line
    }
}

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @()
    )
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "native_command_failed:$FilePath:exit=$LASTEXITCODE"
    }
}

function Invoke-Docker {
    param([string[]]$ArgumentList)
    Invoke-NativeCommand -FilePath 'docker' -ArgumentList $ArgumentList
}

function Invoke-Node {
    param([string[]]$ArgumentList)
    Invoke-NativeCommand -FilePath 'node' -ArgumentList $ArgumentList
}

function Get-ResourceNames {
    param([string]$RunId)
    $env:WD_INTEGRATION_RUN_ID = $RunId
    Push-Location $script:RepoRoot
    try {
        $json = Invoke-Node @(
            '-e',
            "import { resourceNamesForRun } from './scripts/dispatcher-watchdog-integration-resources.mjs'; console.log(JSON.stringify(resourceNamesForRun(process.env.WD_INTEGRATION_RUN_ID)));"
        )
    } finally {
        Pop-Location
        Remove-Item Env:WD_INTEGRATION_RUN_ID -ErrorAction SilentlyContinue
    }
    return $json | ConvertFrom-Json
}

function Assert-OwnedResourceName {
    param(
        [string]$RunId,
        [string]$ResourceName,
        [string]$Kind
    )
    $env:WD_INTEGRATION_RUN_ID = $RunId
    $env:WD_INTEGRATION_RESOURCE_NAME = $ResourceName
    $env:WD_INTEGRATION_RESOURCE_KIND = $Kind
    Push-Location $script:RepoRoot
    try {
        Invoke-Node @(
            '-e',
            "import { assertOwnedResourceName } from './scripts/dispatcher-watchdog-integration-resources.mjs'; assertOwnedResourceName(process.env.WD_INTEGRATION_RUN_ID, process.env.WD_INTEGRATION_RESOURCE_NAME, process.env.WD_INTEGRATION_RESOURCE_KIND);"
        ) | Out-Null
    } finally {
        Pop-Location
        Remove-Item Env:WD_INTEGRATION_RUN_ID, Env:WD_INTEGRATION_RESOURCE_NAME, Env:WD_INTEGRATION_RESOURCE_KIND -ErrorAction SilentlyContinue
    }
}

function Test-DockerIdAbsent {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][ValidateSet('container', 'network', 'volume')][string]$Kind
    )
    return Test-DockerResourceAbsent -Id $Id -Kind $Kind
}

function Remove-OwnedDockerResource {
    param(
        [string]$Kind,
        [string]$Id,
        [string]$Name
    )

    Assert-OwnedResourceName -RunId $script:Ledger.RunId -ResourceName $Name -Kind $Kind
    try {
        switch ($Kind) {
            'container' { Invoke-Docker @('rm', '-f', $Id) }
            'network' { Invoke-Docker @('network', 'rm', $Id) }
            'volume' { Invoke-Docker @('volume', 'rm', $Id) }
            default { throw "cleanup_unknown_kind:$Kind" }
        }
    } catch {
        $script:CleanupFailures += "remove_failed:${Kind}:${Name}:${Id}:$($_.Exception.Message)"
        $script:CleanupExitCode = 1
    }
}

function Verify-RunCleanupComplete {
    $remainingContainers = @()
    $remainingNetworks = @()
    $remainingVolumes = @()

    try {
        foreach ($entry in $script:Ledger.Containers) {
            if (-not (Test-DockerIdAbsent -Id $entry.Id -Kind 'container')) {
                $remainingContainers += $entry.Id
            }
        }
        foreach ($entry in $script:Ledger.Networks) {
            if (-not (Test-DockerIdAbsent -Id $entry.Id -Kind 'network')) {
                $remainingNetworks += $entry.Id
            }
        }
        foreach ($entry in $script:Ledger.Volumes) {
            if (-not (Test-DockerIdAbsent -Id $entry.Id -Kind 'volume')) {
                $remainingVolumes += $entry.Id
            }
        }
    }
    catch {
        $safe = Get-SafeIntegrationFailureMessage -ErrorRecord $_
        $script:CleanupFailures += "cleanup_verify_failed:$safe"
        $script:CleanupExitCode = 1
        Write-IntegrationLog "Cleanup verification error: $safe"
        return $false
    }

    if ($remainingContainers.Count -gt 0 -or $remainingNetworks.Count -gt 0 -or $remainingVolumes.Count -gt 0) {
        $payload = @{
            containers = $remainingContainers
            networks = $remainingNetworks
            volumes = $remainingVolumes
        } | ConvertTo-Json -Compress
        $script:CleanupFailures += "cleanup_incomplete:$payload"
        $script:CleanupExitCode = 1
        return $false
    }
    return $true
}

function Invoke-RunCleanup {
    Write-IntegrationLog 'Starting owned-resource cleanup.'
    foreach ($entry in (@($script:Ledger.Containers) | Sort-Object { $_.Name } -Descending)) {
        Remove-OwnedDockerResource -Kind 'container' -Id $entry.Id -Name $entry.Name
    }
    foreach ($entry in $script:Ledger.Networks) {
        Remove-OwnedDockerResource -Kind 'network' -Id $entry.Id -Name $entry.Name
    }
    foreach ($entry in $script:Ledger.Volumes) {
        Remove-OwnedDockerResource -Kind 'volume' -Id $entry.Id -Name $entry.Name
    }
    if (-not (Verify-RunCleanupComplete)) {
        Write-IntegrationLog 'Cleanup verification failed; owned resources remain.'
    } else {
        Write-IntegrationLog 'Cleanup verification succeeded.'
    }
}

function Invoke-TrustedRunnerWorkspaceCleanup {
    param(
        [Parameter(Mandatory = $true)][string]$WorkspacePath,
        [Parameter(Mandatory = $true)][string]$RunId
    )

    if (-not (Test-Path -LiteralPath $WorkspacePath)) {
        Write-IntegrationLog 'Runner workspace already absent; skip cleanup.'
        return
    }

    $trusted = Assert-TrustedRunnerWorkspacePath -WorkspacePath $WorkspacePath -RunId $RunId
    Remove-Item -LiteralPath $trusted -Recurse -Force -ErrorAction Stop
    Write-IntegrationLog 'Runner workspace cleanup succeeded.'
}

function Assert-IntegrationAuthorization {
    if ($env:MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_RUN_AUTHORIZED -ne 'execute') {
        Write-Error @'
Execution blocked: MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_RUN_AUTHORIZED=execute is not set.
See docs/dispatcher-watchdog-postgres-integration.md.
'@
        exit 1
    }
}

function Assert-GitPreflight {
    $env:WD_INTEGRATION_REPO_ROOT = $script:RepoRoot
    Push-Location $script:RepoRoot
    try {
        Invoke-Node @(
            '-e',
            "import { assertGitPreflight } from './scripts/dispatcher-watchdog-integration-wrapper-lib.mjs'; assertGitPreflight();"
        ) | Out-Null
    } finally {
        Pop-Location
        Remove-Item Env:WD_INTEGRATION_REPO_ROOT -ErrorAction SilentlyContinue
    }
}

function Resolve-RunId {
    $fromEnv = $env:MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID
    if (-not $fromEnv) {
        throw 'dispatcher_watchdog_run_id_required_for_integration_wrapper'
    }
    $env:WD_INTEGRATION_RUN_ID = $fromEnv
    Push-Location $script:RepoRoot
    try {
        return (Invoke-Node @(
            '-e',
            "import { validateRunId } from './scripts/dispatcher-watchdog-integration-resources.mjs'; console.log(validateRunId(process.env.WD_INTEGRATION_RUN_ID));"
        )).Trim()
    } finally {
        Pop-Location
        Remove-Item Env:WD_INTEGRATION_RUN_ID -ErrorAction SilentlyContinue
    }
}

function Assert-LocalPinnedImages {
    param(
        [string]$PostgresImage,
        [string]$RunnerImage
    )
    $env:WD_INTEGRATION_POSTGRES_IMAGE = $PostgresImage
    $env:WD_INTEGRATION_RUNNER_IMAGE = $RunnerImage
    Push-Location $script:RepoRoot
    try {
        Invoke-Node @(
            '-e',
            @"
import { assertLocalPinnedIntegrationImages } from './scripts/dispatcher-watchdog-integration-wrapper-lib.mjs';
assertLocalPinnedIntegrationImages(process.env.WD_INTEGRATION_POSTGRES_IMAGE, process.env.WD_INTEGRATION_RUNNER_IMAGE);
"@
        ) | Out-Null
    } finally {
        Pop-Location
        Remove-Item Env:WD_INTEGRATION_POSTGRES_IMAGE, Env:WD_INTEGRATION_RUNNER_IMAGE -ErrorAction SilentlyContinue
    }
}

function Assert-LinuxRunnerStagingReadiness {
    Push-Location $script:RepoRoot
    try {
        Invoke-Node @(
            '-e',
            "import { assertLinuxRunnerStagingReadiness } from './scripts/dispatcher-watchdog-integration-wrapper-lib.mjs'; assertLinuxRunnerStagingReadiness();"
        ) | Out-Null
    } finally {
        Pop-Location
    }
}

function Assert-PinnedImages {
    $pg = $env:MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_POSTGRES_IMAGE
    $runner = $env:MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_RUNNER_IMAGE
    $env:WD_INTEGRATION_POSTGRES_IMAGE = $pg
    $env:WD_INTEGRATION_RUNNER_IMAGE = $runner
    Push-Location $script:RepoRoot
    try {
        Invoke-Node @(
            '-e',
            @"
import { assertPinnedImageReference } from './scripts/dispatcher-watchdog-integration-wrapper-lib.mjs';
assertPinnedImageReference(process.env.WD_INTEGRATION_POSTGRES_IMAGE, 'postgres');
assertPinnedImageReference(process.env.WD_INTEGRATION_RUNNER_IMAGE, 'runner');
"@
        ) | Out-Null
    } finally {
        Pop-Location
        Remove-Item Env:WD_INTEGRATION_POSTGRES_IMAGE, Env:WD_INTEGRATION_RUNNER_IMAGE -ErrorAction SilentlyContinue
    }
    return @{ PostgresImage = $pg.Trim(); RunnerImage = $runner.Trim() }
}

function Assert-OfflineDependencies {
    Push-Location $script:RepoRoot
    try {
        Invoke-Node @(
            '-e',
            "import { assertOfflineRunnerDependencies } from './scripts/dispatcher-watchdog-integration-wrapper-lib.mjs'; assertOfflineRunnerDependencies();"
        ) | Out-Null
    } finally {
        Pop-Location
    }
}

function Assert-TrustedRunnerWorkspacePath {
    param(
        [string]$WorkspacePath,
        [string]$RunId
    )
    $full = [System.IO.Path]::GetFullPath($WorkspacePath)
    $expectedName = "tf-watchdog-runner-$RunId"
    if ([System.IO.Path]::GetFileName($full) -cne $expectedName) {
        throw 'runner_workspace_basename_mismatch'
    }
    $item = Get-Item -LiteralPath $full -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'runner_workspace_reparse_point_forbidden'
    }
    if (-not $item.PSIsContainer) {
        throw 'runner_workspace_not_directory'
    }
    $env:WD_TRUSTED_WORKSPACE = $full
    $env:WD_RUN_ID = $RunId
    Push-Location $script:RepoRoot
    try {
        Invoke-Node @(
            '-e',
            "import { assertTrustedRunnerWorkspaceOnDisk } from './scripts/dispatcher-watchdog-runner-workspace-path.mjs'; assertTrustedRunnerWorkspaceOnDisk(process.env.WD_TRUSTED_WORKSPACE, process.env.WD_RUN_ID);"
        ) | Out-Null
    } finally {
        Pop-Location
        Remove-Item Env:WD_TRUSTED_WORKSPACE, Env:WD_RUN_ID -ErrorAction SilentlyContinue
    }
    return $full
}

function Build-RunnerWorkspace {
    param([string]$RunId)
    $workspace = Join-Path ([System.IO.Path]::GetTempPath()) "tf-watchdog-runner-$RunId"
    if (Test-Path -LiteralPath $workspace) {
        $existingFull = [System.IO.Path]::GetFullPath($workspace)
        if ([System.IO.Path]::GetFileName($existingFull) -cne "tf-watchdog-runner-$RunId") {
            throw 'runner_workspace_existing_basename_mismatch'
        }
        $existingItem = Get-Item -LiteralPath $existingFull -Force
        if ($existingItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw 'runner_workspace_existing_reparse_point_forbidden'
        }
        Remove-Item -LiteralPath $existingFull -Recurse -Force
    }
    New-Item -ItemType Directory -Path $workspace | Out-Null
    Push-Location $script:RepoRoot
    try {
        $env:WD_RUNNER_WORKSPACE = $workspace
        Invoke-Node @(
            '-e',
            "import { prepareRunnerWorkspace } from './scripts/dispatcher-watchdog-integration-wrapper-lib.mjs'; prepareRunnerWorkspace(process.env.WD_RUNNER_WORKSPACE);"
        ) | Out-Null
        Remove-Item Env:WD_RUNNER_WORKSPACE -ErrorAction SilentlyContinue
    } finally {
        Pop-Location
    }
    $resolved = Assert-TrustedRunnerWorkspacePath -WorkspacePath $workspace -RunId $RunId
    $script:RunnerWorkspace = $resolved
    return $resolved
}

function Get-IntegrationTestEnv {
    param(
        [string]$RunId,
        [string]$PgUser,
        [string]$PgPassword,
        [string]$PgDatabase
    )
    $env:WD_INTEGRATION_RUN_ID = $RunId
    $env:WD_INTEGRATION_PG_USER = $PgUser
    $env:WD_INTEGRATION_PG_PASSWORD = $PgPassword
    $env:WD_INTEGRATION_PG_DATABASE = $PgDatabase
    Push-Location $script:RepoRoot
    try {
        $json = Invoke-Node @(
            '-e',
            @"
import { buildDisposableIntegrationEnv } from './scripts/dispatcher-watchdog-integration-wrapper-lib.mjs';
console.log(JSON.stringify(buildDisposableIntegrationEnv({
  runId: process.env.WD_INTEGRATION_RUN_ID,
  pgUser: process.env.WD_INTEGRATION_PG_USER,
  pgPassword: process.env.WD_INTEGRATION_PG_PASSWORD,
  pgDatabase: process.env.WD_INTEGRATION_PG_DATABASE,
})));
"@
        )
        return ConvertTo-DisposableIntegrationEnvHashtable -InputObject ($json | ConvertFrom-Json)
    } finally {
        Pop-Location
        Remove-Item Env:WD_INTEGRATION_RUN_ID, Env:WD_INTEGRATION_PG_USER, Env:WD_INTEGRATION_PG_PASSWORD, Env:WD_INTEGRATION_PG_DATABASE -ErrorAction SilentlyContinue
    }
}

function Register-Container {
    param([string]$Id, [string]$Name)
    $script:Ledger.Containers += @{ Id = $Id; Name = $Name }
}

function Register-Network {
    param([string]$Id, [string]$Name)
    $script:Ledger.Networks += @{ Id = $Id; Name = $Name }
}

function Register-Volume {
    param([string]$Id, [string]$Name)
    $script:Ledger.Volumes += @{ Id = $Id; Name = $Name }
}

function Assert-ContainerIdentity {
    param(
        [string]$InspectJsonPath,
        [string]$ExpectedId,
        [string]$ExpectedName
    )
    $raw = Get-Content -LiteralPath $InspectJsonPath -Raw | ConvertFrom-Json
    if (@($raw).Count -ne 1) {
        throw 'docker_identity_inspect_array_invalid'
    }
    $inspect = $raw[0]
    if ([string]$inspect.Id -ne $ExpectedId) {
        throw 'docker_identity_container_id_mismatch'
    }
    $name = [string]$inspect.Name
    if ($name.StartsWith('/')) { $name = $name.Substring(1) }
    if ($name -ne $ExpectedName) {
        throw 'docker_identity_container_name_mismatch'
    }
}

function Assert-DisposableDatabaseUrl {
    param(
        $IntegrationEnv,
        [string]$ExpectedContainerName
    )
    $IntegrationEnv = ConvertTo-DisposableIntegrationEnvHashtable -InputObject $IntegrationEnv
    $hostName = [string]$IntegrationEnv.MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST
    if ($hostName -ne $ExpectedContainerName) {
        throw 'disposable_pg_host_container_mismatch'
    }
    Push-Location $script:RepoRoot
    try {
        $env:MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW = $IntegrationEnv.MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW
        $env:MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL = $IntegrationEnv.MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL
        $env:MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST = $IntegrationEnv.MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST
        $env:MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID = $IntegrationEnv.MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID
        Invoke-Node @(
            '-e',
            "import { resolveMarketingDispatcherWatchdogTestDatabaseUrl } from './scripts/resolve-marketing-dispatcher-watchdog-test-database-url.mjs'; resolveMarketingDispatcherWatchdogTestDatabaseUrl(process.env);"
        ) | Out-Null
    } finally {
        Pop-Location
    }
}

function Wait-PostgresReady {
    param([string]$ContainerId)
    $deadline = (Get-Date).AddMinutes(3)
    while ((Get-Date) -lt $deadline) {
        & docker exec $ContainerId pg_isready -U $env:MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_PG_USER -d $env:MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_PG_DATABASE 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            return
        }
        Start-Sleep -Seconds 2
    }
    throw 'postgres_readiness_timeout'
}

function Invoke-DisposableIntegrationRun {
    param(
        [string]$RunId,
        [hashtable]$Images,
        $IntegrationEnv
    )

    $IntegrationEnv = ConvertTo-DisposableIntegrationEnvHashtable -InputObject $IntegrationEnv
    $names = Get-ResourceNames -RunId $RunId
    $script:Ledger.RunId = $RunId
    $script:LogDir = Join-Path ([System.IO.Path]::GetTempPath()) "tf-watchdog-logs-$RunId"
    New-Item -ItemType Directory -Path $script:LogDir -Force | Out-Null

    $pgUser = $env:MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_PG_USER.Trim()
    $pgPassword = $env:MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_PG_PASSWORD.Trim()
    $pgDatabase = $env:MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_PG_DATABASE.Trim()
    if (-not $pgUser -or -not $pgPassword -or -not $pgDatabase) {
        throw 'integration_pg_credentials_incomplete'
    }

    $workspace = Build-RunnerWorkspace -RunId $RunId

    Write-IntegrationLog "Creating internal network $($names.network)"
    Invoke-Docker @('network', 'create', '--internal', $names.network)
    $networkId = (docker network inspect $names.network --format '{{.Id}}').Trim()
    if ($LASTEXITCODE -ne 0 -or -not $networkId) { throw 'docker_network_create_failed' }
    Register-Network -Id $networkId -Name $names.network

    $networkInspectPath = Join-Path $script:LogDir 'network.inspect.json'
    Write-DockerCommandJsonOutputFile -Path $networkInspectPath -ArgumentList @('network', 'inspect', $names.network)

    Write-IntegrationLog "Creating postgres container $($names.postgresContainer)"
    Invoke-Docker @(
        'run', '-d',
        '--pull=never',
        '--name', $names.postgresContainer,
        '--network', $names.network,
        '--restart', 'no',
        '-e', "POSTGRES_USER=$pgUser",
        '-e', "POSTGRES_PASSWORD=$pgPassword",
        '-e', "POSTGRES_DB=$pgDatabase",
        '-v', "$($names.volume):/var/lib/postgresql/data",
        $Images.PostgresImage
    )
    $pgContainerId = (docker inspect $names.postgresContainer --format '{{.Id}}').Trim()
    if ($LASTEXITCODE -ne 0 -or -not $pgContainerId) { throw 'docker_postgres_create_failed' }
    Register-Container -Id $pgContainerId -Name $names.postgresContainer
    $volumeId = (docker volume inspect $names.volume --format '{{.Name}}').Trim()
    if ($LASTEXITCODE -eq 0 -and $volumeId) {
        Register-Volume -Id $volumeId -Name $names.volume
    }

    $pgInspectPath = Join-Path $script:LogDir 'postgres.inspect.json'
    Write-DockerCommandJsonOutputFile -Path $pgInspectPath -ArgumentList @('inspect', $names.postgresContainer)

    Push-Location $script:RepoRoot
    try {
        Invoke-Node @(
            (Join-Path $script:RepoRoot 'scripts/dispatcher-watchdog-validate-isolation-cli.mjs'),
            $pgInspectPath,
            $networkInspectPath,
            $names.postgresContainer,
            $names.network,
            '-'
        ) | Out-Null
    } finally {
        Pop-Location
    }

    Assert-ContainerIdentity -InspectJsonPath $pgInspectPath -ExpectedId $pgContainerId -ExpectedName $names.postgresContainer
    Assert-DisposableDatabaseUrl -IntegrationEnv $IntegrationEnv -ExpectedContainerName $names.postgresContainer

    Write-IntegrationLog 'Waiting for disposable PostgreSQL readiness.'
    Wait-PostgresReady -ContainerId $pgContainerId

    Write-IntegrationLog "Starting runner container $($names.runnerContainer)"
    Invoke-Docker @(
        'run', '-d',
        '--pull=never',
        '--name', $names.runnerContainer,
        '--network', $names.network,
        '--restart', 'no',
        '--read-only',
        '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m',
        '-v', "${workspace}:/work:ro",
        '-w', '/work',
        '-e', "MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW=$($IntegrationEnv.MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW)",
        '-e', "MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL=$($IntegrationEnv.MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL)",
        '-e', "MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST=$($IntegrationEnv.MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST)",
        '-e', "MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID=$($IntegrationEnv.MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID)",
        '-e', 'NODE_ENV=test',
        $Images.RunnerImage,
        'sleep', '3600'
    )
    $runnerId = (docker inspect $names.runnerContainer --format '{{.Id}}').Trim()
    if ($LASTEXITCODE -ne 0 -or -not $runnerId) { throw 'docker_runner_create_failed' }
    Register-Container -Id $runnerId -Name $names.runnerContainer

    $runnerInspectPath = Join-Path $script:LogDir 'runner.inspect.json'
    Write-DockerCommandJsonOutputFile -Path $runnerInspectPath -ArgumentList @('inspect', $names.runnerContainer)

    Push-Location $script:RepoRoot
    try {
        Invoke-Node @(
            (Join-Path $script:RepoRoot 'scripts/dispatcher-watchdog-validate-isolation-cli.mjs'),
            $runnerInspectPath,
            $networkInspectPath,
            $names.runnerContainer,
            $names.network,
            $workspace
        ) | Out-Null
    } finally {
        Pop-Location
    }

    $runnerEnvExec = @(
        'exec',
        '-e', "MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW=$($IntegrationEnv.MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW)",
        '-e', "MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL=$($IntegrationEnv.MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL)",
        '-e', "MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST=$($IntegrationEnv.MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST)",
        '-e', "MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID=$($IntegrationEnv.MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID)",
        $names.runnerContainer
    )

    $integrationSecrets = Get-KnownIntegrationSecrets

    Write-IntegrationLog 'Applying disposable schema migrations inside runner.'
    $schemaCapture = Invoke-DisposableIntegrationNativeCapture `
        -Stage 'disposable_schema_apply' `
        -FilePath 'docker' `
        -ArgumentList ($runnerEnvExec + @('node', '/work/scripts/dispatcher-watchdog-apply-schemas-disposable.mjs')) `
        -AdditionalSecrets $integrationSecrets
    Write-DisposableIntegrationStageDiagnostic -CaptureResult $schemaCapture -AdditionalSecrets $integrationSecrets -LogLine ${function:Write-IntegrationLog}
    if (-not $schemaCapture.Started -or $schemaCapture.ExitCode -ne 0) {
        throw 'disposable_schema_apply_failed'
    }

    if ($env:MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_H3_SCHEMA_ONLY -eq 'execute') {
        Write-IntegrationLog 'Executing H3 QStash primary schema integration suite inside runner.'
        $integrationTestArgv = @(
            'node', '--test',
            '/work/scripts/qstash-primary-schema-disposable.integration.test.mjs'
        )
        $integrationTestStage = 'disposable_h3_schema_integration_tests'
    } else {
        Write-IntegrationLog 'Executing PostgreSQL integration suite inside runner.'
        $integrationTestArgv = @(
            'node', '/work/node_modules/tsx/dist/cli.mjs', '--test',
            '/work/src/lib/marketing/reliability/dispatcher-watchdog/dispatcher-watchdog-postgres.integration.test.ts',
            '/work/src/lib/marketing/reliability/qstash-primary/qstash-primary-postgres.integration.test.ts'
        )
        $integrationTestStage = 'disposable_postgres_integration_tests'
    }
    $testCapture = Invoke-DisposableIntegrationNativeCapture `
        -Stage $integrationTestStage `
        -FilePath 'docker' `
        -ArgumentList ($runnerEnvExec + $integrationTestArgv) `
        -AdditionalSecrets $integrationSecrets
    Write-DisposableIntegrationStageDiagnostic -CaptureResult $testCapture -AdditionalSecrets $integrationSecrets -LogLine ${function:Write-IntegrationLog}
    if ($testCapture.Started) {
        $script:TestExitCode = $testCapture.ExitCode
    }
    else {
        $script:TestExitCode = 1
    }
    if ($script:TestExitCode -ne 0) {
        Write-IntegrationLog "Integration tests failed with exit code $script:TestExitCode"
    }
}

try {
    Assert-IntegrationAuthorization
    Assert-GitPreflight
    $runId = Resolve-RunId
    $images = Assert-PinnedImages
    $integrationEnv = Get-IntegrationTestEnv -RunId $runId `
        -PgUser $env:MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_PG_USER `
        -PgPassword $env:MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_PG_PASSWORD `
        -PgDatabase $env:MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_PG_DATABASE

    $names = Get-ResourceNames -RunId $runId
    Assert-DisposableDatabaseUrl -IntegrationEnv $integrationEnv -ExpectedContainerName $names.postgresContainer
    Assert-OfflineDependencies
    Assert-LinuxRunnerStagingReadiness
    Assert-LocalPinnedImages -PostgresImage $images.PostgresImage -RunnerImage $images.RunnerImage

    Invoke-DisposableIntegrationRun -RunId $runId -Images $images -IntegrationEnv $integrationEnv
}
catch {
    $script:ExitCode = 1
    $safeFailure = Get-SafeIntegrationFailureMessage -ErrorRecord $_
    Write-IntegrationLog "Run failed: $safeFailure"
}
finally {
    if ($script:Ledger.RunId) {
        try {
            Invoke-RunCleanup
        }
        catch {
            $script:CleanupExitCode = 1
            $safe = Get-SafeIntegrationFailureMessage -ErrorRecord $_
            $script:CleanupFailures += "cleanup_exception:$safe"
            Write-IntegrationLog "Cleanup exception: $safe"
        }
    }
    if ($script:RunnerWorkspace -and $script:Ledger.RunId) {
        try {
            Invoke-TrustedRunnerWorkspaceCleanup -WorkspacePath $script:RunnerWorkspace -RunId $script:Ledger.RunId
        }
        catch {
            $script:CleanupExitCode = 1
            $safe = Get-SafeIntegrationFailureMessage -ErrorRecord $_
            $script:CleanupFailures += "runner_workspace_cleanup_failed:$safe"
            Write-IntegrationLog "Runner workspace cleanup failed: $safe"
        }
    }
}

if ($script:TestExitCode -ne 0) {
    $script:ExitCode = 1
}
if ($script:CleanupExitCode -ne 0) {
    $script:ExitCode = 1
    foreach ($failure in $script:CleanupFailures) {
        Write-IntegrationLog "Cleanup failure: $failure"
    }
}

$script:ExitCode = Get-DispatcherWatchdogIntegrationProcessExitCode `
    -IntegrationExitCode $script:ExitCode `
    -TestExitCode $script:TestExitCode `
    -CleanupExitCode $script:CleanupExitCode

if ($script:ExitCode -eq 0) {
    Write-IntegrationLog 'Integration run succeeded.'
} else {
    Write-IntegrationLog 'Integration run failed or cleanup incomplete.'
}

exit $script:ExitCode
