param(
    [string] $ProjectRoot = ".",
    [string] $Stage20Directory = "",
    [string] $AuditDirectory = "",
    [switch] $ChecksOnly
)
$ErrorActionPreference = "Stop"
$studyProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$packageManifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot "manifest.json") -Raw | ConvertFrom-Json
foreach ($required in $packageManifest.requires) {
    $priorPath = Join-Path $studyProjectRoot $required.path
    if (-not (Test-Path -LiteralPath $priorPath -PathType Leaf)) { throw "Required project file missing: $($required.path). Use the lifedb ICMIC project root. Nothing was installed." }
    if ((Get-FileHash -LiteralPath $priorPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $required.sha256) { throw "Frozen project file changed: $($required.path). Nothing was installed." }
}
foreach ($file in $packageManifest.files) {
    $packagePath = Join-Path $PSScriptRoot $file.path
    if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) { throw "Package file missing: $($file.path)" }
    if ((Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw "Package file changed: $($file.path)" }
}
$portableNode = Join-Path $studyProjectRoot "Tools\PrivSearchNode\node-v24.22.0-win-x64\node.exe"
if (Test-Path -LiteralPath $portableNode -PathType Leaf) { $nodeExecutable = $portableNode }
else { $nodeExecutable = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source }
$runtimeText = & $nodeExecutable -p 'JSON.stringify({node:process.version,uv:process.versions.uv,arch:process.arch,platform:process.platform})'
if ($LASTEXITCODE -ne 0) { throw "Node runtime inspection failed." }
$runtime = $runtimeText | ConvertFrom-Json
if ($runtime.platform -eq "win32" -and ($runtime.node -ne "v24.22.0" -or $runtime.arch -ne "x64")) { throw "Use the previously checked Node v24.22.0 x64 runtime. The existing portable runtime is preferred automatically." }
$reportParent = Join-Path $studyProjectRoot "Results\revision_v3"
$gateDirectory = Join-Path $reportParent ("privacy_attack_checks_" + [DateTime]::UtcNow.ToString("yyyyMMdd_HHmmss_fff") + "_" + [Guid]::NewGuid().ToString("N").Substring(0,8))
New-Item -ItemType Directory -Path $gateDirectory -Force | Out-Null
$gate = [ordered]@{ schema = "privsearch-privacy-runtime-gate-1"; status = "CHECKS_PENDING"; runtime = $runtime; frozen_files_checked = $packageManifest.requires.Count; installed_application_files = 0; test_scope = "Synthetic audited fixtures, actual local Node child processes, failure controls; no real corpus scan or service connections." }
$gateFile = Join-Path $gateDirectory "gate.json"
$gate | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $gateFile -Encoding UTF8
$previousTestRoot = $env:PRIVSEARCH_PRIVACY_PROJECT_ROOT
try {
    $env:PRIVSEARCH_PRIVACY_PROJECT_ROOT = $studyProjectRoot
    Write-Host "PRIVACY_RUNTIME_CHECKS_STARTING: expected failure controls are contained in the self-tests. No project files are installed."
    $previousErrorPolicy = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $nodeExecutable --test --test-reporter=tap (Join-Path $PSScriptRoot "test-privacy-study.js") 2>&1 | Tee-Object -FilePath (Join-Path $gateDirectory "tests.txt")
        $checksExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousErrorPolicy }
    $gate.test_exit_code = $checksExitCode
    $gate.status = if ($checksExitCode -eq 0) { "CHECKS_PASSED" } else { "CHECKS_FAILED" }
    $gate | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $gateFile -Encoding UTF8
    if ($checksExitCode -ne 0) { throw "Privacy workflow checks failed. The real-corpus attack study did not start. Checks: $gateDirectory" }
} finally {
    if ($null -eq $previousTestRoot) { Remove-Item Env:PRIVSEARCH_PRIVACY_PROJECT_ROOT -ErrorAction SilentlyContinue }
    else { $env:PRIVSEARCH_PRIVACY_PROJECT_ROOT = $previousTestRoot }
}
Write-Host "PRIVACY_RUNTIME_CHECKS_PASSED"
if ($ChecksOnly) { Write-Host "PRIVACY_CHECK_DIRECTORY: $gateDirectory"; return }
$reportDirectory = Join-Path $reportParent ("privacy_real_corpus_" + [DateTime]::UtcNow.ToString("yyyyMMdd_HHmmss_fff") + "_" + [Guid]::NewGuid().ToString("N").Substring(0,8))
$privacyArgs = @((Join-Path $PSScriptRoot "run-privacy-study.js"), "--project-root", $studyProjectRoot, "--output", $reportDirectory)
if ($Stage20Directory) { $privacyArgs += @("--stage20", (Resolve-Path -LiteralPath $Stage20Directory).Path) }
if ($AuditDirectory) { $privacyArgs += @("--audit", (Resolve-Path -LiteralPath $AuditDirectory).Path) }
Write-Host "REAL_CORPUS_PRIVACY_STARTING: healthcare and Enron; 792 fixed attack-result cells; fresh OFFLINE encryption; no database, object-store or blockchain connections."
$previousErrorPolicy = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
    & $nodeExecutable @privacyArgs 2>&1 | Tee-Object -FilePath (Join-Path $gateDirectory "study-console.txt")
    $privacyExitCode = $LASTEXITCODE
} finally { $ErrorActionPreference = $previousErrorPolicy }
if (-not (Test-Path -LiteralPath $reportDirectory -PathType Container)) { throw "The study exited before creating a report directory. Review: $gateDirectory" }
Copy-Item -LiteralPath $gateDirectory -Destination (Join-Path $reportDirectory "runtime_checks") -Recurse
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "README.md") -Destination (Join-Path $reportDirectory "README.md")
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "BUILD_VALIDATION.json") -Destination (Join-Path $reportDirectory "BUILD_VALIDATION.json")
[ordered]@{ exit_code = $privacyExitCode; real_corpus_run = $true; completion_does_not_mean_privacy_secure = $true } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $reportDirectory "runner-result.json") -Encoding UTF8
$archivePath = $reportDirectory + ".zip"
Compress-Archive -LiteralPath $reportDirectory -DestinationPath $archivePath
Write-Host "PRIVACY_STUDY_EXIT_CODE: $privacyExitCode"
Write-Host "Upload this ZIP: $archivePath"
if ($privacyExitCode -ne 0) { exit 1 }
