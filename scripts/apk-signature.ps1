$ErrorActionPreference = 'Stop'
function Get-ApkSigner {
    $sdk = $env:ANDROID_HOME
    if (!$sdk) { $sdk = $env:ANDROID_SDK_ROOT }
    if (!$sdk) { $sdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
    $signer = Join-Path $sdk 'build-tools/36.0.0/apksigner.bat'
    if (!(Test-Path -LiteralPath $signer)) { throw 'APKSIGNER_MISSING' }
    return $signer
}
function Read-CertificateDigest([string]$Verification) {
    $matches = [regex]::Matches($Verification, '(?m)^Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]{64})\s*$')
    if ($matches.Count -ne 1) { throw 'APK_SIGNER_MISSING_OR_MULTIPLE' }
    return $matches[0].Groups[1].Value.ToUpperInvariant()
}
function Get-ApkCertificate([string]$Path, [switch]$Release) {
    # With manifest minSdk=30 apksigner verifies v3 and can skip a present v2.
    # Expand only the verification range, never the app's installation minSdk.
    $arguments = @('verify', '--verbose', '--print-certs')
    if ($Release) { $arguments += @('--min-sdk-version', '24') }
    try { $result = & (Get-ApkSigner) @arguments $Path 2>&1 }
    catch { throw 'APK_SIGNATURE_INVALID' }
    if ($LASTEXITCODE -ne 0) { throw 'APK_SIGNATURE_INVALID' }
    $verification = $result -join "`n"
    $digest = Read-CertificateDigest $verification
    if ($Release) {
        if ($verification -notmatch 'Verified using v2 scheme[^\r\n]*: true' -or
            $verification -notmatch 'Verified using v3 scheme[^\r\n]*: true') { throw 'RELEASE_V2_V3_REQUIRED' }
        $expected = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '../apps/android/release-certificate.sha256') -Raw).Trim()
        if ($expected -cnotmatch '^[A-F0-9]{64}$' -or $digest -cne $expected) { throw 'RELEASE_CERTIFICATE_MISMATCH' }
    }
    return $digest
}
function Compare-InstalledCertificate([string]$ReleaseApk, [string[]]$AdbArguments = @()) {
    $release = Get-ApkCertificate $ReleaseApk -Release
    $paths = & adb @AdbArguments shell pm path kr.goltou.auto
    if ($LASTEXITCODE -ne 0) { throw 'INSTALLED_PACKAGE_READ_FAILED' }
    $base = @($paths | Where-Object { $_ -match '^package:.*/base\.apk\s*$' })
    if ($base.Count -ne 1) { throw 'INSTALLED_BASE_APK_MISSING_OR_MULTIPLE' }
    $temporary = Join-Path ([IO.Path]::GetTempPath()) ('goltou-installed-' + [Guid]::NewGuid().ToString('N') + '.apk')
    try {
        & adb @AdbArguments pull $base[0].Substring(8).Trim() $temporary *> $null
        if ($LASTEXITCODE -ne 0) { throw 'INSTALLED_APK_READ_FAILED' }
        $installed = Get-ApkCertificate $temporary
        if ($installed -ceq $release) { return 'SAME' }
        return 'DIFFERENT'
    } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary } }
}
