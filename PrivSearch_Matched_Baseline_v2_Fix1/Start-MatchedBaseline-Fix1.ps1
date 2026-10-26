[CmdletBinding()]
param(
 [string]$ProjectRoot = 'C:\Users\Gozie\Desktop\Search Functionality in Blockchain\lifedb ICMIC',
 [string]$Python = '', [string]$Node = '', [string]$AuditRoot = '',
 [int]$Repeats = 10, [int]$KeyRepetitions = 3
)
$ErrorActionPreference='Stop'
$project=(Resolve-Path -LiteralPath $ProjectRoot).Path
if (-not $Python) {
 $existing=Join-Path $project 'Tools\PrivSearchBaselineQualification_v2\python-venv\Scripts\python.exe'
 if (Test-Path -LiteralPath $existing) { $Python=$existing } else { $Python=(Get-Command python -ErrorAction Stop).Source }
}
if (-not $Node) { $Node=(Get-Command node -ErrorAction Stop).Source }
$env:PYTHONUTF8='1'
$env:MATCHED_NODE=$Node
function Invoke-MatchedLogged {
 param([string]$Executable,[string[]]$ArgumentList,[string]$LogPath,[switch]$Stream)
 $launchArgs=@((Join-Path $PSScriptRoot 'run_logged.py'),'--log',$LogPath)
 if ($Stream) { $launchArgs+='--tee' }
 $launchArgs+=@('--',$Executable)
 $launchArgs+=$ArgumentList
 & $Python @launchArgs | Out-Host
 return [int]$LASTEXITCODE
}
$report=Join-Path $project ('Results\revision_v3\matched_baseline_v2_fix1_'+(Get-Date -Format 'yyyyMMdd_HHmmss')+'_'+[guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $report -Force | Out-Null
$ok=$false
try {
 $code=Invoke-MatchedLogged -Executable $Python -ArgumentList @((Join-Path $PSScriptRoot 'verify-package.py')) -LogPath (Join-Path $report 'package-check.txt')
 if ($code -ne 0) { throw 'Package identity check failed.' }
 Write-Host 'Running new workload, payload, greedy-cover and failed-attempt controls.'
 $code=Invoke-MatchedLogged -Executable $Python -ArgumentList @((Join-Path $PSScriptRoot 'test_matched.py')) -LogPath (Join-Path $report 'new-controls.log')
 if ($code -ne 0) { throw 'New matched-boundary controls failed.' }
 $code=Invoke-MatchedLogged -Executable $Python -ArgumentList @((Join-Path $PSScriptRoot 'run_daks_experiment.py'),'--output',(Join-Path $report 'greedy-qualification'),'--repeats','1') -LogPath (Join-Path $report 'greedy-qualification.log')
 if ($code -ne 0) { throw 'Updated DAKS greedy-cover qualification failed.' }
 Write-Host 'Scanning audited corpora with complete postings. Positive and disjoint conjunctions are mandatory.'
 $private=Join-Path $report 'private-inputs'
 $exportArgs=@((Join-Path $PSScriptRoot 'export-audited-corpus.js'),'--project',$project,'--output',$private)
 if ($AuditRoot) { $exportArgs+=@('--audit',(Resolve-Path -LiteralPath $AuditRoot).Path) }
 $code=Invoke-MatchedLogged -Executable $Node -ArgumentList $exportArgs -LogPath (Join-Path $report 'source-export.log')
 if ($code -ne 0) { throw 'Audited export failed.' }
 Copy-Item -LiteralPath (Join-Path $private 'export-status.json') -Destination (Join-Path $report 'source-selection.json')
 Write-Host 'Running all three profiles on identical queries, bytes and repetition schedules. Each profile has a separate worker process.'
 $code=Invoke-MatchedLogged -Executable $Python -ArgumentList @((Join-Path $PSScriptRoot 'run_matched.py'),'--input-dir',$private,'--output',(Join-Path $report 'matched'),'--node',$Node,'--repeats',[string]$Repeats,'--key-repetitions',[string]$KeyRepetitions) -LogPath (Join-Path $report 'matched-run.log') -Stream
 if ($code -ne 0) { throw 'Matched benchmark stopped. Failures and completed attempts are retained.' }
 $ok=$true
} catch {
 $_.Exception.Message | Set-Content -LiteralPath (Join-Path $report 'STOPPED.txt') -Encoding utf8
 Write-Warning $_.Exception.Message
} finally {
 $private=Join-Path $report 'private-inputs'
 if (Test-Path -LiteralPath $private) { Remove-Item -LiteralPath $private -Recurse -Force }
 $zip=$report+'.zip'
 Compress-Archive -LiteralPath $report -DestinationPath $zip -CompressionLevel Optimal
 Write-Host ('MATCHED_BASELINE_REPORT_ZIP: '+$zip)
}
if (-not $ok) { exit 1 }
