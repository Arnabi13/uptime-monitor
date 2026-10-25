<#
Creates the SQS queue + dead-letter queue (DLQ) this project's scheduler
and worker need (see backend/src/queue/sqs.service.ts).

Prerequisite: you've already run
  aws configure --profile uptime-monitor
with the uptime-monitor-backend IAM user's keys.

Usage (from the project root):
  cd "C:\Projects 26\uptime-monitor"
  .\aws\create-sqs.ps1
#>

$ErrorActionPreference = "Stop"
$ProfileName = "uptime-monitor"
$Region      = "ap-southeast-2"
$DlqName     = "uptime-monitor-checks-dlq"
$MainName    = "uptime-monitor-checks"

Write-Host "Creating dead-letter queue ($DlqName)..." -ForegroundColor Cyan
$dlqUrl = aws sqs create-queue --queue-name $DlqName --region $Region --profile $ProfileName --query QueueUrl --output text
if (-not $dlqUrl) { throw "Failed to create the DLQ. See the error above." }

$dlqArn = aws sqs get-queue-attributes --queue-url $dlqUrl --attribute-names QueueArn --region $Region --profile $ProfileName --query "Attributes.QueueArn" --output text
Write-Host "  DLQ URL: $dlqUrl"
Write-Host "  DLQ ARN: $dlqArn"

Write-Host ""
Write-Host "Creating main queue ($MainName), wired to retry 3 times then move to the DLQ..." -ForegroundColor Cyan

# RedrivePolicy's value has to be a JSON *string* (not a nested JSON object) per
# the SQS API, so we build it in two passes: first the inner policy as its own
# JSON string, then embed that string as one attribute's value.
$redrivePolicy = @{ deadLetterTargetArn = $dlqArn; maxReceiveCount = 3 } | ConvertTo-Json -Compress

$attributes = @{
  VisibilityTimeout             = "30"  # matches SqsService.receive()'s VisibilityTimeout
  ReceiveMessageWaitTimeSeconds = "20"  # matches SqsService.receive()'s long-poll wait
  RedrivePolicy                 = $redrivePolicy
}

# Writing attributes to a temp file and passing --attributes file://... instead of
# an inline JSON string sidesteps PowerShell's quote-escaping quirks with the AWS CLI.
$attrFile = [System.IO.Path]::GetTempFileName()
($attributes | ConvertTo-Json) | Set-Content -Path $attrFile -Encoding ascii

$mainUrl = aws sqs create-queue --queue-name $MainName --region $Region --profile $ProfileName --attributes "file://$attrFile" --query QueueUrl --output text
Remove-Item $attrFile -ErrorAction SilentlyContinue

if (-not $mainUrl) { throw "Failed to create the main queue. See the error above." }

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "Add these two lines to backend\.env (replacing the placeholder SQS_QUEUE_URL):" -ForegroundColor Yellow
Write-Host ""
Write-Host "  AWS_REGION=$Region"
Write-Host "  SQS_QUEUE_URL=$mainUrl"
Write-Host ""
