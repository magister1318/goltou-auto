param([string]$Device, [switch]$VerifyOnly)
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
    Invoke-Checked 'pnpm.cmd' @('install', '--frozen-lockfile')
    Assert-Source
    Invoke-Checked 'pnpm.cmd' @('typecheck')
    Invoke-Checked 'pnpm.cmd' @('test')
    Invoke-Checked 'node' @('scripts/check-embedded-compat.mjs', '--sources')
    Invoke-Checked 'pnpm.cmd' @('build')
    Assert-Source
    Push-Location (Join-Path $root 'apps/android')
    try { Invoke-Checked '.\gradlew.bat' @('assembleDebug', '--console=plain') } finally { Pop-Location }
    Assert-Source
    # Inspect and install the same immutable snapshot, not a rebuildable output.
    $snapshot = Join-Path ([IO.Path]::GetTempPath()) ('goltou-verified-' + [Guid]::NewGuid().ToString('N') + '.apk')
    try {
        Copy-Item -LiteralPath 'apps/android/app/build/outputs/apk/debug/app-debug.apk' -Destination $snapshot
        & (Join-Path $PSScriptRoot 'check-apk-compat.ps1') -Apk $snapshot -ExpectedCommit $script:checkedCommit
        $apkHash = Get-ApkHash $snapshot
        Assert-Source
        if (!$VerifyOnly) {
            $adbArguments = @()
            if ($Device) { $adbArguments += @('-s', $Device) }
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
        Write-Output ('INSTALL_GATE_PASSED COMMIT=' + $script:checkedCommit + ' APK_SHA256=' + $apkHash + ' INSTALLED=' + (!$VerifyOnly))
    } finally { if ($snapshot -and (Test-Path -LiteralPath $snapshot)) { Remove-Item -LiteralPath $snapshot } }
} finally { Pop-Location }
