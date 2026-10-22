# README screenshots

From the repository root, run:

```powershell
npm.cmd --prefix frontend run screenshots
```

The script starts the real frontend in a temporary local Vite server and captures
eight PNG images: Remote Connections, the folder picker, File Transfer and Port
Forwarding, in Chinese and English. It uses a 1600 × 1000 browser viewport at 2×
pixel density, producing 3200 × 2000 images without JPEG compression or upscaling.

All hosts, paths and transfer jobs are sample data. The script never accesses the
user's SSHDeck profile or opens SSH connections. Windows uses the installed Edge
browser; `PLAYWRIGHT_CHANNEL` can select another installed Playwright browser channel.

The order in both READMEs is Remote Connections → File Transfer → Port Forwarding.
