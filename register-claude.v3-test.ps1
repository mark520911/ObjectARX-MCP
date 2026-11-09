#requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('Install','Update-Rules','Uninstall-Rules')]
    [string]$Action,
    [string]$TargetProject,
    [string]$ProjectPath
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
if (-not [string]::IsNullOrWhiteSpace($TargetProject) -and -not [string]::IsNullOrWhiteSpace($ProjectPath)) {
    throw '不能同时指定 -TargetProject 和兼容参数 -ProjectPath。请只提供其中一个。'
}

# ObjectARX-MCP register-claude.ps1 candidate
# PowerShell 5.1 target. V3 candidate; static review only, isolate-test before any real use.
$script:ScriptRoot = [IO.Path]::GetFullPath($PSScriptRoot)

# Support both layouts:
#   <project>\scripts\register-claude.ps1
#   <project>\register-claude.candidate.ps1
# Never guess beyond the script directory and its immediate parent.
$candidateRoots = @(
    $script:ScriptRoot
    [IO.Path]::GetFullPath((Join-Path $script:ScriptRoot '..'))
)
$validRoots = @(
    foreach ($root in $candidateRoots) {
        if (
            (Test-Path -LiteralPath (Join-Path $root 'CLAUDE.md') -PathType Leaf) -and
            (Test-Path -LiteralPath (Join-Path $root 'src\server.js') -PathType Leaf) -and
            (Test-Path -LiteralPath (Join-Path $root '.claude\rules') -PathType Container)
        ) {
            [IO.Path]::GetFullPath($root)
        }
    }
)
if ($validRoots.Count -ne 1) {
    throw '无法唯一确定 ObjectARX-MCP 项目根目录（需要 CLAUDE.md、src\server.js 和 .claude\rules）。拒绝继续。'
}
$script:ProjectRoot = $validRoots[0]
$script:SourceClaude = Join-Path $script:ProjectRoot 'CLAUDE.md'
$script:SourceRules = Join-Path $script:ProjectRoot '.claude\rules'
$script:ServerPath = [IO.Path]::GetFullPath((Join-Path $script:ProjectRoot 'src\server.js'))
$script:ManagedRelativeRoot = '.claude\objectarx-mcp'
$script:ManagedRoot = $null
$script:ManifestName = 'manifest.json'
$script:BeginMarker = '<!-- OBJECTARX-MCP:BEGIN -->'
$script:EndMarker = '<!-- OBJECTARX-MCP:END -->'
$script:RuleNames = @(
    'api-workflow.md',
    'mcp-usage.md',
    'cpp-development.md',
    'build-and-link.md',
    'project-safety.md'
)
$script:Utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)
$script:Utf8Bom = New-Object System.Text.UTF8Encoding($true, $true)

function Get-Sha256Bytes {
    param([Parameter(Mandatory=$true)][byte[]]$Bytes)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','')
    } finally { $sha.Dispose() }
}
function Get-Sha256File {
    param([Parameter(Mandatory=$true)][string]$Path)
    $stream = [IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','') }
    finally { $sha.Dispose(); $stream.Dispose() }
}
function Read-Bytes {
    param([string]$Path)
    return [IO.File]::ReadAllBytes($Path)
}
function Decode-Utf8 {
    param([byte[]]$Bytes)
    $offset = 0
    if ($Bytes.Length -ge 3 -and $Bytes[0] -eq 239 -and $Bytes[1] -eq 187 -and $Bytes[2] -eq 191) { $offset = 3 }
    return $script:Utf8Strict.GetString($Bytes,$offset,$Bytes.Length-$offset)
}
function Encode-Utf8Like {
    param([string]$Text,[bool]$WithBom)
    $body = (New-Object System.Text.UTF8Encoding($false,$true)).GetBytes($Text)
    if (-not $WithBom) { return ,$body }
    $preamble = [byte[]](239,187,191)
    $result = New-Object byte[] ($preamble.Length + $body.Length)
    [Array]::Copy($preamble,0,$result,0,3)
    [Array]::Copy($body,0,$result,3,$body.Length)
    return ,$result
}
function Test-PathWithin {
    param([string]$Root,[string]$Path)
    $r = [IO.Path]::GetFullPath($Root)
    $p = [IO.Path]::GetFullPath($Path)
    $rootPart = [IO.Path]::GetPathRoot($r)
    if ($r.Length -gt $rootPart.Length) {
        $r = $r.TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)
    }
    if ($p.Equals($r,[StringComparison]::OrdinalIgnoreCase)) { return $true }
    $separator = [IO.Path]::DirectorySeparatorChar
    $prefix = if ($r.EndsWith($separator) -or $r.EndsWith([IO.Path]::AltDirectorySeparatorChar)) { $r } else { $r + $separator }
    return $p.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)
}
function Assert-NoReparseComponents {
    param([string]$Path,[string]$Root)
    $full = [IO.Path]::GetFullPath($Path)
    $rootFull = [IO.Path]::GetFullPath($Root)
    if (-not (Test-PathWithin -Root $rootFull -Path $full)) { throw "路径超出目标根目录：$full" }
    $rootItem = Get-Item -LiteralPath $rootFull -Force
    if (($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "根路径是重解析点，拒绝继续：$rootFull" }
    $relative = Get-RelativePathCompat -Root $rootFull -Path $full
    $cursor = $rootFull
    foreach ($part in ($relative -split '[\\/]' | Where-Object { $_ })) {
        $cursor = Join-Path $cursor $part
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "路径包含重解析点，拒绝继续：$cursor"
            }
        }
    }
}

function Get-RelativePathCompat {
    param([string]$Root,[string]$Path)
    $r = [IO.Path]::GetFullPath($Root)
    $p = [IO.Path]::GetFullPath($Path)
    if (-not (Test-PathWithin -Root $r -Path $p)) { throw "路径超出根目录：$p" }
    if ($p.Equals($r,[StringComparison]::OrdinalIgnoreCase)) { return '' }
    $rootPart = [IO.Path]::GetPathRoot($r)
    if ($r.Length -gt $rootPart.Length) { $r = $r.TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar) }
    return $p.Substring($r.Length).TrimStart([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)
}
function Resolve-Target {
    if ($TargetProject) { $p = $TargetProject }
    elseif ($ProjectPath) { $p = $ProjectPath }
    else { $p = (Get-Location).Path }
    $full = [IO.Path]::GetFullPath($p)
    if (-not (Test-Path -LiteralPath $full -PathType Container)) { throw "目标工程目录不存在：$full" }
    return (Get-Item -LiteralPath $full).FullName
}
function Assert-SourcePackage {
    # Validate exact required source artifacts and reject reparse points.
    $required = @($script:SourceClaude,$script:ServerPath)
    foreach ($name in $script:RuleNames) { $required += (Join-Path $script:SourceRules $name) }
    foreach ($path in $required) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "缺少源文件：$path" }
        $item = Get-Item -LiteralPath $path -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "源文件是重解析点，拒绝使用：$path" }
    }
    foreach ($dir in @($script:ProjectRoot,$script:SourceRules,(Join-Path $script:ProjectRoot 'src'))) {
        $item = Get-Item -LiteralPath $dir -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "源目录是重解析点，拒绝使用：$dir" }
    }
    # Decode text inputs strictly now, before building any plan.
    [void][IO.File]::ReadAllText($script:SourceClaude,$script:Utf8Strict)
    foreach ($name in $script:RuleNames) { [void](Decode-Utf8 (Read-Bytes (Join-Path $script:SourceRules $name))) }
}
function Assert-NoDuplicateJsonProperties {
    param([Parameter(Mandatory=$true)][string]$Json)
    $script:JsonScanText = $Json
    $script:JsonScanPos = 0

    function Skip-JsonScanWhitespace {
        while ($script:JsonScanPos -lt $script:JsonScanText.Length -and
            [char]::IsWhiteSpace($script:JsonScanText[$script:JsonScanPos])) { $script:JsonScanPos++ }
    }
    function Read-JsonScanString {
        if ($script:JsonScanPos -ge $script:JsonScanText.Length -or $script:JsonScanText[$script:JsonScanPos] -ne '"') {
            throw 'JSON 字符串格式错误。'
        }
        $start = $script:JsonScanPos
        $script:JsonScanPos++
        while ($script:JsonScanPos -lt $script:JsonScanText.Length) {
            $ch = $script:JsonScanText[$script:JsonScanPos]
            if ($ch -eq '\') {
                $script:JsonScanPos++
                if ($script:JsonScanPos -ge $script:JsonScanText.Length) { throw 'JSON 字符串转义不完整。' }
                $esc = $script:JsonScanText[$script:JsonScanPos]
                if ($esc -eq 'u') {
                    if ($script:JsonScanPos + 4 -ge $script:JsonScanText.Length) { throw 'JSON Unicode 转义不完整。' }
                    $hex = $script:JsonScanText.Substring($script:JsonScanPos + 1,4)
                    if ($hex -notmatch '^[0-9A-Fa-f]{4}$') { throw 'JSON Unicode 转义无效。' }
                    $script:JsonScanPos += 5
                    continue
                }
                if ([string]'"\/bfnrt'.IndexOf([string]$esc) -lt 0) { throw 'JSON 字符串包含非法转义。' }
                $script:JsonScanPos++
                continue
            }
            if ($ch -eq '"') {
                $script:JsonScanPos++
                $raw = $script:JsonScanText.Substring($start,$script:JsonScanPos-$start)
                try { return [string](ConvertFrom-Json -InputObject $raw -ErrorAction Stop) }
                catch { throw 'JSON 字符串转义无效。' }
            }
            if ([int][char]$ch -lt 0x20) { throw 'JSON 字符串包含未转义控制字符。' }
            $script:JsonScanPos++
        }
        throw 'JSON 字符串未闭合。'
    }
    function Read-JsonScanValue {
        Skip-JsonScanWhitespace
        if ($script:JsonScanPos -ge $script:JsonScanText.Length) { throw 'JSON 意外结束。' }
        $ch = $script:JsonScanText[$script:JsonScanPos]
        if ($ch -eq '{') { Read-JsonScanObject; return }
        if ($ch -eq '[') { Read-JsonScanArray; return }
        if ($ch -eq '"') { [void](Read-JsonScanString); return }
        $remaining = $script:JsonScanText.Substring($script:JsonScanPos)
        if ($remaining -match '^(true|false|null)(?=[\s,\]}]|$)') {
            $script:JsonScanPos += $Matches[1].Length; return
        }
        if ($remaining -match '^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+\-]?[0-9]+)?(?=[\s,\]}]|$)') {
            $script:JsonScanPos += $Matches[0].Length; return
        }
        throw "JSON 值格式错误，位置：$script:JsonScanPos"
    }
    function Read-JsonScanObject {
        $script:JsonScanPos++
        Skip-JsonScanWhitespace
        $keys = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        if ($script:JsonScanPos -lt $script:JsonScanText.Length -and $script:JsonScanText[$script:JsonScanPos] -eq '}') {
            $script:JsonScanPos++; return
        }
        while ($true) {
            Skip-JsonScanWhitespace
            $key = Read-JsonScanString
            if (-not $keys.Add($key)) { throw "JSON 存在重复属性：$key" }
            Skip-JsonScanWhitespace
            if ($script:JsonScanPos -ge $script:JsonScanText.Length -or $script:JsonScanText[$script:JsonScanPos] -ne ':') {
                throw 'JSON 对象缺少冒号。'
            }
            $script:JsonScanPos++
            Read-JsonScanValue
            Skip-JsonScanWhitespace
            if ($script:JsonScanPos -lt $script:JsonScanText.Length -and $script:JsonScanText[$script:JsonScanPos] -eq ',') {
                $script:JsonScanPos++; continue
            }
            if ($script:JsonScanPos -lt $script:JsonScanText.Length -and $script:JsonScanText[$script:JsonScanPos] -eq '}') {
                $script:JsonScanPos++; break
            }
            throw 'JSON 对象缺少逗号或结束括号。'
        }
    }
    function Read-JsonScanArray {
        $script:JsonScanPos++
        Skip-JsonScanWhitespace
        if ($script:JsonScanPos -lt $script:JsonScanText.Length -and $script:JsonScanText[$script:JsonScanPos] -eq ']') {
            $script:JsonScanPos++; return
        }
        while ($true) {
            Read-JsonScanValue
            Skip-JsonScanWhitespace
            if ($script:JsonScanPos -lt $script:JsonScanText.Length -and $script:JsonScanText[$script:JsonScanPos] -eq ',') {
                $script:JsonScanPos++; continue
            }
            if ($script:JsonScanPos -lt $script:JsonScanText.Length -and $script:JsonScanText[$script:JsonScanPos] -eq ']') {
                $script:JsonScanPos++; break
            }
            throw 'JSON 数组缺少逗号或结束括号。'
        }
    }

    Read-JsonScanValue
    Skip-JsonScanWhitespace
    if ($script:JsonScanPos -ne $script:JsonScanText.Length) { throw 'JSON 存在尾随内容。' }
    # Full JSON grammar validation, including malformed separators/numbers.
    try { [void](ConvertFrom-Json -InputObject $Json -ErrorAction Stop) }
    catch { throw "JSON 格式无效：$($_.Exception.Message)" }
}
function Get-JsonProperty {
    param($Object,[string]$Name)
    if ($null -eq $Object) { return $null }
    $p = $Object.PSObject.Properties[$Name]
    if ($null -eq $p) { return $null }
    return $p.Value
}
function Test-JsonPropertyExists {
    param($Object,[string]$Name)
    if ($null -eq $Object) { return $false }
    return ($null -ne $Object.PSObject.Properties[$Name])
}
function Set-JsonProperty {
    param($Object,[string]$Name,$Value)
    $p = $Object.PSObject.Properties[$Name]
    if ($null -eq $p) { $Object | Add-Member -MemberType NoteProperty -Name $Name -Value $Value }
    else { $p.Value = $Value }
}
function New-ManagedPackage {
    param([string]$TargetRoot)
    $root = Join-Path $TargetRoot $script:ManagedRelativeRoot
    $rules = Join-Path $root 'rules'
    $sourceText = [IO.File]::ReadAllText($script:SourceClaude,$script:Utf8Strict)
    if ($sourceText -match '\.claude[\\/]rules[\\/]') {
        $sourceText = $sourceText -replace '\.claude[\\/]+rules[\\/]+','rules/'
    }
    $newline = if ($sourceText.Contains("`r`n")) { "`r`n" } else { "`n" }
    $imports = @(
        '@rules/api-workflow.md',
        '@rules/mcp-usage.md',
        '@rules/cpp-development.md',
        '@rules/build-and-link.md',
        '@rules/project-safety.md'
    ) -join $newline
    foreach ($line in ($imports -split [regex]::Escape($newline))) {
        if ([regex]::IsMatch($sourceText,'(?m)^\s*' + [regex]::Escape($line) + '\s*$')) { throw "源 CLAUDE.md 已包含规则引用，拒绝重复注入：$line" }
    }
    $bom = $false
    $sourceBytes = Read-Bytes $script:SourceClaude
    $bom = ($sourceBytes.Length -ge 3 -and $sourceBytes[0] -eq 239 -and $sourceBytes[1] -eq 187 -and $sourceBytes[2] -eq 191)
    $managedClaude = $sourceText
    if (-not ($managedClaude.EndsWith("`n") -or $managedClaude.EndsWith("`r"))) { $managedClaude += $newline }
    $managedClaude += $newline + $imports + $newline
    $files = New-Object System.Collections.ArrayList
    [void]$files.Add([PSCustomObject]@{ Path=(Join-Path $root 'CLAUDE.md'); Bytes=(Encode-Utf8Like $managedClaude $bom); Relative='CLAUDE.md' })
    foreach ($name in $script:RuleNames) {
        $src = Join-Path $script:SourceRules $name
        $bytes = Read-Bytes $src
        [void]$files.Add([PSCustomObject]@{ Path=(Join-Path $rules $name); Bytes=$bytes; Relative=("rules\" + $name) })
    }
    $manifestFiles = @()
    foreach ($f in $files) {
        $manifestFiles += [PSCustomObject]@{ path=$f.Relative.Replace('\','/'); sha256=(Get-Sha256Bytes $f.Bytes) }
    }
    $manifest = [PSCustomObject]@{
        schemaVersion = 1
        product = 'ObjectARX-MCP'
        packageVersion = '1.0.0'
        generatedUtc = [DateTime]::UtcNow.ToString('o')
        files = $manifestFiles
    }
    $manifestJson = $manifest | ConvertTo-Json -Depth 8
    [void]$files.Add([PSCustomObject]@{ Path=(Join-Path $root $script:ManifestName); Bytes=(Encode-Utf8Like ($manifestJson + "`n") $false); Relative=$script:ManifestName })
    return ,$files.ToArray()
}
function Test-ManagedPackage {
    param([string]$TargetRoot)
    $root = Join-Path $TargetRoot $script:ManagedRelativeRoot
    Assert-NoReparseComponents -Path $root -Root $TargetRoot
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw "受管目录不存在：$root" }
    $manifestPath = Join-Path $root $script:ManifestName
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "受管 Manifest 不存在：$manifestPath" }
    $text = [IO.File]::ReadAllText($manifestPath,$script:Utf8Strict)
    Assert-NoDuplicateJsonProperties -Json $text
    $m = ConvertFrom-Json -InputObject $text -ErrorAction Stop
    if ($m -isnot [PSCustomObject]) { throw 'Manifest 根节点必须是对象。' }
    $topAllowed = @('schemaVersion','product','packageVersion','generatedUtc','files')
    $topNames = @($m.PSObject.Properties | ForEach-Object { $_.Name })
    foreach ($n in $topAllowed) { if (-not (Test-JsonPropertyExists $m $n)) { throw "Manifest 缺少字段：$n" } }
    foreach ($n in $topNames) { if ($n -cnotin $topAllowed) { throw "Manifest 存在未允许字段：$n" } }
    $generatedDate = [DateTime]::MinValue
    $validGeneratedDate = [DateTime]::TryParse($m.generatedUtc,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal,[ref]$generatedDate)
    if (-not $validGeneratedDate -or $m.schemaVersion -isnot [int] -or $m.schemaVersion -ne 1 -or
        $m.product -isnot [string] -or $m.product -cne 'ObjectARX-MCP' -or
        $m.packageVersion -isnot [string] -or $m.packageVersion -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$' -or
        $m.generatedUtc -isnot [string] -or $m.generatedUtc -notmatch '^\d{4}-\d{2}-\d{2}T.*Z$' -or
        $m.files -isnot [Array]) { throw 'Manifest 字段类型或值无效。' }
    $allowed = @('CLAUDE.md') + @($script:RuleNames | ForEach-Object { 'rules/' + $_ })
    if ($m.files.Count -ne $allowed.Count) { throw 'Manifest 文件数量不正确。' }
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($f in $m.files) {
        if ($f -isnot [PSCustomObject]) { throw 'Manifest 文件条目必须是对象。' }
        $entryNames = @($f.PSObject.Properties | ForEach-Object { $_.Name })
        if ($entryNames.Count -ne 2 -or -not (Test-JsonPropertyExists $f 'path') -or -not (Test-JsonPropertyExists $f 'sha256')) { throw 'Manifest 文件条目字段集合无效。' }
        foreach ($n in $entryNames) { if ($n -cnotin @('path','sha256')) { throw "Manifest 文件条目存在未允许字段：$n" } }
        if ($f.path -isnot [string] -or $f.sha256 -isnot [string] -or $f.sha256 -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Manifest 文件条目类型或 SHA256 无效。' }
        if ($f.path -cnotin $allowed) { throw "Manifest 包含非白名单路径：$($f.path)" }
        if (-not $seen.Add($f.path)) { throw "Manifest 包含重复路径：$($f.path)" }
        $path = Join-Path $root ($f.path.Replace('/','\'))
        Assert-NoReparseComponents -Path $path -Root $TargetRoot
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "受管文件缺失：$path" }
        if ((Get-Sha256File $path) -cne $f.sha256.ToUpperInvariant()) { throw "受管文件哈希不匹配：$path" }
    }
    # Exact directory tree: root + rules only; no extra files, folders, or reparse points.
    foreach ($item in (Get-ChildItem -LiteralPath $root -Force -Recurse)) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "受管规则包中发现重解析点：$($item.FullName)" }
        $relative = Get-RelativePathCompat -Root $root -Path $item.FullName
        $relative = $relative.Replace('\','/')
        if ($item.PSIsContainer) {
            if ($relative -cne 'rules') { throw "受管目录包含非预期目录：$relative" }
        } elseif ($relative -cne $script:ManifestName -and $relative -cnotin $allowed) {
            throw "受管目录包含 Manifest 未登记的文件：$relative"
        }
    }
    return $m
}
function Get-RootClaudePlan {
    param([string]$TargetRoot,[ValidateSet('Add','Remove')][string]$Mode)
    $path = Join-Path $TargetRoot 'CLAUDE.md'
    $exists = Test-Path -LiteralPath $path -PathType Leaf
    if ($exists) {
        $bytes = Read-Bytes $path
        $text = Decode-Utf8 $bytes
        $bom = ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191)
        $newline = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
    } else {
        $bytes = $null; $text = ''; $bom = $false; $newline = "`n"
    }
    $blockLines = @(
        $script:BeginMarker,
        '# ObjectARX-MCP Managed Instructions',
        '',
        '@.claude/objectarx-mcp/CLAUDE.md',
        $script:EndMarker
    )
    $block = $blockLines -join $newline
    $beginCount = ([regex]::Matches($text,[regex]::Escape($script:BeginMarker))).Count
    $endCount = ([regex]::Matches($text,[regex]::Escape($script:EndMarker))).Count
    if ($beginCount -ne $endCount -or $beginCount -gt 1) { throw '根 CLAUDE.md 管理标记不唯一或不成对。' }

    if ($Mode -eq 'Add') {
        if ($beginCount -eq 1) {
            $existingBlockPattern = '(?s)' + [regex]::Escape($script:BeginMarker) + '.*?' + [regex]::Escape($script:EndMarker)
            $match = [regex]::Match($text,$existingBlockPattern)
            if (-not $match.Success -or $match.Value -cne $block) { throw '根 CLAUDE.md 已有不同的受管区块，拒绝覆盖。' }
            return [PSCustomObject]@{ Path=$path; Changed=$false; OriginalHash=$(if($exists){Get-Sha256Bytes $bytes}else{$null}); NewBytes=$bytes }
        }
        if ($text.Length -eq 0) { $newText = $block + $newline }
        elseif ($text.EndsWith("`n") -or $text.EndsWith("`r")) { $newText = $text + $newline + $block + $newline }
        else { $newText = $text + $newline + $newline + $block + $newline }
    }
    else {
        if ($beginCount -eq 0) {
            return [PSCustomObject]@{ Path=$path; Changed=$false; OriginalHash=$(if($exists){Get-Sha256Bytes $bytes}else{$null}); NewBytes=$bytes }
        }
        $pattern = [regex]::Escape($script:BeginMarker) + '.*?' + [regex]::Escape($script:EndMarker)
        $match = [regex]::Match($text,$pattern,[Text.RegularExpressions.RegexOptions]::Singleline)
        if (-not $match.Success) { throw '无法精确定位根 CLAUDE.md 受管区块。' }
        # Remove exactly the managed marker span. Preserve every byte of
        # unrelated prefix/suffix text and all original line endings.
        $newText = $text.Remove($match.Index,$match.Length)
    }
    $newBytes = Encode-Utf8Like $newText $bom
    return [PSCustomObject]@{
        Path=$path
        Changed=($null -eq $bytes -or (Get-Sha256Bytes $bytes) -cne (Get-Sha256Bytes $newBytes))
        OriginalHash=$(if($exists){Get-Sha256Bytes $bytes}else{$null})
        NewBytes=$newBytes
    }
}
function Get-McpPlan {
    param([string]$TargetRoot)
    $path = Join-Path $TargetRoot '.mcp.json'
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        $old = Read-Bytes $path
        $text = Decode-Utf8 $old
        $bom = ($old.Length -ge 3 -and $old[0] -eq 239 -and $old[1] -eq 187 -and $old[2] -eq 191)
        Assert-NoDuplicateJsonProperties -Json $text
        $obj = ConvertFrom-Json -InputObject $text
        if ($null -eq $obj -or $obj -isnot [PSCustomObject]) { throw '.mcp.json 根节点必须是 JSON 对象。' }
    } else { $old=$null; $bom=$false; $obj=[PSCustomObject]@{} }
    $serversProperty = $obj.PSObject.Properties['mcpServers']
    if ($null -eq $serversProperty) {
        $servers = [PSCustomObject]@{}
        Set-JsonProperty $obj 'mcpServers' $servers
    } else {
        $servers = $serversProperty.Value
        if ($null -eq $servers -or $servers -isnot [PSCustomObject]) {
            throw '.mcp.json 中已存在 mcpServers，但它不是对象；拒绝覆盖。'
        }
    }
    # PSCustomObject property lookup is case-insensitive in Windows PowerShell.
    # The JSON scanner therefore rejects case-only duplicate keys above, and this
    # explicit property-presence test distinguishes missing from JSON null.
    $existingProperty = $servers.PSObject.Properties['objectarx-docs']
    $expected = [PSCustomObject]@{ type='stdio'; command='node'; args=@($script:ServerPath) }
    if ($null -ne $existingProperty) {
        $existing = $existingProperty.Value
        if ($null -eq $existing -or $existing -isnot [PSCustomObject]) {
            throw '已存在 objectarx-docs 属性，但不是有效配置对象，拒绝覆盖。'
        }
        $typeValue = Get-JsonProperty $existing 'type'
        $commandValue = Get-JsonProperty $existing 'command'
        $argsProperty = $existing.PSObject.Properties['args']
        if ($null -eq $argsProperty -or $argsProperty.Value -isnot [Array]) {
            throw '已存在 objectarx-docs 配置，但 args 不是数组，拒绝覆盖。'
        }
        $argsValue = @($argsProperty.Value)
        if ($typeValue -isnot [string] -or $typeValue -cne 'stdio' -or
            $commandValue -isnot [string] -or $commandValue -cne 'node' -or
            $argsValue.Count -ne 1 -or $argsValue[0] -isnot [string] -or
            $argsValue[0] -cne $script:ServerPath) {
            throw '已存在 objectarx-docs 配置且内容不同，拒绝覆盖。'
        }
        return [PSCustomObject]@{ Path=$path; Changed=$false; OriginalHash=$(if($null -ne $old){Get-Sha256Bytes $old}else{$null}); NewBytes=$old }
    }
    Set-JsonProperty $servers 'objectarx-docs' $expected
    $newText = $obj | ConvertTo-Json -Depth 30
    $newBytes = Encode-Utf8Like ($newText + "`n") $bom
    return [PSCustomObject]@{ Path=$path; Changed=$true; OriginalHash=$(if($null -ne $old){Get-Sha256Bytes $old}else{$null}); NewBytes=$newBytes }
}
function New-FileChange {
    param([string]$Path,[string]$Operation,[byte[]]$NewBytes)
    $exists = Test-Path -LiteralPath $Path -PathType Leaf
    if ($exists) { $oldHash = Get-Sha256File $Path } else { $oldHash = $null }
    return [PSCustomObject]@{ Path=$Path; Operation=$Operation; OriginalExists=$exists; OriginalHash=$oldHash; NewBytes=$NewBytes; NewHash=$(if($Operation -eq 'Write'){Get-Sha256Bytes $NewBytes}else{$null}) }
}
function Get-ActionChanges {
    param([string]$Mode,[string]$TargetRoot)
    $changes = New-Object System.Collections.ArrayList
    if ($Mode -eq 'Install') {
        $package = New-ManagedPackage $TargetRoot
        $managedRoot = Join-Path $TargetRoot $script:ManagedRelativeRoot
        if (Test-Path -LiteralPath $managedRoot) {
            if (Test-Path -LiteralPath (Join-Path $managedRoot $script:ManifestName)) { throw '规则包已安装，请使用 Update-Rules。' }
            $children = @(Get-ChildItem -LiteralPath $managedRoot -Force)
            if ($children.Count -gt 0) { throw '受管目录非空且没有有效 Manifest，拒绝覆盖。' }
        }
        foreach ($f in $package) {
            if (Test-Path -LiteralPath $f.Path) { throw "安装目标已存在：$($f.Path)" }
            [void]$changes.Add((New-FileChange $f.Path 'Write' $f.Bytes))
        }
        $rootPlan = Get-RootClaudePlan $TargetRoot 'Add'
        if ($rootPlan.Changed) { [void]$changes.Add((New-FileChange $rootPlan.Path 'Write' $rootPlan.NewBytes)) }
        $mcp = Get-McpPlan $TargetRoot
        if ($mcp.Changed) { [void]$changes.Add((New-FileChange $mcp.Path 'Write' $mcp.NewBytes)) }
    } elseif ($Mode -eq 'Update-Rules') {
        [void](Test-ManagedPackage $TargetRoot)
        $package = New-ManagedPackage $TargetRoot
        foreach ($f in $package) {
            [void]$changes.Add((New-FileChange $f.Path 'Write' $f.Bytes))
        }
    } elseif ($Mode -eq 'Uninstall-Rules') {
        $manifest = Test-ManagedPackage $TargetRoot
        $root = Join-Path $TargetRoot $script:ManagedRelativeRoot
        foreach ($f in $manifest.files) {
            $p = Join-Path $root ($f.path.Replace('/','\'))
            [void]$changes.Add((New-FileChange $p 'Delete' $null))
        }
        $manifestPath = Join-Path $root $script:ManifestName
        [void]$changes.Add((New-FileChange $manifestPath 'Delete' $null))
        $rootPlan = Get-RootClaudePlan $TargetRoot 'Remove'
        if ($rootPlan.Changed) { [void]$changes.Add((New-FileChange $rootPlan.Path 'Write' $rootPlan.NewBytes)) }
    }
    return ,$changes.ToArray()
}
function Show-Plan {
    param([object[]]$Changes)
    Write-Host '以下为逐文件原始内容与计划内容预览，不是统一 Diff。' -ForegroundColor Yellow
    foreach ($c in $Changes) {
        Write-Host "`n============================================================" -ForegroundColor DarkGray
        $kind = if ($c.Operation -eq 'Delete') {'删除'} elseif ($c.OriginalExists) {'修改'} else {'新增'}
        Write-Host "[$kind] $($c.Path)" -ForegroundColor Cyan
        if ($c.OriginalExists) {
            $old = Decode-Utf8 (Read-Bytes $c.Path)
            Write-Host '--- 原始内容 ---' -ForegroundColor Red
            Write-Output $old
        } else { Write-Host '<原文件不存在>' }
        if ($c.Operation -eq 'Write') {
            Write-Host '--- 计划内容 ---' -ForegroundColor Green
            try { Write-Output (Decode-Utf8 $c.NewBytes) }
            catch { Write-Host "二进制内容 SHA256：$($c.NewHash)" }
        } else { Write-Host '<计划删除>' -ForegroundColor Red }
    }
}
function Get-TransactionRoot {
    return (Join-Path $script:ProjectRoot 'backup\transactions')
}
function Write-JsonAtomic {
    param([string]$Path,$Object)
    $json = $Object | ConvertTo-Json -Depth 30
    $bytes = Encode-Utf8Like ($json + "`n") $false
    Write-AtomicFile -Path $Path -Bytes $bytes
}
function Get-IncompleteTransactions {
    param([string]$TargetRoot)
    $txRoot = Get-TransactionRoot
    if (-not (Test-Path -LiteralPath $txRoot -PathType Container)) { return @() }
    $found = @()
    # Only the most recent terminal transaction per target is authoritative.
    # Older Committed/RolledBack journals remain for audit but are not
    # re-validated against the current target state.
    $latestTerminal = @{}
    foreach ($scanDir in (Get-ChildItem -LiteralPath $txRoot -Directory -Force)) {
        if ($scanDir.Name -eq 'locks') { continue }
        $scanJournal = Join-Path $scanDir.FullName 'journal.json'
        if (-not (Test-Path -LiteralPath $scanJournal -PathType Leaf)) { continue }
        try {
            $scanRaw = [IO.File]::ReadAllText($scanJournal, $script:Utf8Strict)
            $scanObj = ConvertFrom-Json -InputObject $scanRaw -ErrorAction Stop
            if ($scanObj -isnot [PSCustomObject]) { continue }
            if ($scanObj.targetRoot -isnot [string] -or [string]::IsNullOrWhiteSpace($scanObj.targetRoot)) { continue }
            if ($scanObj.status -cnotin @('Committed','RolledBack')) { continue }
            $scanKey = [IO.Path]::GetFullPath($scanObj.targetRoot).ToLowerInvariant()
            if (-not $latestTerminal.ContainsKey($scanKey) -or $scanDir.Name -gt $latestTerminal[$scanKey]) {
                $latestTerminal[$scanKey] = $scanDir.Name
            }
        } catch { }
    }
    $targetKey = [IO.Path]::GetFullPath($TargetRoot).ToLowerInvariant()
    $latestForTarget = $latestTerminal[$targetKey]
    foreach ($dir in (Get-ChildItem -LiteralPath $txRoot -Directory -Force)) {
        if ($dir.Name -eq 'locks') { continue }
        $journalPath = Join-Path $dir.FullName 'journal.json'
        if (-not (Test-Path -LiteralPath $journalPath -PathType Leaf)) {
            $found += [PSCustomObject]@{ Path=$dir.FullName; Reason='孤立事务目录，缺少 journal.json'; TargetUnknown=$true }
            continue
        }
        try {
            $raw = [IO.File]::ReadAllText($journalPath,$script:Utf8Strict)
            Assert-NoDuplicateJsonProperties -Json $raw
            $j = ConvertFrom-Json -InputObject $raw -ErrorAction Stop
            if ($j -isnot [PSCustomObject] -or $j.schemaVersion -isnot [int] -or $j.schemaVersion -ne 1 -or
                $j.transactionId -isnot [string] -or $j.transactionId -cne $dir.Name -or
                $j.targetRoot -isnot [string] -or $j.action -isnot [string] -or
                $j.action -cnotin @('Install','Update-Rules','Uninstall-Rules') -or
                $j.status -isnot [string] -or $j.status -cnotin @('Preparing','Prepared','Applying','RollingBack','RecoveryRequired','Committed','RolledBack') -or
                $j.entries -isnot [Array] -or $j.directories -isnot [Array] -or $j.recoveryErrors -isnot [Array]) {
                throw 'Journal schema 或事务标识无效。'
            }
            $journalTarget = [IO.Path]::GetFullPath($j.targetRoot)
            $sameTarget = $journalTarget.Equals([IO.Path]::GetFullPath($TargetRoot),[StringComparison]::OrdinalIgnoreCase)
            $filesDir = Join-Path $dir.FullName 'files'
            foreach ($entry in $j.entries) {
                if ($entry -isnot [PSCustomObject] -or $entry.path -isnot [string] -or
                    $entry.operation -cnotin @('Write','Delete') -or $entry.existedBefore -isnot [bool] -or
                    $entry.writeStarted -isnot [bool] -or $entry.writeCompleted -isnot [bool] -or
                    $entry.backupComplete -isnot [bool]) { throw 'Journal 文件条目结构无效。' }
                Assert-NoReparseComponents -Path $entry.path -Root $journalTarget
                if ($entry.existedBefore) {
                    if ($entry.originalHash -isnot [string] -or $entry.originalHash -notmatch '^[A-Fa-f0-9]{64}$' -or
                        $entry.backupHash -isnot [string] -or $entry.backupHash -cne $entry.originalHash -or
                        $entry.backupFile -isnot [string] -or $entry.backupFile -notmatch '^\d{4}\.bin$') { throw 'Journal 备份元数据无效。' }
                    $bp = Join-Path $filesDir $entry.backupFile
                    if (-not (Test-Path -LiteralPath $bp -PathType Leaf) -or (Get-Sha256File $bp) -cne $entry.backupHash) { throw "事务备份缺失或哈希错误：$bp" }
                } elseif ($null -ne $entry.backupFile -or $null -ne $entry.backupHash -or $null -ne $entry.originalHash) { throw '原本不存在的文件不应具有备份元数据。' }
                if ($entry.operation -eq 'Write' -and ($entry.expectedNewHash -isnot [string] -or $entry.expectedNewHash -notmatch '^[A-Fa-f0-9]{64}$')) { throw 'Journal 新文件哈希无效。' }
                if ($entry.operation -eq 'Delete' -and $null -ne $entry.expectedNewHash) { throw 'Delete 条目不应具有新文件哈希。' }
                if ($entry.existedBefore -and $entry.backupComplete -ne $true) { throw 'Journal 标记的备份尚未完成。' }
                if ($sameTarget -and $j.status -eq 'Committed' -and $dir.Name -eq $latestForTarget) {
                    $nowExists = Test-Path -LiteralPath $entry.path -PathType Leaf
                    if ($entry.operation -eq 'Delete' -and $nowExists) { throw "Committed 事务目标仍存在：$($entry.path)" }
                    if ($entry.operation -eq 'Write' -and (-not $nowExists -or (Get-Sha256File $entry.path) -cne $entry.expectedNewHash)) { throw "Committed 事务目标状态不匹配：$($entry.path)" }
                }
                if ($sameTarget -and $j.status -eq 'RolledBack' -and $dir.Name -eq $latestForTarget) {
                    $nowExists = Test-Path -LiteralPath $entry.path -PathType Leaf
                    if ($entry.existedBefore -and (-not $nowExists -or (Get-Sha256File $entry.path) -cne $entry.originalHash)) { throw "RolledBack 事务原始文件状态不匹配：$($entry.path)" }
                    if (-not $entry.existedBefore -and $nowExists) { throw "RolledBack 事务新建文件仍存在：$($entry.path)" }
                }
            }
            if ($sameTarget -and $j.status -notin @('Committed','RolledBack')) {
                $found += [PSCustomObject]@{ Path=$dir.FullName; Reason=("未完成状态：" + $j.status); TargetUnknown=$false }
            }
        } catch {
            $found += [PSCustomObject]@{ Path=$dir.FullName; Reason=('事务元数据损坏或无法验证：' + $_.Exception.Message); TargetUnknown=$true }
        }
    }
    return $found
}
function Assert-NoIncompleteTransactions {
    param([string]$TargetRoot)
    $pending = @(Get-IncompleteTransactions -TargetRoot $TargetRoot)
    if ($pending.Count -gt 0) {
        $details = ($pending | ForEach-Object { $_.Path + '：' + $_.Reason }) -join "`n"
        throw "发现未完成或无法识别的事务。为避免误操作，停止执行并要求人工检查：`n$details"
    }
}
function Enter-TargetLock {
    param([string]$TargetRoot)
    $lockRoot = Join-Path (Get-TransactionRoot) 'locks'
    [void][IO.Directory]::CreateDirectory($lockRoot)
    $id = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($TargetRoot))).TrimEnd('=').Replace('/','_').Replace('+','-')
    $lockPath = Join-Path $lockRoot ($id + '.lock')
    try { return [IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
    catch { throw "目标工程正在被本脚本的另一个实例处理，或锁文件不可用：$lockPath" }
}
function Write-AtomicFile {
    param([string]$Path,[byte[]]$Bytes)
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) { throw "目标父目录不存在，必须先通过目录事务创建：$dir" }
    $tmp = Join-Path $dir ('.' + [IO.Path]::GetFileName($Path) + '.' + [Guid]::NewGuid().ToString('N') + '.tmp')
    try {
        $fs = [IO.File]::Open($tmp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try { $fs.Write($Bytes,0,$Bytes.Length); $fs.Flush($true) } finally { $fs.Dispose() }
        if (Test-Path -LiteralPath $Path -PathType Leaf) { [IO.File]::Replace($tmp,$Path,[NullString]::Value) }
        else { [IO.File]::Move($tmp,$Path) }
    } finally {
        if (Test-Path -LiteralPath $tmp -PathType Leaf) { try { [IO.File]::Delete($tmp) } catch { } }
    }
}
function Get-RequiredDirectories {
    param([object[]]$Changes,[string]$TargetRoot)
    $set = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($c in $Changes) {
        if ($c.Operation -ne 'Write') { continue }
        $d = Split-Path -Parent $c.Path
        while ($d -and (Test-PathWithin -Root $TargetRoot -Path $d) -and -not (Test-Path -LiteralPath $d -PathType Container)) {
            [void]$set.Add([IO.Path]::GetFullPath($d))
            $parent = Split-Path -Parent $d
            if (-not $parent -or $parent -eq $d) { break }
            $d = $parent
        }
    }
    return @($set)
}
function Save-Journal {
    param([string]$JournalPath,$Journal)
    Write-JsonAtomic -Path $JournalPath -Object $Journal
}
function Invoke-ConservativeRollback {
    param([string]$TxDir,$Journal)
    $journalPath = Join-Path $TxDir 'journal.json'
    $Journal.status = 'RollingBack'
    Save-Journal $journalPath $Journal
    $filesDir = Join-Path $TxDir 'files'
    $errors = @()
    foreach ($entry in @($Journal.entries | Sort-Object -Property id -Descending)) {
        try {
            $path = [string]$entry.path
            Assert-NoReparseComponents -Path $path -Root $Journal.targetRoot
            $existsNow = Test-Path -LiteralPath $path -PathType Leaf
            if ($entry.existedBefore) {
                if (-not $entry.writeStarted) { continue }
                $backupPath = Join-Path $filesDir ([string]$entry.backupFile)
                if ($entry.backupComplete -ne $true) { throw "备份未完成校验，转人工恢复：$backupPath" }
                if (-not (Test-Path -LiteralPath $backupPath -PathType Leaf)) { throw "缺少备份文件：$backupPath" }
                if ((Get-Sha256File $backupPath) -cne [string]$entry.backupHash) { throw "备份哈希不匹配：$backupPath" }
                if ($existsNow) {
                    $currentHash = Get-Sha256File $path
                    if ($currentHash -cne [string]$entry.originalHash -and
                        ($null -eq $entry.expectedNewHash -or $currentHash -cne [string]$entry.expectedNewHash)) {
                        throw "目标内容既非原始值也非预期新值，拒绝覆盖：$path"
                    }
                } elseif ($entry.operation -eq 'Write' -and -not $entry.writeCompleted) {
                    throw "写入状态不确定且目标消失，转人工恢复：$path"
                }
                $parent = Split-Path -Parent $path
                if (-not (Test-Path -LiteralPath $parent -PathType Container)) { throw "恢复父目录不存在：$parent" }
                $restoreBytes = Read-Bytes $backupPath
                Write-AtomicFile -Path $path -Bytes $restoreBytes
                if ((Get-Sha256File $path) -cne [string]$entry.originalHash) { throw "恢复后哈希验证失败：$path" }
            } else {
                # For files that did not exist before: deletion is allowed only when
                # the journal proves a completed write and current content matches it.
                if (-not $entry.writeStarted) { continue }
                if (-not $existsNow) { continue }
                if ($null -eq $entry.expectedNewHash -or (Get-Sha256File $path) -cne [string]$entry.expectedNewHash) {
                    throw "新建文件归属无法证明或内容已变化，拒绝删除：$path"
                }
                [IO.File]::Delete($path)
            }
        } catch { $errors += ($entry.path + '：' + $_.Exception.Message) }
    }
    # Remove only directories explicitly recorded as created and still empty.
    foreach ($d in @($Journal.directories | Where-Object { $_.createdByTransaction -eq $true } | Sort-Object { $_.path.Length } -Descending)) {
        try {
            if (Test-Path -LiteralPath $d.path -PathType Container) {
                if (@(Get-ChildItem -LiteralPath $d.path -Force).Count -eq 0) { [IO.Directory]::Delete($d.path,$false) }
            }
        } catch { $errors += ($d.path + '：目录回滚失败：' + $_.Exception.Message) }
    }
    if ($errors.Count -eq 0) {
        $Journal.status = 'RolledBack'
        Save-Journal $journalPath $Journal
        return $true
    }
    $Journal.status = 'RecoveryRequired'
    $Journal.recoveryErrors = $errors
    Save-Journal $journalPath $Journal
    return $false
}
function Invoke-Changes {
    param([string]$TargetRoot,[string]$Mode,[object[]]$Changes)
    $txRoot = Get-TransactionRoot
    $txId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [Guid]::NewGuid().ToString('N')
    $txDir = Join-Path $txRoot $txId
    $backupDir = Join-Path $txDir 'files'
    $journalPath = Join-Path $txDir 'journal.json'
    $journal = [PSCustomObject]@{
        schemaVersion=1; transactionId=$txId; targetRoot=$TargetRoot; action=$Mode
        status='Preparing'; createdUtc=[DateTime]::UtcNow.ToString('o')
        entries=@(); directories=@(); recoveryErrors=@()
    }
    $journalCreated = $false
    try {
        [void][IO.Directory]::CreateDirectory($txRoot)
        [void][IO.Directory]::CreateDirectory($txDir)
        [void][IO.Directory]::CreateDirectory($backupDir)
        Save-Journal $journalPath $journal
        $journalCreated = $true
        $requiredDirs = @(Get-RequiredDirectories -Changes $Changes -TargetRoot $TargetRoot)
        foreach ($dir in ($requiredDirs | Sort-Object { $_.Length })) {
            Assert-NoReparseComponents -Path $dir -Root $TargetRoot
            $journal.directories += [PSCustomObject]@{ path=$dir; creationIntent=$true; createdByTransaction=$false }
            Save-Journal $journalPath $journal
            if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
                [void][IO.Directory]::CreateDirectory($dir)
                $record = @($journal.directories | Where-Object { $_.path -eq $dir })[0]
                $record.createdByTransaction = $true
                Save-Journal $journalPath $journal
            }
        }
        $index = 0
        foreach ($c in $Changes) {
            $index++
            $backupName = '{0:D4}.bin' -f $index
            $entry = [PSCustomObject]@{
                id=$index; path=$c.Path; operation=$c.Operation; existedBefore=$c.OriginalExists
                originalHash=$c.OriginalHash; backupFile=$(if($c.OriginalExists){$backupName}else{$null})
                backupHash=$(if($c.OriginalExists){$c.OriginalHash}else{$null})
                backupComplete=$false; expectedNewHash=$c.NewHash; writeStarted=$false; writeCompleted=$false
            }
            $journal.entries += $entry
            Save-Journal $journalPath $journal
            if ($c.OriginalExists) {
                Assert-NoReparseComponents -Path $c.Path -Root $TargetRoot
                $current = Read-Bytes $c.Path
                if ((Get-Sha256Bytes $current) -cne $c.OriginalHash) { throw "备份前目标发生变化：$($c.Path)" }
                $backupPath = Join-Path $backupDir $backupName
                [IO.File]::WriteAllBytes($backupPath,$current)
                if ((Get-Sha256File $backupPath) -cne $c.OriginalHash) { throw "备份校验失败：$($c.Path)" }
                $entry.backupComplete = $true
                Save-Journal $journalPath $journal
            } else {
                $entry.backupComplete = $true
                Save-Journal $journalPath $journal
            }
        }
        foreach ($entry in $journal.entries) {
            if ($entry.existedBefore) {
                if ($entry.backupComplete -ne $true) { throw "备份未完成：$($entry.path)" }
                $bp = Join-Path $backupDir $entry.backupFile
                if ((Get-Sha256File $bp) -cne $entry.backupHash) { throw "备份最终校验失败：$bp" }
            }
        }
        $journal.status = 'Prepared'; Save-Journal $journalPath $journal
        $journal.status = 'Applying'; Save-Journal $journalPath $journal
        foreach ($entry in $journal.entries) {
            Assert-NoReparseComponents -Path $entry.path -Root $TargetRoot
            $entry.writeStarted = $true
            Save-Journal $journalPath $journal
            $change = $Changes[$entry.id - 1]
            if ($entry.operation -eq 'Delete') {
                if (Test-Path -LiteralPath $entry.path -PathType Leaf) { [IO.File]::Delete($entry.path) }
            } else {
                Write-AtomicFile -Path $entry.path -Bytes $change.NewBytes
            }
            $entry.writeCompleted = $true
            Save-Journal $journalPath $journal
        }
        foreach ($entry in $journal.entries) {
            Assert-NoReparseComponents -Path $entry.path -Root $TargetRoot
            if ($entry.operation -eq 'Delete') {
                if (Test-Path -LiteralPath $entry.path) { throw "删除后验证失败：$($entry.path)" }
            } else {
                if ((Get-Sha256File $entry.path) -cne $entry.expectedNewHash) { throw "写入后哈希验证失败：$($entry.path)" }
            }
        }
        $journal.status = 'Committed'; Save-Journal $journalPath $journal
        Write-Host "事务完成：$txId" -ForegroundColor Green
        Write-Host "备份保留：$txDir" -ForegroundColor Green
    } catch {
        $cause = $_.Exception.Message
        if (-not $journalCreated) {
            throw "事务初始化失败，尚未修改目标文件。可能留下需人工检查的事务目录：$txDir。原因：$cause"
        }
        $rolledBack = $false
        try { $rolledBack = Invoke-ConservativeRollback -TxDir $txDir -Journal $journal } catch { }
        if ($rolledBack) { throw "执行失败，已完成回滚。事务：$txDir。原因：$cause" }
        throw "执行失败，无法证明所有目标均可安全恢复，已保留事务供人工恢复：$txDir。原因：$cause"
    }
}
function Show-Menu {
    Write-Host ''
    Write-Host 'ObjectARX-MCP 管理工具' -ForegroundColor Cyan
    Write-Host '1. Install'
    Write-Host '2. Update-Rules'
    Write-Host '3. Uninstall-Rules'
    Write-Host '0. Exit'
    while ($true) {
        $v = Read-Host '请选择'
        switch ($v) {
            '1' { return 'Install' }
            '2' { return 'Update-Rules' }
            '3' { return 'Uninstall-Rules' }
            '0' { return $null }
            default { Write-Host '无效选项。' -ForegroundColor Yellow }
        }
    }
}
function Start-Main {
    $mode = $Action
    if (-not $mode) { $mode = Show-Menu }
    if (-not $mode) { Write-Host '已退出。'; return }
    $target = Resolve-Target
    $script:ManagedRoot = Join-Path $target $script:ManagedRelativeRoot
    Assert-SourcePackage
    Assert-NoIncompleteTransactions -TargetRoot $target
    $sourceHashes = @{}
    $sourceHashes[$script:SourceClaude] = Get-Sha256File $script:SourceClaude
    $sourceHashes[$script:ServerPath] = Get-Sha256File $script:ServerPath
    foreach ($rn in $script:RuleNames) { $rp = Join-Path $script:SourceRules $rn; $sourceHashes[$rp] = Get-Sha256File $rp }
    $changes = Get-ActionChanges -Mode $mode -TargetRoot $target
    if ($changes.Count -eq 0) { Write-Host '没有需要修改的内容。' -ForegroundColor Green; return }
    foreach ($c in $changes) {
        Assert-NoReparseComponents -Path $c.Path -Root $target
    }
    Write-Host "`n目标工程：$target" -ForegroundColor Cyan
    Write-Host "操作：$mode" -ForegroundColor Cyan
    Show-Plan -Changes $changes
    $answer = Read-Host '检查完毕后，输入大写 Y 执行'
    if ($answer -cne 'Y') { Write-Host '已取消；未创建事务或修改目标工程。' -ForegroundColor Yellow; return }
    $lock = $null
    try {
        $lock = Enter-TargetLock -TargetRoot $target
        Assert-NoIncompleteTransactions -TargetRoot $target
        foreach ($sp in $sourceHashes.Keys) { if ((Get-Sha256File $sp) -cne $sourceHashes[$sp]) { throw "预览后源文件发生变化：$sp" } }
        # Recheck path components and original contents after acquiring the cooperative lock.
        Assert-NoReparseComponents -Path $target -Root $target
        foreach ($c in $changes) {
            Assert-NoReparseComponents -Path $c.Path -Root $target
            $exists = Test-Path -LiteralPath $c.Path -PathType Leaf
            if ($exists -ne $c.OriginalExists) { throw "确认后文件存在状态变化：$($c.Path)" }
            if ($exists -and (Get-Sha256File $c.Path) -cne $c.OriginalHash) { throw "确认后文件内容变化：$($c.Path)" }
        }
        Invoke-Changes -TargetRoot $target -Mode $mode -Changes $changes
    } finally {
        if ($null -ne $lock) { $lock.Dispose() }
    }
}
try { Start-Main }
catch {
    Write-Host ("ERROR: " + $_.Exception.Message) -ForegroundColor Red
    $global:LASTEXITCODE = 1
}

