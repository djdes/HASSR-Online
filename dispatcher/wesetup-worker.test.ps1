param([string]$PackedFixtureFile, [string]$PlainFixtureFile)
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'wesetup-worker.ps1'
$tokens = $null; $parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Worker PowerShell syntax failed' }
foreach ($name in @('Process-SelfContained', 'Invoke-RalphText', 'Expand-GglWebmastersJob')) {
  $node = $ast.Find({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq $name }, $true)
  if (-not $node) { throw "Missing worker function: $name" }
  Invoke-Expression $node.Extent.Text
}
$script:Cfg = @{ TimeoutSec = 100 }
$script:SELF_CONTAINED_SYSTEM = 'Return the requested advisory JSON only.'
$script:Completed = $null
$script:ShouldFailRalph = $false
$script:ExpectedPrompt = 'fixture prompt'
function Log([string]$message) {}
function Invoke-Claude { throw 'SEO analysis must not invoke Claude' }
function Invoke-RalphText([string]$promptText, [int]$watchdogSec) {
  if ($promptText -ne $script:ExpectedPrompt -or $watchdogSec -ne 100) { throw 'Ralph prompt or deadline changed' }
  if ($script:ShouldFailRalph) { return @{ ok = $false; text = ''; reason = 'fixture_failed' } }
  return @{ ok = $true; text = '{"summary":"fixture"}'; costUsd = 0; tokensIn = 0; tokensOut = 0 }
}
function Complete-Job($id, $ok, $text, $errorMessage, $cost) { $script:Completed = @{ id=$id; ok=$ok; text=$text; error=$errorMessage } }
$job = @{ id = 'fixture'; inputText = 'fixture prompt' }
if (-not (Process-SelfContained $job 'wesetup_ggl_webmasters')) { throw 'SEO worker failed' }
if (-not $script:Completed.ok -or $script:Completed.text -ne '{"summary":"fixture"}') { throw 'Queue completion contract failed' }
$script:ShouldFailRalph = $true
if (Process-SelfContained $job 'wesetup_ggl_webmasters') { throw 'Failed Ralph call must fail the queue job' }
if ($script:Completed.ok -or $script:Completed.error -ne 'ralph:fixture_failed') { throw 'Wrong Ralph failure attribution' }
function Pack-Fixture([string]$text) {
  $stream = [IO.MemoryStream]::new()
  $gzip = [IO.Compression.GZipStream]::new($stream, [IO.Compression.CompressionMode]::Compress, $true)
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($text)
    $gzip.Write($bytes, 0, $bytes.Length)
  } finally { $gzip.Dispose() }
  try { return "type: wesetup_ggl_webmasters`nencoding: gzip-base64-v1`n`n" + [Convert]::ToBase64String($stream.ToArray()) } finally { $stream.Dispose() }
}
$script:ShouldFailRalph = $false
$script:ExpectedPrompt = "type: wesetup_ggl_webmasters`n" + ('fixture-site-123;' * 6000) + [char]0x0416
$job.inputText = Pack-Fixture $script:ExpectedPrompt
if (-not (Process-SelfContained $job 'wesetup_ggl_webmasters') -or -not $script:Completed.ok) { throw 'Lossless compressed routing failed' }
foreach ($invalid in @(
  "type: wesetup_ggl_webmasters`nencoding: gzip-base64-v1`n`nINVALID!",
  (Pack-Fixture 'type: other'),
  (Pack-Fixture ("type: wesetup_ggl_webmasters`n" + ('a' * 190001))),
  (Pack-Fixture ("type: wesetup_ggl_webmasters`n" + ('a' * 800000)))
)) {
  $job.inputText = $invalid
  if (Process-SelfContained $job 'wesetup_ggl_webmasters') { throw 'Invalid payload reached the model' }
  if ($script:Completed.error -ne 'ralph:invalid_ggl_payload') { throw 'Invalid envelope failure contract changed' }
}
if ($PackedFixtureFile -or $PlainFixtureFile) {
  if (-not $PackedFixtureFile -or -not $PlainFixtureFile) { throw 'Both interop fixture paths are required' }
  $decoded = Expand-GglWebmastersJob ([IO.File]::ReadAllText($PackedFixtureFile, [Text.Encoding]::UTF8))
  if ($decoded -cne [IO.File]::ReadAllText($PlainFixtureFile, [Text.Encoding]::UTF8)) { throw 'Node-to-PowerShell Unicode roundtrip failed' }
}
Write-Output 'PASS: syntax, Ralph-only routing, prompt/deadline, lossless compression, expansion limits, successful and failed queue completion; no Claude or external calls.'
