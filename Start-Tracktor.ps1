param([switch]$LibraryOnly)

# UTF-8 BOM is intentional: Windows PowerShell 5.1 otherwise misreads Russian.
$ErrorActionPreference = 'Stop'

function Test-PythonCandidate {
    param([string]$Executable, [string[]]$Prefix = @())
    if (-not $Executable -or -not (Test-Path -LiteralPath $Executable -PathType Leaf)) { return $null }
    # Microsoft Store execution aliases may open the Store instead of Python.
    if ($Executable -like '*\Microsoft\WindowsApps\python*.exe') { return $null }
    try {
        $probe = 'import sys, sqlite3, json; print(json.dumps(sys.executable, ensure_ascii=True)) if sys.version_info >= (3, 9) else sys.exit(1)'
        $result = & $Executable @Prefix -c $probe 2>$null
        if ($LASTEXITCODE -eq 0 -and $result) {
            $actual = ([string](@($result)[-1])).Trim() | ConvertFrom-Json
            if (Test-Path -LiteralPath $actual -PathType Leaf) { return $actual }
        }
    } catch { }
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
        $arguments = @('/quiet', 'InstallAllUsers=0', 'PrependPath=0', 'Include_launcher=0', 'Include_test=0', 'Include_pip=0', 'Include_doc=0', 'Include_tcltk=0', ('TargetDir="' + $TargetDirectory + '"'))
        $installation = Start-Process -FilePath $installer -ArgumentList $arguments -Wait -PassThru
        if ($installation.ExitCode -notin @(0, 3010)) { throw ('Установщик Python завершился с кодом ' + $installation.ExitCode + '.') }
        $python = Test-PythonCandidate -Executable (Join-Path $TargetDirectory 'python.exe')
        if (-not $python) { throw 'Python установлен, но проверка Python и SQLite не пройдена.' }
        return $python
    } finally {
        Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
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
try {
    $utf8 = New-Object Text.UTF8Encoding($false)
    [Console]::OutputEncoding = $utf8
    $OutputEncoding = $utf8
    $env:PYTHONUTF8 = '1'
    $env:PYTHONIOENCODING = 'utf-8'
    foreach ($required in @('server.py', 'sqlite-schema.sql', 'seed-data.json', 'index.html', 'database.js', 'app.js', 'styles.css')) {
        if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $required) -PathType Leaf)) {
            throw ('Не найден ' + $required + '. Сначала распакуйте архив целиком, затем запустите Aspksa.bat.')
        }
    }
    $dataDirectory = Join-Path $PSScriptRoot 'data'
    [IO.Directory]::CreateDirectory($dataDirectory) | Out-Null
    $script:LogPath = Join-Path $dataDirectory 'launcher.log'
    Write-LauncherLog ('Start: ' + $PSScriptRoot)
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
    Write-Host 'Запускаю TRACKTOR. Окно сервера оставьте открытым.'
    $serverArguments = @((Join-Path $PSScriptRoot 'server.py'))
    if ($env:TRACKTOR_NO_BROWSER -ne '1') { $serverArguments += '--open-browser' }
    # Native stderr stays attached to the console, not a terminating PowerShell error.
    $ErrorActionPreference = 'Continue'
    & $python @serverArguments
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    Write-LauncherLog ('Server exit code: ' + $exitCode)
    if ($exitCode -ne 0) { Write-Host 'Не удалось запустить приложение. Подробности выше; журнал: data\launcher.log.' -ForegroundColor Red }
} catch {
    Write-Host ('Ошибка запуска: ' + $_.Exception.Message) -ForegroundColor Red
    try { Write-LauncherLog ('ERROR: ' + $_.Exception.ToString()) } catch { }
    Write-Host 'Если нет интернета, установите Python 3.9+ с https://www.python.org/downloads/ и повторите запуск.'
    $exitCode = 1
}
exit $exitCode
