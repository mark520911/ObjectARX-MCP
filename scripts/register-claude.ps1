param([string]$ProjectPath = (Get-Location).Path)
$ErrorActionPreference='Stop'
$serverPath=(Resolve-Path (Join-Path $PSScriptRoot '..\src\server.js')).Path
$configPath=Join-Path $ProjectPath '.mcp.json'
if(Test-Path $configPath){$obj=Get-Content $configPath -Raw | ConvertFrom-Json -AsHashtable}else{$obj=@{}}
if(-not $obj.ContainsKey('mcpServers')){$obj.mcpServers=@{}}
$obj.mcpServers['objectarx-docs']=@{type='stdio';command='node';args=@($serverPath)}
$obj | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $configPath
Write-Host "Registered objectarx-docs in $configPath" -ForegroundColor Green

$sourceClaude=Join-Path (Split-Path $PSScriptRoot -Parent) 'CLAUDE.md'
$targetClaude=Join-Path $ProjectPath 'CLAUDE.md'
if(-not (Test-Path $targetClaude)){ Copy-Item $sourceClaude $targetClaude; Write-Host 'Copied ObjectARX CLAUDE.md into project root.' -ForegroundColor Green } else { Write-Host 'Existing CLAUDE.md preserved; merge rules manually if needed.' -ForegroundColor Yellow }
