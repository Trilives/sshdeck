param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^v\d+\.\d+\.\d+$')]
    [string]$Tag,

    [Parameter(Mandatory = $true)]
    [string]$Repository
)

$ErrorActionPreference = 'Stop'
$filter = '.[] | select(.prerelease and (.draft | not) and .published_at) | [.tag_name, .published_at] | @tsv'
$releases = gh api --paginate "repos/$Repository/releases?per_page=100" --jq $filter
if ($LASTEXITCODE -ne 0) {
    throw 'Could not verify the preview publication time on GitHub.'
}

$latestPreviewTime = $null
$latestPreviewTag = $null
foreach ($row in $releases) {
    $previewTag, $publishedAt = $row -split "`t", 2
    if ($previewTag -notlike "${Tag}-*") { continue }
    $previewTime = [DateTimeOffset]::Parse($publishedAt, [Globalization.CultureInfo]::InvariantCulture)
    if ($null -eq $latestPreviewTime -or $previewTime -gt $latestPreviewTime) {
        $latestPreviewTag = $previewTag
        $latestPreviewTime = $previewTime
    }
}
if ($null -eq $latestPreviewTime) {
    throw "Publish a numbered preview for $Tag before releasing the stable version."
}

$eligibleAt = $latestPreviewTime.ToUniversalTime().AddHours(48)
$eligibleText = $eligibleAt.ToString("yyyy-MM-dd HH:mm:ss 'UTC'")
if ([DateTimeOffset]::UtcNow -lt $eligibleAt) {
    throw "The 48-hour waiting period for $latestPreviewTag ends at $eligibleText."
}
Write-Output "$Tag is eligible for stable release. The waiting period for $latestPreviewTag ended at $eligibleText."
