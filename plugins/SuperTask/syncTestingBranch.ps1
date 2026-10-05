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
$featureBranches = @('feature/offline-task-workflow', 'feature/project-overview', 'feature/project-collections',
    'feature/offline-task-mutations', 'feature/capture-batch-refinements', 'feature/native-task-sidebar',
    'feature/native-interaction-engine', 'feature/native-launcher-recognition', 'feature/native-interaction-workspace')
foreach ($featureBranch in $featureBranches) {
    & git -C $PSScriptRoot merge --no-ff --no-edit "origin/$featureBranch"
    if ($LASTEXITCODE -ne 0) { throw "Resolve and review the $featureBranch merge before continuing." }
}
foreach ($featureBranch in $featureBranches) {
    & git -C $PSScriptRoot merge-base --is-ancestor "origin/$featureBranch" HEAD
    if ($LASTEXITCODE -ne 0) { throw "$featureBranch is not fully integrated." }
}
if ($Push) {
    & git -C $PSScriptRoot push origin $testingBranch
    if ($LASTEXITCODE -ne 0) { throw 'Could not push the updated testing branch.' }
}
Write-Host 'All nine current feature heads are included. Run tests, build, verify_package.py and update TESTING.md before installing a new package.'
