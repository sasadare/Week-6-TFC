output "api_url" {
  description = "API Gateway endpoint URL"
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "dynamodb_table" {
  description = "DynamoDB table name"
  value       = aws_dynamodb_table.validation_results.name
}

output "lambda_function" {
  description = "Lambda function name"
  value       = aws_lambda_function.validator.function_name
}
