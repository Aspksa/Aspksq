# Run with Windows PowerShell 5.1, the same host used by Aspksa.bat.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'Start-Tracktor.ps1') -LibraryOnly

function Assert-True {
    param([bool]$Value, [string]$Message)
    if (-not $Value) { throw $Message }
}

$temporary = Join-Path ([IO.Path]::GetTempPath()) ('tracktor-windows-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($temporary) | Out-Null
$first = $null
$duplicate = $null
$listener = $null
try {
    $python = Find-Python -ManagedPython ''
    Assert-True ([bool]$python) 'An installed Python with sqlite3 was not discovered.'
    Assert-True (-not (Test-PythonCandidate -Executable (Join-Path $temporary 'missing.exe'))) 'Missing Python was accepted.'
    $values = @('', 'два слова', 'кавычка"внутри', 'C:\путь\', "скобки () [] & ! % О'Брайен")
    $quoted = New-PythonProcess -Executable $python -Arguments (@('-c','import sys,json; print(json.dumps(sys.argv[1:],ensure_ascii=True))') + $values) -Capture
    try {
        $quoted.Start() | Out-Null
        $encoded = $quoted.StandardOutput.ReadToEndAsync()
        Assert-True ($quoted.WaitForExit(10000)) 'Argument round-trip timed out.'
        $encodedText = $encoded.GetAwaiter().GetResult()
        $decoded = $encodedText | ConvertFrom-Json
        Assert-True ($decoded.Count -eq $values.Count) ('Argument count changed: expected=' + $values.Count + '; actual=' + $decoded.Count + '; raw=' + $encodedText + '; command=' + $quoted.StartInfo.Arguments)
        for ($i=0; $i -lt $values.Count; $i++) { Assert-True ($decoded[$i] -ceq $values[$i]) 'An argument was changed by quoting.' }
    } finally { $quoted.Dispose() }


    $unsigned = Join-Path $temporary 'unsigned.exe'
    [IO.File]::WriteAllText($unsigned, 'not an installer')
    $rejected = $false
    try { Assert-PythonSignature -Installer $unsigned } catch { $rejected = $true }
    Assert-True $rejected 'An unsigned installer was accepted.'

    # Discover the highest PATCH semantically, and skip a directory without a release installer.
    function Invoke-WebRequest {
        param([switch]$UseBasicParsing, [string]$Uri, [int]$TimeoutSec)
        if ($Uri -eq 'https://www.python.org/ftp/python/') {
            return [pscustomobject]@{Content='<a href="3.13.9/">9</a><a href="3.13.10/">10</a><a href="3.13.99/">unreleased</a>'}
        }
        if ($Uri -eq 'https://www.python.org/ftp/python/3.13.99/') { return [pscustomobject]@{Content='no stable installer'} }
        if ($Uri -eq 'https://www.python.org/ftp/python/3.13.10/') { return [pscustomobject]@{Content='<a href="python-3.13.10-amd64.exe">installer</a>'} }
        throw ('Unexpected download URL: ' + $Uri)
    }
    try {
        Assert-True ((Get-PythonDownload -Architecture AMD64) -eq 'https://www.python.org/ftp/python/3.13.10/python-3.13.10-amd64.exe') 'Python version discovery failed.'
    } finally { Remove-Item Function:\Invoke-WebRequest }

    if ($env:TRACKTOR_TEST_INSTALL_PYTHON -eq '1') {
        # Genuine signed python.org installer in a disposable Windows runner.
        $script:LogPath = Join-Path $temporary 'install.log'
        $installed = Install-LocalPython -TargetDirectory (Join-Path $temporary "Python (локальный) & ! 100% О'Брайен [тест]")
        Assert-True ([bool](Test-PythonCandidate -Executable $installed)) 'Automatic user-scope Python installation failed.'
        Write-Host ('PASS: official Python download, signature and usable installation: ' + $installed)
    }

    $project = Join-Path $temporary "Русский путь (скобки) & ! 100% О'Брайен [тест]"
    [IO.Directory]::CreateDirectory($project) | Out-Null
    foreach ($name in @('Aspksa.bat','Start-Tracktor.ps1','server.py','cloudru.py','cloud.js','sqlite-schema.sql','seed-data.json','index.html','app.js','database.js','styles.css')) {
        [IO.File]::Copy((Join-Path $root $name), (Join-Path $project $name))
    }
    $env:TRACKTOR_NO_BROWSER = '1'
    # The launcher must neither terminate nor open a different application on this port.
    try {
        $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 4173)
        $listener.Start()
    } catch { $listener = $null }
    $arguments = '/d /v:off /s /c ""' + (Join-Path $project 'Aspksa.bat') + '""'
    $first = Start-Process -FilePath $env:ComSpec -ArgumentList $arguments -PassThru -RedirectStandardOutput (Join-Path $temporary 'first.out') -RedirectStandardError (Join-Path $temporary 'first.err')
    $statePath = Join-Path $project 'data\tracktor.server.json'
    $deadline = (Get-Date).AddSeconds(90)
    $info = $null
    while ((Get-Date) -lt $deadline) {
        if ([IO.File]::Exists($statePath)) {
            try {
                $state = [IO.File]::ReadAllText($statePath) | ConvertFrom-Json
                $url = 'http://127.0.0.1:' + $state.port + '/'
                $info = Invoke-RestMethod -Uri ($url + 'api/status') -TimeoutSec 2
                break
            } catch { }
        }
        if ($first.HasExited) { throw ('BAT exited early: ' + [IO.File]::ReadAllText((Join-Path $temporary 'first.out')) + [IO.File]::ReadAllText((Join-Path $temporary 'first.err'))) }
        Start-Sleep -Milliseconds 200
    }
    if (-not $info) {
        throw ('BAT did not start server: ' + [IO.File]::ReadAllText((Join-Path $temporary 'first.out')) + [IO.File]::ReadAllText((Join-Path $temporary 'first.err')))
    }
    Assert-True ($info.app -eq 'tracktor-local') 'Wrong local service.'
    Assert-True ($state.port -ne 4173) 'Occupied port was not avoided.'
    Assert-True ($info.database -eq (Join-Path $project 'data\tracktor.sqlite3')) 'Database path was corrupted.'
    $body = [Text.Encoding]::UTF8.GetBytes((@{name="Русский навык (тест) & ! % ' [1]"} | ConvertTo-Json))
    $skill = Invoke-RestMethod -Uri ($url + 'api/skills') -Method Post -Body $body -ContentType 'application/json; charset=utf-8'
    Assert-True ($skill.name -eq "Русский навык (тест) & ! % ' [1]") 'Russian text did not round-trip.'
    $duplicate = Start-Process -FilePath $env:ComSpec -ArgumentList $arguments -PassThru -RedirectStandardOutput (Join-Path $temporary 'duplicate.out') -RedirectStandardError (Join-Path $temporary 'duplicate.err')
    # Keep the native handle before exit: Start-Process otherwise loses ExitCode on PowerShell 5.1.
    $duplicateHandle = $duplicate.Handle
    Assert-True ($duplicate.WaitForExit(30000)) 'Repeated BAT did not exit.'
    $duplicate.Refresh()
    Assert-True ($duplicate.ExitCode -eq 0) ('Repeated BAT failed. Exit=' + $duplicate.ExitCode + '; stdout=' + [IO.File]::ReadAllText((Join-Path $temporary 'duplicate.out')) + '; stderr=' + [IO.File]::ReadAllText((Join-Path $temporary 'duplicate.err')) + '; log=' + [IO.File]::ReadAllText((Join-Path $project 'data\launcher.log')))
    $after = Invoke-RestMethod -Uri ($url + 'api/status') -TimeoutSec 2
    Assert-True ($after.instance_id -eq $info.instance_id) 'Repeated BAT started a different server.'
    Write-Host 'PASS: actual BAT with Cyrillic, spaces, parentheses, &, !, %, apostrophe and brackets; occupied port; duplicate launch; Russian SQLite data.'
} finally {
    foreach ($process in @($duplicate, $first)) {
        if ($process -and -not $process.HasExited) {
            & taskkill.exe /PID $process.Id /T /F | Out-Null
            $process.WaitForExit(10000) | Out-Null
        }
    }
    if ($listener) { $listener.Stop() }
    Remove-Item Env:\TRACKTOR_NO_BROWSER -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
}
