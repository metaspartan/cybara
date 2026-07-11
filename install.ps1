$ErrorActionPreference = "Stop"
Invoke-RestMethod -Uri "https://cybara.ai/install.ps1" | Invoke-Expression
