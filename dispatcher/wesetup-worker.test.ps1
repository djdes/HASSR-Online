$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'wesetup-worker.ps1'
$tokens = $null; $parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Worker PowerShell syntax failed' }
foreach ($name in @('Process-SelfContained', 'Invoke-RalphText')) {
  $node = $ast.Find({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq $name }, $true)
  if (-not $node) { throw "Missing worker function: $name" }
  Invoke-Expression $node.Extent.Text
}
$script:Cfg = @{ TimeoutSec = 100 }
$script:SELF_CONTAINED_SYSTEM = 'Return the requested advisory JSON only.'
$script:Completed = $null
$script:ShouldFailRalph = $false
function Log([string]$message) {}
function Invoke-Claude { throw 'SEO analysis must not invoke Claude' }
function Invoke-RalphText([string]$promptText, [int]$watchdogSec) {
  if ($promptText -ne 'fixture prompt' -or $watchdogSec -ne 100) { throw 'Ralph prompt or deadline changed' }
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
Write-Output 'PASS: syntax, Ralph-only routing, prompt/deadline, successful and failed queue completion; no Claude or external calls.'
