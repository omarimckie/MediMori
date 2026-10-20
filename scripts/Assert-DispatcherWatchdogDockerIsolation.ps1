# Disposable dispatcher watchdog Docker isolation checks (fail-closed).
# Does not invoke Docker unless -InspectJsonPath is supplied by a future authorized wrapper.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-JsonObjectEmpty {
    param([object]$Value)
    if ($null -eq $Value) { return $true }
    if ($Value -isnot [System.Collections.IDictionary] -and $Value -isnot [pscustomobject]) {
        throw 'docker_isolation_malformed_json_object'
    }
    return @($Value.PSObject.Properties).Count -eq 0
}

function Assert-DispatcherWatchdogNoPortBindings {
    param([object]$PortBindings)
    if ($null -eq $PortBindings) { return }
    if (-not (Test-JsonObjectEmpty $PortBindings)) {
        throw 'docker_isolation_port_bindings_present'
    }
}

function Test-PublishedHostBinding {
    param([object]$Entry)
    if ($null -eq $Entry) { return $false }
    if ($Entry -isnot [System.Array]) { return $true }
    if ($Entry.Count -eq 0) { return $false }
    foreach ($item in $Entry) {
        if ($null -eq $item) { continue }
        if ($item.HostIp -or $item.HostPort) { return $true }
    }
    return $false
}

function Assert-DispatcherWatchdogNoPublishedPorts {
    param([object]$Ports)
    if ($null -eq $Ports) { return }
    foreach ($property in $Ports.PSObject.Properties) {
        if (Test-PublishedHostBinding $property.Value) {
            throw 'docker_isolation_host_ports_published'
        }
    }
}

function Assert-DispatcherWatchdogContainerInspect {
    param(
        [Parameter(Mandatory = $true)][pscustomobject]$Inspect,
        [Parameter(Mandatory = $true)][string]$ExpectedContainerName
    )

    $name = [string]$Inspect.Name
    if ($name.StartsWith('/')) { $name = $name.Substring(1) }
    if ($name -ne $ExpectedContainerName) {
        throw 'docker_isolation_container_name_mismatch'
    }

    if ($Inspect.HostConfig.NetworkMode -eq 'host') {
        throw 'docker_isolation_network_mode_host'
    }
    if ($Inspect.HostConfig.Privileged -eq $true) {
        throw 'docker_isolation_privileged_container'
    }

    if ($Inspect.HostConfig.ExtraHosts -and @($Inspect.HostConfig.ExtraHosts).Count -gt 0) {
        throw 'docker_isolation_extra_hosts_present'
    }

    Assert-DispatcherWatchdogNoPortBindings $Inspect.HostConfig.PortBindings
    Assert-DispatcherWatchdogNoPublishedPorts $Inspect.NetworkSettings.Ports

    $restart = [string]$Inspect.HostConfig.RestartPolicy.Name
    if ($restart -and $restart -ne 'no') {
        throw 'docker_isolation_restart_policy_not_no'
    }

    if ($Inspect.HostConfig.Binds -and @($Inspect.HostConfig.Binds).Count -gt 0) {
        throw 'docker_isolation_host_binds_present'
    }

    foreach ($mount in @($Inspect.Mounts)) {
        if ($mount.Type -eq 'bind') {
            throw 'docker_isolation_bind_mount_present'
        }
        if ([string]$mount.Destination -like '*docker.sock*') {
            throw 'docker_isolation_docker_socket_mount'
        }
    }

    $networks = $Inspect.NetworkSettings.Networks
    if ($null -eq $networks -or (Test-JsonObjectEmpty $networks)) {
        throw 'docker_isolation_no_networks_attached'
    }

    $networkNames = @($networks.PSObject.Properties.Name)
    if ($networkNames.Count -ne 1) {
        throw 'docker_isolation_multiple_networks_attached'
    }

    return $networkNames[0]
}

function Assert-DispatcherWatchdogNetworkInspect {
    param(
        [Parameter(Mandatory = $true)][pscustomobject]$NetworkInspect,
        [Parameter(Mandatory = $true)][string]$ExpectedNetworkName
    )

    if ([string]$NetworkInspect.Name -ne $ExpectedNetworkName) {
        throw 'docker_isolation_network_name_mismatch'
    }
    if ($NetworkInspect.Internal -ne $true) {
        throw 'docker_isolation_network_not_internal'
    }
}

function Assert-DispatcherWatchdogDockerIsolationFromJson {
    param(
        [Parameter(Mandatory = $true)][string]$ContainerInspectJsonPath,
        [Parameter(Mandatory = $true)][string]$NetworkInspectJsonPath,
        [Parameter(Mandatory = $true)][string]$ExpectedContainerName,
        [Parameter(Mandatory = $true)][string]$ExpectedNetworkName
    )

    if (-not (Test-Path -LiteralPath $ContainerInspectJsonPath)) {
        throw 'docker_isolation_container_inspect_missing'
    }
    if (-not (Test-Path -LiteralPath $NetworkInspectJsonPath)) {
        throw 'docker_isolation_network_inspect_missing'
    }

    $containerArray = Get-Content -LiteralPath $ContainerInspectJsonPath -Raw | ConvertFrom-Json
    if (@($containerArray).Count -ne 1) {
        throw 'docker_isolation_inspect_array_invalid'
    }

    $attached = Assert-DispatcherWatchdogContainerInspect -Inspect $containerArray[0] -ExpectedContainerName $ExpectedContainerName
    if ($attached -ne $ExpectedNetworkName) {
        throw 'docker_isolation_unexpected_attached_network'
    }

    $networkArray = Get-Content -LiteralPath $NetworkInspectJsonPath -Raw | ConvertFrom-Json
    if (@($networkArray).Count -ne 1) {
        throw 'docker_isolation_network_inspect_array_invalid'
    }
    Assert-DispatcherWatchdogNetworkInspect -NetworkInspect $networkArray[0] -ExpectedNetworkName $ExpectedNetworkName
}

Export-ModuleMember -Function @(
    'Assert-DispatcherWatchdogNoPortBindings',
    'Assert-DispatcherWatchdogNoPublishedPorts',
    'Assert-DispatcherWatchdogContainerInspect',
    'Assert-DispatcherWatchdogNetworkInspect',
    'Assert-DispatcherWatchdogDockerIsolationFromJson'
)
