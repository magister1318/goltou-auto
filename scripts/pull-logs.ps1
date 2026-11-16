param([string]$Destination = (Join-Path $PSScriptRoot '../../runs/logs'))
$ErrorActionPreference = 'Stop'
$destinationPath = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
$archive = Join-Path $destinationPath ('job-logs-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.tar')
# Process byte streams directly: PowerShell 5 redirection can corrupt tar bytes.
$start = [Diagnostics.ProcessStartInfo]::new()
$start.FileName = (Get-Command adb).Source
$start.Arguments = 'exec-out run-as kr.goltou.auto tar -C files/logs --exclude=.salt -cf - .'
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$process = [Diagnostics.Process]::Start($start)
$stream = [IO.File]::Create($archive)
try { $process.StandardOutput.BaseStream.CopyTo($stream) } finally { $stream.Dispose() }
$errorText = $process.StandardError.ReadToEnd()
$process.WaitForExit()
if ($process.ExitCode -ne 0) { throw ('작업 로그 추출 실패: 디버그 빌드와 adb 연결을 확인하세요. ' + $errorText) }
tar -xf $archive -C $destinationPath --exclude=.salt
if ($LASTEXITCODE -ne 0) { throw '작업 로그 압축 해제 실패' }
# The salt never leaves the app; do not retain a raw archive containing it.
Remove-Item -LiteralPath $archive
Write-Output ('작업 로그 저장: ' + $destinationPath)
