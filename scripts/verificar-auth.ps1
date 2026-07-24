$baseUrl = "http://localhost:55803/api"
$email = Read-Host "Email"
$securePassword = Read-Host "Contraseña" -AsSecureString
$password = [System.Net.NetworkCredential]::new("", $securePassword).Password

function Get-ErrorBody {
    param($ErrorRecord)

    if ($ErrorRecord.ErrorDetails.Message) {
        return $ErrorRecord.ErrorDetails.Message | ConvertFrom-Json
    }

    $response = $ErrorRecord.Exception.Response
    if (!$response) {
        throw $ErrorRecord
    }

    if ($response.Content) {
        $raw = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    }
    else {
        $reader = [System.IO.StreamReader]::new($response.GetResponseStream())
        $raw = $reader.ReadToEnd()
        $reader.Dispose()
    }

    return $raw | ConvertFrom-Json
}

$health = Invoke-RestMethod `
    -Method Get `
    -Uri "$baseUrl/health"

$health | ConvertTo-Json -Depth 5

if (
    !$health.success -or
    $health.data.service -ne "examio-api" -or
    $health.data.database -ne "reachable"
) {
    throw "Health check incorrecto"
}

Write-Host "OK: API y SQL Server disponibles" -ForegroundColor Green

$loginBody = @{
    Email = $email
    Password = $password
} | ConvertTo-Json

$login = Invoke-RestMethod `
    -Method Post `
    -Uri "$baseUrl/auth/login" `
    -ContentType "application/json" `
    -Body $loginBody

if (!$login.success) {
    throw "El login no fue exitoso"
}

if ([string]::IsNullOrWhiteSpace($login.data.accessToken)) {
    throw "Falta accessToken"
}

if ([string]::IsNullOrWhiteSpace($login.data.refreshToken)) {
    throw "Falta refreshToken"
}

if ([string]::IsNullOrWhiteSpace($login.data.accessTokenExpiresAt)) {
    throw "Falta accessTokenExpiresAt"
}

if ([string]::IsNullOrWhiteSpace($login.data.refreshTokenExpiresAt)) {
    throw "Falta refreshTokenExpiresAt"
}

if ($login.data.token -ne $login.data.accessToken) {
    throw "El alias legacy token no coincide con accessToken"
}

Write-Host "OK: login válido" -ForegroundColor Green
Write-Host "Rol:" $login.data.user.role
Write-Host "Access expira:" $login.data.accessTokenExpiresAt
Write-Host "Sesión expira:" $login.data.refreshTokenExpiresAt

$originalAccessToken = $login.data.accessToken
$originalRefreshToken = $login.data.refreshToken
$idempotencyKey = [guid]::NewGuid().ToString()

$refreshBody = @{
    RefreshToken = $originalRefreshToken
} | ConvertTo-Json

$refresh1 = Invoke-RestMethod `
    -Method Post `
    -Uri "$baseUrl/auth/refresh" `
    -ContentType "application/json" `
    -Headers @{ "Idempotency-Key" = $idempotencyKey } `
    -Body $refreshBody

if (!$refresh1.success) {
    throw "Refresh no exitoso"
}

if ($refresh1.data.accessToken -eq $originalAccessToken) {
    throw "El access token no cambió"
}

if ($refresh1.data.refreshToken -eq $originalRefreshToken) {
    throw "El refresh token no rotó"
}

if (
    $refresh1.data.refreshTokenExpiresAt -ne
    $login.data.refreshTokenExpiresAt
) {
    throw "El refresh extendió indebidamente la sesión absoluta"
}

Write-Host "OK: refresh rotó ambos tokens" -ForegroundColor Green
Write-Host "OK: conservó el máximo absoluto de sesión" -ForegroundColor Green

$refresh2 = Invoke-RestMethod `
    -Method Post `
    -Uri "$baseUrl/auth/refresh" `
    -ContentType "application/json" `
    -Headers @{ "Idempotency-Key" = $idempotencyKey } `
    -Body $refreshBody

$differentFields = @()
foreach ($field in @(
    "accessToken",
    "refreshToken",
    "accessTokenExpiresAt",
    "refreshTokenExpiresAt"
)) {
    if ($refresh1.data.$field -cne $refresh2.data.$field) {
        $differentFields += $field
    }
}

if ($differentFields.Count -gt 0) {
    throw "La repetición idempotente difiere en: $($differentFields -join ', ')"
}

Write-Host "OK: misma clave devuelve exactamente el mismo resultado" -ForegroundColor Green

$logoutBody = @{
    RefreshToken = $refresh1.data.refreshToken
} | ConvertTo-Json

$logout = Invoke-RestMethod `
    -Method Post `
    -Uri "$baseUrl/auth/logout" `
    -ContentType "application/json" `
    -Headers @{
        Authorization = "Bearer $($refresh1.data.accessToken)"
    } `
    -Body $logoutBody

if (!$logout.success) {
    throw "Logout no exitoso"
}

Write-Host "OK: logout exitoso" -ForegroundColor Green

$logoutAgain = Invoke-RestMethod `
    -Method Post `
    -Uri "$baseUrl/auth/logout" `
    -ContentType "application/json" `
    -Body $logoutBody

if (!$logoutAgain.success) {
    throw "El segundo logout no fue idempotente"
}

Write-Host "OK: logout repetido es idempotente" -ForegroundColor Green

try {
    Invoke-RestMethod `
        -Method Post `
        -Uri "$baseUrl/auth/refresh" `
        -ContentType "application/json" `
        -Headers @{ "Idempotency-Key" = [guid]::NewGuid().ToString() } `
        -Body $logoutBody

    throw "El refresh posterior al logout fue aceptado"
}
catch {
    $errorBody = Get-ErrorBody $_

    if ($errorBody.code -notin @(
        "REFRESH_TOKEN_REVOKED",
        "SESSION_REVOKED"
    )) {
        throw "Código inesperado después del logout: $($errorBody.code)"
    }

    Write-Host "OK: refresh posterior al logout rechazado con $($errorBody.code)" -ForegroundColor Green
}
