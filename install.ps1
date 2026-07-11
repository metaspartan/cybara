#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Version = $(if ($env:CYBARA_VERSION) { $env:CYBARA_VERSION } else { "latest" }),
    [string]$Repo = $(if ($env:CYBARA_RELEASE_REPOSITORY) { $env:CYBARA_RELEASE_REPOSITORY } else { "metaspartan/cybara" }),
    [string]$InstallDir = $(if ($env:CYBARA_INSTALL_DIR) { $env:CYBARA_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "Programs\cybara" })
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Get-ReleaseArch {
    $arch = $env:PROCESSOR_ARCHITECTURE
    if ($env:PROCESSOR_ARCHITEW6432) { $arch = $env:PROCESSOR_ARCHITEW6432 }
    switch ($arch) {
        "ARM64" { return "arm64" }
        "AMD64" { return "x64" }
        default { throw "Unsupported architecture: $arch" }
    }
}

$releaseArch = Get-ReleaseArch

if ($Version -eq "latest") {
    $apiUrl = "https://api.github.com/repos/$Repo/releases/latest"
} else {
    $tag = $Version.TrimStart("v")
    $apiUrl = "https://api.github.com/repos/$Repo/releases/tags/v$tag"
}

Write-Host "Resolving Cybara release ($Version) from $Repo..."
$release = Invoke-RestMethod -Uri $apiUrl -Headers @{ "User-Agent" = "cybara-install" }
$tagName = $release.tag_name

function Find-Asset([string]$suffix) {
    return $release.assets | Where-Object { $_.name -like "*$suffix" } | Select-Object -First 1
}

$suffix = "-windows-$releaseArch-cli.exe"
$asset = Find-Asset $suffix
if (-not $asset -and $releaseArch -eq "arm64") {
    Write-Host "No native arm64 build in $tagName; using x64 (runs under Windows emulation)."
    $suffix = "-windows-x64-cli.exe"
    $asset = Find-Asset $suffix
}
if (-not $asset) {
    throw "Could not find a Windows CLI asset (*$suffix) in $Repo $tagName."
}

$checksumAsset = $release.assets | Where-Object { $_.name -eq "$($asset.name).sha256" } | Select-Object -First 1

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$tmpFile = Join-Path ([IO.Path]::GetTempPath()) ("cybara-install-" + [IO.Path]::GetRandomFileName() + ".exe")

Write-Host "Downloading $($asset.name) ($tagName)..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tmpFile -UseBasicParsing

if ($checksumAsset) {
    $expected = ((Invoke-WebRequest -Uri $checksumAsset.browser_download_url -UseBasicParsing).Content)
    if ($expected -is [byte[]]) { $expected = [Text.Encoding]::UTF8.GetString($expected) }
    $expected = ($expected -split "\s+")[0].ToLowerInvariant()
    $actual = (Get-FileHash -Path $tmpFile -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
        Remove-Item -Force $tmpFile
        throw "Checksum verification FAILED - the downloaded asset is corrupted or tampered.`nExpected: $expected`nActual:   $actual"
    }
    Write-Host "Checksum verified."
} else {
    Write-Warning "No SHA256 sidecar found for $($asset.name); installing unverified."
}

$target = Join-Path $InstallDir "cybara.exe"
Move-Item -Force $tmpFile $target
Write-Host "Installed cybara to $target"

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (($userPath -split ";") -notcontains $InstallDir) {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$InstallDir", "User")
    $env:Path = "$env:Path;$InstallDir"
    Write-Host "Added $InstallDir to your user PATH (restart existing terminals to pick it up)."
}

Write-Host ""
Write-Host "Cybara $tagName installed. Get started with:"
Write-Host "  cybara start"
