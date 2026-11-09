$ErrorActionPreference = 'Stop'
Write-Host '== ObjectARX MCP setup ==' -ForegroundColor Cyan
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js not found. Install Node.js 22 LTS first.' }
$major = [int]((node -p "process.versions.node.split('.')[0]").Trim())
if ($major -lt 20) { throw 'Node.js 20.11+ required; Node.js 22 LTS recommended.' }

npm install
Write-Host 'Dependencies installed. Next: edit config/default.json and run npm run doctor.' -ForegroundColor Green
