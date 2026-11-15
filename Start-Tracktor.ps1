param([switch]$LibraryOnly)

# UTF-8 BOM is intentional: Windows PowerShell 5.1 otherwise misreads Russian.
$ErrorActionPreference = 'Stop'

function ConvertTo-WindowsArgument {
    param([string]$Value)
    # Windows CRT quoting, including backslashes before quotes or closing quote.
    $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
}

function New-PythonProcess {
    param([string]$Executable, [string[]]$Arguments, [switch]$Capture)
    $process = New-Object Diagnostics.Process
    $process.StartInfo.FileName = $Executable
    $process.StartInfo.Arguments = (@($Arguments | ForEach-Object { ConvertTo-WindowsArgument $_ }) -join ' ')
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = [bool]$Capture
    $process.StartInfo.RedirectStandardOutput = [bool]$Capture
    $process.StartInfo.RedirectStandardError = [bool]$Capture
    return $process
}

function Test-PythonCandidate {
    param([string]$Executable, [string[]]$Prefix = @())
    if (-not $Executable -or -not (Test-Path -LiteralPath $Executable -PathType Leaf)) { return $null }
    if ($Executable -like '*\Microsoft\WindowsApps\python*.exe') { return $null }
    $process = $null
    try {
        $probe = 'import sys, sqlite3, json; print(json.dumps(sys.executable, ensure_ascii=True)) if sys.version_info >= (3, 9) else sys.exit(1)'
        # ProcessStartInfo uses an exact executable path; no PowerShell wildcard parsing.
        $process = New-PythonProcess -Executable $Executable -Arguments (@($Prefix) + @('-c', $probe)) -Capture
        $process.Start() | Out-Null
        $output = $process.StandardOutput.ReadToEndAsync()
        $errors = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(10000)) { $process.Kill(); return $null }
        $result = $output.GetAwaiter().GetResult()
        $errorText = $errors.GetAwaiter().GetResult()
        if ($process.ExitCode -eq 0 -and $result) {
            $actual = $result.Trim() | ConvertFrom-Json
            if (Test-Path -LiteralPath $actual -PathType Leaf) { return $actual }
        }
        Write-LauncherLog ('Python rejected: ' + $Executable + '; exit=' + $process.ExitCode + '; ' + $errorText)
    } catch { Write-LauncherLog ('Python probe failed: ' + $Executable + '; ' + $_.Exception.Message) }
    finally { if ($process) { $process.Dispose() } }
    return $null
}

function Find-RegisteredPython {
    param([string]$VersionPrefix = '')
    foreach ($registryRoot in @('HKCU:\Software\Python\PythonCore', 'HKLM:\Software\Python\PythonCore', 'HKLM:\Software\WOW6432Node\Python\PythonCore')) {
        if (-not (Test-Path -LiteralPath $registryRoot)) { continue }
        foreach ($version in @(Get-ChildItem -LiteralPath $registryRoot -ErrorAction SilentlyContinue | Sort-Object PSChildName -Descending)) {
            if ($VersionPrefix -and -not $version.PSChildName.StartsWith($VersionPrefix)) { continue }
            $keyPath = Join-Path $version.PSPath 'InstallPath'
            if (-not (Test-Path -LiteralPath $keyPath)) { continue }
            $key = Get-Item -LiteralPath $keyPath
            try {
                $executable = $key.GetValue('ExecutablePath')
                if (-not $executable -and $key.GetValue('')) { $executable = Join-Path $key.GetValue('') 'python.exe' }
                $found = Test-PythonCandidate -Executable $executable
                if ($found) { return $found }
            } finally { $key.Close() }
        }
    }
    return $null
}

function Find-Python {
    param([string]$ManagedPython)
    $found = Test-PythonCandidate -Executable $ManagedPython
    if ($found) { return $found }
    foreach ($commandName in @('py.exe', 'python.exe', 'python3.exe')) {
        foreach ($command in @(Get-Command $commandName -CommandType Application -All -ErrorAction SilentlyContinue)) {
            $prefix = @()
            if ($commandName -eq 'py.exe') { $prefix = @('-3') }
            $found = Test-PythonCandidate -Executable $command.Source -Prefix $prefix
            if ($found) { return $found }
        }
    }
    $found = Find-RegisteredPython
    if ($found) { return $found }
    $pythonRoot = Join-Path $env:LOCALAPPDATA 'Programs\Python'
    if (Test-Path -LiteralPath $pythonRoot) {
        foreach ($folder in @(Get-ChildItem -LiteralPath $pythonRoot -Directory | Sort-Object Name -Descending)) {
            $found = Test-PythonCandidate -Executable (Join-Path $folder.FullName 'python.exe')
            if ($found) { return $found }
        }
    }
    return $null
}

function Get-PythonDownload {
    # Fixed maintained minor version, newest published patch. No third-party host.
    param([string]$Architecture)
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $index = Invoke-WebRequest -UseBasicParsing -Uri 'https://www.python.org/ftp/python/' -TimeoutSec 60
    $versions = @([regex]::Matches($index.Content, 'href="(3\.13\.\d+)/"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object { [version]$_ } -Descending -Unique)
    $suffix = switch ($Architecture) { 'ARM64' { '-arm64' } 'AMD64' { '-amd64' } 'x86' { '' } default { throw 'Не удалось определить архитектуру Windows.' } }
    foreach ($version in @($versions | Select-Object -First 3)) {
        $filename = 'python-' + $version + $suffix + '.exe'
        $directory = Invoke-WebRequest -UseBasicParsing -Uri ('https://www.python.org/ftp/python/' + $version + '/') -TimeoutSec 60
        if ($directory.Content -match ('href="' + [regex]::Escape($filename) + '"')) {
            return 'https://www.python.org/ftp/python/' + $version + '/' + $filename
        }
    }
    throw 'Не найден официальный установщик Python. Проверьте доступ к python.org.'
}

function Assert-PythonSignature {
    param([string]$Installer)
    $signature = Get-AuthenticodeSignature -LiteralPath $Installer
    if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate -or $signature.SignerCertificate.Subject -notmatch '(?:^|,\s*)O=Python Software Foundation(?:,|$)') {
        throw 'Цифровая подпись установщика Python не подтверждена. Установка отменена.'
    }
}

function Install-LocalPython {
    param([string]$TargetDirectory)
    $architecture = $env:PROCESSOR_ARCHITEW6432
    if (-not $architecture) { $architecture = $env:PROCESSOR_ARCHITECTURE }
    $download = Get-PythonDownload -Architecture $architecture
    $temporary = Join-Path ([IO.Path]::GetTempPath()) ('Tracktor-Python-' + [guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($temporary) | Out-Null
    try {
        $installer = Join-Path $temporary 'python-installer.exe'
        Write-Host 'Подходящий Python не найден. Скачиваю установщик с python.org…'
        Write-LauncherLog ('Download: ' + $download)
        $previousProgress = $ProgressPreference
        try {
            $ProgressPreference = 'SilentlyContinue'
            Invoke-WebRequest -UseBasicParsing -Uri $download -OutFile $installer -TimeoutSec 300
        } finally { $ProgressPreference = $previousProgress }
        Assert-PythonSignature -Installer $installer
        Write-Host 'Подпись проверена. Устанавливаю Python для текущего пользователя…'
        $installLog = Join-Path $temporary 'installer.log'
        $arguments = @('/quiet', '/log', ('"' + $installLog + '"'), 'InstallAllUsers=0', 'PrependPath=0', 'Include_launcher=0', 'Include_test=0', 'Include_pip=0', 'Include_doc=0', 'Include_tcltk=0', ('TargetDir="' + $TargetDirectory + '"'))
        $installation = Start-Process -FilePath $installer -ArgumentList $arguments -Wait -PassThru
        if ($installation.ExitCode -notin @(0, 3010)) { throw ('Установщик Python завершился с кодом ' + $installation.ExitCode + '.') }
        Write-Host ('Проверяю установленный Python: ' + (Join-Path $TargetDirectory 'python.exe'))
        $python = Test-PythonCandidate -Executable (Join-Path $TargetDirectory 'python.exe')
        if (-not $python) {
            # An existing installation of the exact release can enter maintenance
            # mode and retain its registered location instead of TargetDir.
            if ([IO.File]::Exists($installLog)) {
                $details = @(Get-Content -LiteralPath $installLog | Select-String -Pattern 'TargetDir|Apply complete|error' | Select-Object -Last 20)
                foreach ($line in $details) { Write-LauncherLog ([string]$line) }
            }
            $python = Find-RegisteredPython -VersionPrefix '3.13'
        }

        if (-not $python) {
            if ($script:LogPath -and [IO.File]::Exists($script:LogPath)) { Write-Host ([IO.File]::ReadAllText($script:LogPath)) }
            throw ('Python установлен, но проверка Python и SQLite не пройдена. Файл существует: ' + [IO.File]::Exists((Join-Path $TargetDirectory 'python.exe')))
        }
        return $python
    } finally {
        Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Test-PortableStorage {
    param([string]$ProjectDirectory)
    $dataDirectory = Join-Path $ProjectDirectory 'data'
    $probe = $null
    $renamed = $null
    try {
        [IO.Directory]::CreateDirectory($dataDirectory) | Out-Null
        $database = Join-Path $dataDirectory 'tracktor.sqlite3'
        if ([IO.File]::Exists($database) -and (([IO.File]::GetAttributes($database) -band [IO.FileAttributes]::ReadOnly) -ne 0)) {
            throw 'Файл базы имеет атрибут «Только чтение».'
        }
        $probe = Join-Path $dataDirectory ('.w-' + [guid]::NewGuid().ToString('N').Substring(0,16))
        $renamed = $probe + '.renamed'
        # SQLite needs both file writes and directory operations for its journal.
        [IO.File]::WriteAllText($probe, 'TRACKTOR', (New-Object Text.UTF8Encoding($false)))
        [IO.File]::Move($probe, $renamed)
        [IO.File]::Delete($renamed)
        return $dataDirectory
    } catch {
        throw ('Папка данных недоступна для записи: ' + $dataDirectory + '. Проверьте подключение флешки/диска, защиту от записи и права доступа. База должна оставаться в папке data рядом с приложением. ' + $_.Exception.Message)
    } finally {
        foreach ($path in @($probe, $renamed)) {
            if ($path) { try { [IO.File]::Delete($path) } catch { } }
        }
    }
}

function Write-LauncherLog {
    param([string]$Message)
    if ($script:LogPath) {
        Add-Content -LiteralPath $script:LogPath -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $Message) -Encoding UTF8
    }
}

if ($LibraryOnly) { return }

$script:LogPath = $null
$exitCode = 1
$startupStage = 'storage'
try {
    $utf8 = New-Object Text.UTF8Encoding($false)
    [Console]::OutputEncoding = $utf8
    $OutputEncoding = $utf8
    $env:PYTHONUTF8 = '1'
    $env:PYTHONIOENCODING = 'utf-8'
    foreach ($required in @('server.py','cloudru.py','cloud.js','skillrunner.py','skills.js','chatrunner.py','assistant.js','knowledge.py','knowledge.js', 'sqlite-schema.sql', 'seed-data.json', 'index.html', 'database.js', 'app.js', 'styles.css')) {
        if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $required) -PathType Leaf)) {
            throw ('Не найден ' + $required + '. Сначала распакуйте архив целиком, затем запустите Aspksa.bat.')
        }
    }
    $dataDirectory = Test-PortableStorage -ProjectDirectory $PSScriptRoot
    $script:LogPath = Join-Path $dataDirectory 'launcher.log'
    Write-LauncherLog ('Start: ' + $PSScriptRoot)
    $startupStage = 'python'
    $managedDirectory = Join-Path $env:LOCALAPPDATA 'Aspksa\Python313'
    $managedPython = Join-Path $managedDirectory 'python.exe'
    # Serialize detection/installation across repeated clicks and project copies.
    $mutex = New-Object Threading.Mutex($false, 'Local\AspksaPythonInstall-v1')
    $ownsMutex = $false
    try {
        try { $ownsMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
        if (-not $ownsMutex) {
            Write-Host 'Уже идёт подготовка Python. Ожидаю завершения…'
            try { $ownsMutex = $mutex.WaitOne(600000) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
        }
        if (-not $ownsMutex) { throw 'Не удалось дождаться установки Python. Посмотрите data\launcher.log.' }
        $python = Find-Python -ManagedPython $managedPython
        if (-not $python) { $python = Install-LocalPython -TargetDirectory $managedDirectory }
    } finally {
        if ($ownsMutex) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
    Write-LauncherLog ('Python: ' + $python)
    $startupStage = 'server'
    Write-Host 'Запускаю TRACKTOR. Окно сервера оставьте открытым.'
    # An absolute DB path keeps data next to this copy, regardless of working directory or drive letter.
    $serverArguments = @((Join-Path $PSScriptRoot 'server.py'), '--database', (Join-Path $dataDirectory 'tracktor.sqlite3'))
    if ($env:TRACKTOR_NO_BROWSER -ne '1') { $serverArguments += '--open-browser' }
    # Inherit the console directly, avoiding shell expansion and stderr conversion.
    $server = New-PythonProcess -Executable $python -Arguments $serverArguments
    try {
        $server.Start() | Out-Null
        $server.WaitForExit()
        $exitCode = $server.ExitCode
    } finally { $server.Dispose() }
    Write-LauncherLog ('Server exit code: ' + $exitCode)
    if ($exitCode -ne 0) { Write-Host 'Не удалось запустить приложение. Подробности выше; журнал: data\launcher.log.' -ForegroundColor Red }
} catch {
    Write-Host ('Ошибка запуска: ' + $_.Exception.Message) -ForegroundColor Red
    try { Write-LauncherLog ('ERROR: ' + $_.Exception.ToString()) } catch { }
    if ($startupStage -eq 'python') {
        Write-Host 'Если нет интернета, установите Python 3.9+ с https://www.python.org/downloads/ и повторите запуск.'
    } else {
        Write-Host 'Проверьте, что архив распакован целиком, диск подключён и папка разрешает запись. При переносе сначала остановите сервер.'
    }
    $exitCode = 1
}
exit $exitCode
