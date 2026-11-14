# Windows CI only: Desktop/Documents and two NEW disposable virtual USB-like volumes.
# No existing disk is selected, partitioned or formatted.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'Start-Tracktor.ps1') -LibraryOnly
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('tracktor-portable-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($temporary) | Out-Null
$createdFolders = New-Object Collections.Generic.List[string]
$virtualDisks = New-Object Collections.Generic.List[string]
$testName = "TRACKTOR (перенос) & ! 100% О'Брайен [тест] " + [guid]::NewGuid().ToString('N').Substring(0,8)
$marker = '/перенос-' + [guid]::NewGuid().ToString('N')

function Assert-Portable {
    param([bool]$Value, [string]$Message)
    if (-not $Value) { throw $Message }
}

function Copy-PortableTree {
    param([string]$Source, [string]$Destination)
    [IO.Directory]::CreateDirectory($Destination) | Out-Null
    foreach ($entry in @(Get-ChildItem -LiteralPath $Source -Force)) {
        $target = Join-Path $Destination $entry.Name
        if ($entry.PSIsContainer) { Copy-PortableTree -Source $entry.FullName -Destination $target }
        else { [IO.File]::Copy($entry.FullName, $target, $true) }
    }
}

function Stop-PortableProcess {
    param($Process)
    if ($Process) {
        try {
            if (-not $Process.HasExited) {
                $killer = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\taskkill.exe') -ArgumentList @('/PID', [string]$Process.Id, '/T', '/F') -Wait -PassThru -NoNewWindow
                Assert-Portable ($Process.WaitForExit(10000)) 'Test launcher did not stop.'
                $killer.Dispose()
            }
        } finally { $Process.Dispose() }
    }
}

function Test-PortableLaunch {
    param([string]$Project, [switch]$FirstRun)
    $first = $null
    $duplicate = $null
    $serverProcess = $null
    $logPrefix = Join-Path $temporary ([guid]::NewGuid().ToString('N'))
    $arguments = '/d /v:off /s /c ""' + (Join-Path $Project 'Aspksa.bat') + '""'
    try {
        # Deliberately unrelated cwd: no dependence on drive/current folder.
        $first = Start-Process -FilePath $env:ComSpec -ArgumentList $arguments -WorkingDirectory $env:SystemRoot -PassThru -RedirectStandardOutput ($logPrefix+'.out') -RedirectStandardError ($logPrefix+'.err')
        $firstHandle = $first.Handle
        $statePath = Join-Path $Project 'data\tracktor.server.json'
        $deadline = (Get-Date).AddSeconds(60)
        $info = $null
        while ((Get-Date) -lt $deadline) {
            if ([IO.File]::Exists($statePath)) {
                try {
                    $state = [IO.File]::ReadAllText($statePath) | ConvertFrom-Json
                    $url = 'http://127.0.0.1:' + $state.port + '/'
                    $candidate = Invoke-RestMethod -Uri ($url + 'api/status') -TimeoutSec 2
                    if ($candidate.instance_id -eq $state.instance_id -and $candidate.database -eq (Join-Path $Project 'data\tracktor.sqlite3')) {
                        $info = $candidate
                        $serverProcess = [Diagnostics.Process]::GetProcessById([int]$state.pid)
                        $serverHandle = $serverProcess.Handle
                        break
                    }
                } catch { }
            }
            if ($first.HasExited) { break }
            Start-Sleep -Milliseconds 150
        }
        if (-not $info) {
            throw ('Portable launch failed for ' + $Project + ': ' + [IO.File]::ReadAllText($logPrefix+'.out') + [IO.File]::ReadAllText($logPrefix+'.err'))
        }
        Assert-Portable ((Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 5).StatusCode -eq 200) 'Site is unavailable.'
        if ($FirstRun) {
            $body = [Text.Encoding]::UTF8.GetBytes((@{name=$marker;description='Данные должны переехать вместе с папкой.'} | ConvertTo-Json))
            $saved = Invoke-RestMethod -Uri ($url+'api/skills') -Method Post -Body $body -ContentType 'application/json; charset=utf-8'
        }
        $skills = @(Invoke-RestMethod -Uri ($url+'api/skills') -TimeoutSec 5)
        Assert-Portable (@($skills | Where-Object { $_.name -eq $marker }).Count -eq 1) 'Data were reset or duplicated after moving the folder.'
        $duplicate = Start-Process -FilePath $env:ComSpec -ArgumentList $arguments -WorkingDirectory $env:SystemRoot -PassThru -RedirectStandardOutput ($logPrefix+'.duplicate.out') -RedirectStandardError ($logPrefix+'.duplicate.err')
        $duplicateHandle = $duplicate.Handle
        Assert-Portable ($duplicate.WaitForExit(30000)) 'Duplicate portable launcher did not exit.'
        Assert-Portable ($duplicate.ExitCode -eq 0) ('Duplicate launcher failed: ' + [IO.File]::ReadAllText($logPrefix+'.duplicate.out') + [IO.File]::ReadAllText($logPrefix+'.duplicate.err'))
        Assert-Portable ((Invoke-RestMethod -Uri ($url+'api/status')).instance_id -eq $info.instance_id) 'A second server was started.'
        Write-Host ('PASS portable BAT and preserved SQLite data: ' + $Project)
    } finally {
        Stop-PortableProcess $duplicate
        Stop-PortableProcess $first
        if ($serverProcess) {
            try { Assert-Portable ($serverProcess.WaitForExit(10000)) 'Server did not release its files.' }
            finally { $serverProcess.Dispose() }
        }
    }
}

function Get-FreeLetter {
    $drives = @([Environment]::GetLogicalDrives())
    foreach ($letter in @('Z','Y','X','W','V','U','T')) {
        if ($drives -notcontains ($letter + ':\')) { return $letter }
    }
    throw 'No free drive letter for disposable test disk.'
}

function Invoke-TestDiskPart {
    param([string[]]$Commands)
    $prefix = Join-Path $temporary ([guid]::NewGuid().ToString('N'))
    [IO.File]::WriteAllLines($prefix+'.txt', $Commands, [Text.Encoding]::ASCII)
    $process = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\diskpart.exe') -ArgumentList ('/s "'+$prefix+'.txt"') -Wait -PassThru -RedirectStandardOutput ($prefix+'.out') -RedirectStandardError ($prefix+'.err')
    try {
        if ($process.ExitCode -ne 0) { throw ('Virtual disk setup failed: ' + [IO.File]::ReadAllText($prefix+'.out') + [IO.File]::ReadAllText($prefix+'.err')) }
    } finally { $process.Dispose() }
}

try {
    $env:TRACKTOR_NO_BROWSER = '1'
    $desktop = [Environment]::GetFolderPath('Desktop')
    if (-not $desktop) { $desktop = Join-Path $env:USERPROFILE 'Desktop' }
    $documents = [Environment]::GetFolderPath('MyDocuments')
    if (-not $documents) { $documents = Join-Path $env:USERPROFILE 'Documents' }
    $project = Join-Path $desktop $testName
    [IO.Directory]::CreateDirectory($project) | Out-Null
    $createdFolders.Add($project)
    foreach ($name in @('Aspksa.bat','Start-Tracktor.ps1','server.py','sqlite-schema.sql','seed-data.json','index.html','app.js','database.js','styles.css')) {
        [IO.File]::Copy((Join-Path $root $name), (Join-Path $project $name))
    }
    Test-PortableLaunch -Project $project -FirstRun

    $moved = Join-Path $documents $testName
    [IO.Directory]::CreateDirectory($documents) | Out-Null
    [IO.Directory]::Move($project, $moved)
    $createdFolders.Add($moved)
    Test-PortableLaunch -Project $moved

    $nested = Join-Path $temporary ('Другая папка\Вложенная папка\' + $testName)
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($nested)) | Out-Null
    [IO.Directory]::Move($moved, $nested)
    Test-PortableLaunch -Project $nested

    foreach ($filesystem in @('exFAT','FAT32')) {
        $letter = Get-FreeLetter
        $disk = Join-Path $temporary ($filesystem+'.vhd')
        # All diskpart commands stop on errors; only this NEW file is ever selected.
        Assert-Portable (-not [IO.File]::Exists($disk)) 'Test virtual disk already exists.'
        $virtualDisks.Add($disk)
        Invoke-TestDiskPart -Commands @(('create vdisk file="'+$disk+'" maximum=128 type=expandable'), ('select vdisk file="'+$disk+'"'), 'attach vdisk', 'create partition primary', ('format fs='+$filesystem+' quick label=TRACKTOR'), ('assign letter='+$letter))
        Assert-Portable ([IO.Directory]::Exists($letter+':\')) 'Test virtual disk did not mount.'
        $drive = New-Object IO.DriveInfo($letter+':\')
        Assert-Portable ($drive.DriveFormat -eq $filesystem) 'Wrong test filesystem.'
        $onDisk = Join-Path ($letter+':\') $testName
        Copy-PortableTree -Source $nested -Destination $onDisk
        Test-PortableLaunch -Project $onDisk

        $newLetter = Get-FreeLetter
        Invoke-TestDiskPart -Commands @(('select vdisk file="'+$disk+'"'), 'select partition 1', ('remove letter='+$letter), ('assign letter='+$newLetter))
        $old = Join-Path ($newLetter+':\') $testName
        $renamed = Join-Path ($newLetter+':\') ('После переноса\'+$testName)
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($renamed)) | Out-Null
        [IO.Directory]::Move($old, $renamed)
        Test-PortableLaunch -Project $renamed

        $database = Join-Path $renamed 'data\tracktor.sqlite3'
        $attributes = [IO.File]::GetAttributes($database)
        try {
            [IO.File]::SetAttributes($database, ($attributes -bor [IO.FileAttributes]::ReadOnly))
            $blocked = $false
            try { Test-PortableStorage -ProjectDirectory $renamed | Out-Null } catch { $blocked = $_.Exception.Message.Contains('Только чтение') }
            Assert-Portable $blocked 'Read-only SQLite file was not detected.'
        } finally { [IO.File]::SetAttributes($database, $attributes) }
        Write-Host ('PASS: '+$filesystem+' SQLite, changed drive letter, moved folder, duplicate launch, read-only file detection.')
        Invoke-TestDiskPart -Commands @(('select vdisk file="'+$disk+'"'), 'detach vdisk')
        $virtualDisks.Remove($disk) | Out-Null
    }
} finally {
    foreach ($disk in $virtualDisks) {
        try { Invoke-TestDiskPart -Commands @(('select vdisk file="'+$disk+'"'), 'detach vdisk') } catch { Write-Host $_ }
    }
    foreach ($folder in $createdFolders) { Remove-Item -LiteralPath $folder -Force -Recurse -ErrorAction SilentlyContinue }
    Remove-Item Env:\TRACKTOR_NO_BROWSER -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $temporary -Force -Recurse -ErrorAction SilentlyContinue
}
