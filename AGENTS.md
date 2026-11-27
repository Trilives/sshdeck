# Release policy

- Publish a numbered preview for each version before publishing its stable release. For example, `v0.4.5-beta.1` is a preview for `v0.4.5`.
- Wait at least 48 hours after the latest preview for that version was publicly published on GitHub. Publishing another preview for the same version restarts the 48-hour wait. Use the release's `published_at` timestamp and exclude drafts and the rolling `preview` update endpoint.
- After publishing a preview, tell the user when the corresponding stable release can first be published, using their timezone. If a stable release is requested sooner, remind the user of the earliest time.
- Run `pwsh -File scripts/check-stable-release.ps1 -Tag vX.Y.Z -Repository Trilives/sshdeck` before pushing a stable tag or publishing a stable draft. The Windows build also checks the waiting period before building a stable tag.
