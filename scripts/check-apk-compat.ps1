param([Parameter(Mandatory=$true)][string]$Apk, [Parameter(Mandatory=$true)][string]$ExpectedCommit)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('goltou-apk-check-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
    $zip = [IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($Apk))
    try {
        foreach ($name in @('core.cjs', 'engine.cjs', 'manifest.json')) {
            $entries = @($zip.Entries | Where-Object { $_.FullName -ceq ('assets/bundle/' + $name) })
            if ($entries.Count -ne 1) { throw 'APK_BUNDLE_MISSING_OR_AMBIGUOUS' }
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entries[0], (Join-Path $temporary $name))
        }
    } finally { $zip.Dispose() }
    $manifest = Get-Content -LiteralPath (Join-Path $temporary 'manifest.json') -Raw | ConvertFrom-Json
    if ($ExpectedCommit -cnotmatch '^[a-f0-9]{40}$' -or $manifest.sourceCommit -cne $ExpectedCommit) { throw 'APK_COMMIT_MISMATCH' }
    & node (Join-Path $PSScriptRoot 'check-embedded-compat.mjs') (Join-Path $temporary 'core.cjs') (Join-Path $temporary 'engine.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'APK_EMBEDDED_COMPAT_FAILED' }
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead([IO.Path]::GetFullPath($Apk))
    try { $hash = [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $algorithm.Dispose() }
    Write-Output ('APK_COMPAT_PASSED SHA256=' + $hash)
} finally {
    # Only these fixed files in our freshly created directory are removed.
    foreach ($name in @('core.cjs', 'engine.cjs', 'manifest.json')) {
        $file = Join-Path $temporary $name
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file }
    }
    Remove-Item -LiteralPath $temporary
}
