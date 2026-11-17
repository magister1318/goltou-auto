param([string]$Device, [switch]$VerifyOnly,
      [ValidateSet('debug','release')][string]$Variant = 'debug', [string]$ArtifactDirectory)
$ErrorActionPreference = 'Stop'
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'never'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location $root
function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw ('INSTALL_GATE_COMMAND_FAILED:' + $Program) }
}
function Assert-Source {
    $head = & git rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $head -cne $script:checkedCommit) { throw 'INSTALL_GATE_COMMIT_CHANGED' }
    $changes = & git status --porcelain --untracked-files=normal
    if ($LASTEXITCODE -ne 0 -or $changes) { throw 'INSTALL_GATE_REQUIRES_CLEAN_COMMIT' }
}
function Get-ApkHash([string]$Path) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}
try {
    $script:checkedCommit = & git rev-parse HEAD
    Assert-Source
    Invoke-Checked 'node' @('scripts/check-signing-secrets.mjs')
    Invoke-Checked 'pnpm.cmd' @('install', '--frozen-lockfile')
    Assert-Source
    Invoke-Checked 'pnpm.cmd' @('typecheck')
    New-Item -ItemType Directory -Path (Join-Path $root 'tmp') -Force | Out-Null
    $testReport = Join-Path $root ('tmp/install-gate-tests-' + [Guid]::NewGuid().ToString('N') + '.json')
    try {
        Invoke-Checked 'pnpm.cmd' @('test', '--reporter=default', '--reporter=json', ('--outputFile=' + $testReport))
        # Node reads Vitest's UTF-8 JSON without Windows PowerShell's ANSI decoding.
        Invoke-Checked 'node' @('scripts/check-test-report.mjs', $testReport)
    } finally { if (Test-Path -LiteralPath $testReport) { Remove-Item -LiteralPath $testReport } }
    Invoke-Checked 'node' @('scripts/check-embedded-compat.mjs', '--sources')
    Invoke-Checked 'pnpm.cmd' @('build')
    Assert-Source
    Push-Location (Join-Path $root 'apps/android')
    try {
        $task = if ($Variant -eq 'release') { 'assembleRelease' } else { 'assembleDebug' }
        Invoke-Checked '.\gradlew.bat' @($task, '--console=plain')
    } finally { Pop-Location }
    Assert-Source
    # Inspect and install the same immutable snapshot, not a rebuildable output.
    $snapshot = Join-Path ([IO.Path]::GetTempPath()) ('goltou-verified-' + [Guid]::NewGuid().ToString('N') + '.apk')
    try {
        Copy-Item -LiteralPath ("apps/android/app/build/outputs/apk/$Variant/app-$Variant.apk") -Destination $snapshot
        & (Join-Path $PSScriptRoot 'check-apk-compat.ps1') -Apk $snapshot -ExpectedCommit $script:checkedCommit -Variant $Variant
        $apkHash = Get-ApkHash $snapshot
        Assert-Source
        if (!$VerifyOnly) {
            $adbArguments = @()
            if ($Device) { $adbArguments += @('-s', $Device) }
            if ($Variant -eq 'release') {
                . (Join-Path $PSScriptRoot 'apk-signature.ps1')
                $comparison = Compare-InstalledCertificate $snapshot $adbArguments
                Write-Output ('INSTALLED_CERT_VS_RELEASE=' + $comparison)
                if ($comparison -cne 'SAME') { throw 'SIGNATURE_DIFFERENT_INSTALL_FORBIDDEN_DATA_MUST_BE_PRESERVED' }
            }
            $power = & adb @adbArguments shell dumpsys power
            if ($LASTEXITCODE -ne 0 -or ($power -join "`n") -notmatch 'mWakefulness=Awake') { throw 'DEVICE_ASLEEP_OR_UNAVAILABLE' }
            $policy = & adb @adbArguments shell dumpsys window policy
            if ($LASTEXITCODE -ne 0 -or ($policy -join "`n") -notmatch 'showing=false') { throw 'DEVICE_LOCKED_OR_UNAVAILABLE' }
            $window = & adb @adbArguments shell dumpsys window
            if ($LASTEXITCODE -ne 0 -or ($window -join "`n") -notmatch 'mCurrentFocus=Window\{[^\n]*kr\.goltou\.auto/kr\.goltou\.auto\.MainActivity') { throw 'DEVICE_APP_NOT_FOCUSED' }
            Assert-Source
            if ((Get-ApkHash $snapshot) -cne $apkHash) { throw 'INSTALL_GATE_APK_CHANGED' }
            Invoke-Checked 'adb' ($adbArguments + @('install', '-r', $snapshot))
        }
        if ($ArtifactDirectory) {
            $destination = [IO.Path]::GetFullPath($ArtifactDirectory)
            if ($destination.Equals($root, [StringComparison]::OrdinalIgnoreCase) -or $destination.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'ARTIFACT_DIRECTORY_MUST_BE_EXTERNAL' }
            New-Item -ItemType Directory -Path $destination -Force | Out-Null
            $version = ConvertFrom-StringData (Get-Content 'apps/android/version.properties' -Raw)
            $name = 'goltou-auto-' + $version.versionName + '-' + $version.versionCode + '-' + $Variant + '.apk'
            $artifact = Join-Path $destination $name
            Copy-Item -LiteralPath $snapshot -Destination $artifact -Force
            if ((Get-ApkHash $artifact) -cne $apkHash) { throw 'ARTIFACT_COPY_HASH_MISMATCH' }
            [IO.File]::WriteAllText(($artifact + '.sha256'), ($apkHash.ToLowerInvariant() + '  ' + $name + "`n"), [Text.Encoding]::ASCII)
            Write-Output ('VERIFIED_ARTIFACT=' + $artifact)
        }
        Write-Output ('INSTALL_GATE_PASSED COMMIT=' + $script:checkedCommit + ' APK_SHA256=' + $apkHash + ' INSTALLED=' + (!$VerifyOnly))
    } finally { if ($snapshot -and (Test-Path -LiteralPath $snapshot)) { Remove-Item -LiteralPath $snapshot } }
} finally { Pop-Location }
