# UTF-8 without BOM writers for Docker inspect JSON capture (Windows PowerShell 5.1 safe).
# Dot-source only — no executable entry point.

Set-StrictMode -Version Latest

function Write-IntegrationUtf8NoBomFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        $Content
    )

    if ($null -eq $Content) {
        throw 'integration_utf8_write_content_null'
    }

    $text = [string]$Content

    $directory = Split-Path -Parent $Path
    if ($directory -and -not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $text, $utf8NoBom)
}

function Write-IntegrationDockerInspectJsonText {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$InspectJsonText
    )

    if ([string]::IsNullOrWhiteSpace($InspectJsonText)) {
        throw 'docker_inspect_output_empty'
    }

    Write-IntegrationUtf8NoBomFile -Path $Path -Content $InspectJsonText
}

function Write-DockerCommandJsonOutputFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string[]]$ArgumentList
    )

    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & docker @ArgumentList 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorAction
    }

    if ($exitCode -ne 0) {
        throw "docker_inspect_command_failed:exit=$exitCode"
    }

    $text = if ($output -is [System.Array]) {
        ($output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
    }
    else {
        [string]$output
    }

    Write-IntegrationDockerInspectJsonText -Path $Path -InspectJsonText $text
}
