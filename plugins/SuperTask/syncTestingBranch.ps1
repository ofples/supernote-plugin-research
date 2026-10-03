[CmdletBinding()]
param([switch]$Push)
$ErrorActionPreference = 'Stop'
$testingBranch = 'release/workflow-overview-testing'
$currentBranch = & git -C $PSScriptRoot branch --show-current
if ($LASTEXITCODE -ne 0 -or $currentBranch -ne $testingBranch) {
    throw "Run this helper from the $testingBranch checkout."
}
$workingChanges = @(& git -C $PSScriptRoot status --porcelain)
if ($LASTEXITCODE -ne 0 -or $workingChanges.Count -gt 0) {
    throw 'Commit or preserve local changes before updating the testing branch.'
}
& git -C $PSScriptRoot fetch origin
if ($LASTEXITCODE -ne 0) { throw 'Could not fetch the user fork.' }
foreach ($featureBranch in @('feature/offline-task-workflow', 'feature/project-overview')) {
    & git -C $PSScriptRoot merge --no-ff --no-edit "origin/$featureBranch"
    if ($LASTEXITCODE -ne 0) { throw "Resolve and review the $featureBranch merge before continuing." }
}
& git -C $PSScriptRoot merge-base --is-ancestor origin/feature/offline-task-workflow HEAD
if ($LASTEXITCODE -ne 0) { throw 'Offline feature is not fully integrated.' }
& git -C $PSScriptRoot merge-base --is-ancestor origin/feature/project-overview HEAD
if ($LASTEXITCODE -ne 0) { throw 'Overview feature is not fully integrated.' }
if ($Push) {
    & git -C $PSScriptRoot push origin $testingBranch
    if ($LASTEXITCODE -ne 0) { throw 'Could not push the updated testing branch.' }
}
Write-Host 'Both current feature heads are included. Run tests, build, verify_package.py and update TESTING.md before installing a new package.'
