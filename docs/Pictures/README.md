# README screenshots

From the repository root, run:

```powershell
npm.cmd --prefix frontend run screenshots
```

The script starts the real frontend in a temporary local Vite server. It captures
Remote Connections, the folder picker, File Transfer, Port Forwarding, Settings,
and the in-app guide in both Chinese and English. It uses a 1600 × 1000 browser viewport at 2×
pixel density, producing 3200 × 2000 images without JPEG compression or upscaling.

All hosts, paths and transfer jobs are sample data. The script never accesses the
user's SSHDeck profile or opens SSH connections. Windows uses the installed Edge
browser; `PLAYWRIGHT_CHANNEL` can select another installed Playwright browser channel.

Both READMEs show Remote Connections, File Transfer, and Port Forwarding in that order.
The folder picker, Settings, and Guide screenshots are in expandable sections.
