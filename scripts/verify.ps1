$ErrorActionPreference='Stop'
npm run doctor
if(-not (Test-Path '.\data\objectarx.db')) { throw 'Database missing. Run npm run rebuild first.' }
npm run test:search -- AcDbEntity
Write-Host 'Local indexing verification complete.' -ForegroundColor Green
