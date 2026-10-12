$ErrorActionPreference = "Stop"

$projectRef = "tuptdzbdowqtmbyhazet"
$securePassword = Get-Content "$env:USERPROFILE\.milo-db-password" | ConvertTo-SecureString
$credential = [System.Net.NetworkCredential]::new("", $securePassword)
$password = [uri]::EscapeDataString($credential.Password)

$dbUrl = "postgresql://postgres.${projectRef}:$password@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"

try {
    Write-Host "Checking migration history..."
    supabase migration list --db-url $dbUrl

    if ($LASTEXITCODE -ne 0) {
        throw "Migration history check failed. No deployment attempted."
    }

    $confirmation = Read-Host "Review the migration list above. Type DEPLOY to apply pending migrations"
    if ($confirmation -cne "DEPLOY") {
        Write-Host "Deployment cancelled."
        exit 0
    }

    supabase db push --db-url $dbUrl

    if ($LASTEXITCODE -ne 0) {
        throw "Migration deployment failed."
    }

    Write-Host "Migration deployment completed."
}
finally {
    $password = $null
    $dbUrl = $null
    $credential = $null
    $securePassword = $null
}

