# SoundPlayer wrapper used by dsh-voice-alerts when ffplay is unavailable.
#
# ASCII-ONLY ON PURPOSE. Windows PowerShell 5.1 reads .ps1 files as ANSI/GBK on
# CJK systems unless the file carries a UTF-8 BOM, so non-ASCII comments get
# mis-decoded, break the parser's view of the script, and the playback call is
# silently swallowed (observed: exits 0 in 0.2s without any sound). Keep ASCII.
#
# Only uncompressed PCM WAV is supported by System.Media.SoundPlayer; that is why
# the package ships .wav next to every .mp3.
#
# No Add-Type is needed: SoundPlayer lives in System.dll, part of the .NET
# Framework that ships with Windows 10/11.
#
# Exit codes: 0 = played, 2 = file missing.
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Path
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Path)) { exit 2 }

$player = New-Object System.Media.SoundPlayer
$player.SoundLocation = $Path
# PlaySync blocks until the clip finishes, so the parent can chain playback.
$player.PlaySync()
exit 0