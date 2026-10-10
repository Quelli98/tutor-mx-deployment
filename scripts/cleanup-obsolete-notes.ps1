[CmdletBinding(SupportsShouldProcess)]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$packagePath = Join-Path $repoRoot 'package.json'
if (!(Test-Path -LiteralPath $packagePath) -or ((Get-Content -Raw -LiteralPath $packagePath | ConvertFrom-Json).name -ne 'tutoring-management-system')) {
    throw 'Run the copy of this script inside the Tutor Mx repository scripts folder.'
}
$obsoleteNotes = @(
    'MEMBER6-SPRINT4-REVIEW.md',
    'START-HERE-SPRINT4-FINAL.md',
    'START-HERE-SPRINT4-MEMBER1.md',
    'START-HERE-SPRINT4-MEMBERS1-AND2.md',
    'START-HERE-SPRINT4-MEMBERS1-TO3.md',
    'START-HERE-SPRINT4-MEMBERS1-TO4.md',
    'START-HERE-SPRINT4-MEMBERS1-TO5.md',
    'docs/sprint4-member1-changed-files.md',
    'docs/sprint4-member1-handoff.md',
    'docs/sprint4-member2-changed-files.md',
    'docs/sprint4-member2-handoff.md',
    'docs/sprint4-member3-changed-files.md',
    'docs/sprint4-member3-handoff.md',
    'docs/sprint4-member4-browser-checks.md',
    'docs/sprint4-member4-changed-files.md',
    'docs/sprint4-member4-handoff.md',
    'docs/sprint4-member5-changed-files.md',
    'docs/sprint4-member5-endpoint-role-matrix.md',
    'docs/sprint4-member5-handoff.md'
)
foreach ($relativePath in $obsoleteNotes) {
    $targetPath = Join-Path $repoRoot $relativePath
    if ((Test-Path -LiteralPath $targetPath -PathType Leaf) -and $PSCmdlet.ShouldProcess($relativePath, 'Remove obsolete Sprint 4 note')) {
        Remove-Item -LiteralPath $targetPath
    }
}
Write-Output 'Obsolete note cleanup finished. Review git status before committing.'
