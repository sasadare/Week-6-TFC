# CDK vs Terraform: Same Infrastructure, Two Approaches

## Side-by-Side Comparison

| Aspect | CDK (TypeScript) | Terraform (HCL) |
|--------|-----------------|-----------------|
| Language | TypeScript (general-purpose) | HCL (domain-specific) |
| Abstraction level | L2 constructs (high-level) | Resources (low-level) |
| State management | CloudFormation manages state | Terraform state file (S3 + DynamoDB lock) |
| Drift detection | CloudFormation drift detection | `terraform plan` shows drift |
| IDE support | Full IntelliSense, type checking | HCL extension (limited) |
| Testing | CDK assertions (unit tests) | `terraform validate` + Terratest |
| Deployment | `cdk deploy` → CloudFormation | `terraform apply` → direct API calls |
| Rollback | CloudFormation automatic rollback | Manual (`terraform apply` previous state) |
| Multi-account | CDK Pipelines cross-account | Terraform workspaces / providers |
| Learning curve | Need TypeScript + CDK concepts | HCL is simpler but less flexible |
| Lambda bundling | NodejsFunction auto-bundles | Manual zip + upload |
| IAM | `grant*()` methods (automatic) | Manual policy JSON |

## Lines of Code (This Project)

| Component | CDK | Terraform |
|-----------|-----|-----------|
| DynamoDB table | ~10 lines | ~25 lines |
| Lambda function | ~15 lines (auto-bundles) | ~35 lines (manual zip) |
| API Gateway | ~8 lines | ~30 lines |
| IAM | 1 line (`grantWriteData`) | ~25 lines |
| **Total** | **~50 lines** | **~130 lines** |

## When to Use Which

| Use CDK When | Use Terraform When |
|---|---|
| Team knows TypeScript/Python | Team prefers declarative HCL |
| AWS-only infrastructure | Multi-cloud (AWS + Azure + GCP) |
| Complex logic needed (loops, conditions) | Simple, static infrastructure |
| Want automatic IAM/bundling | Want explicit control over everything |
| CloudFormation ecosystem (StackSets, etc.) | Need Terraform ecosystem (modules registry) |

## Key Insight

CDK's `grantWriteData()` generates the exact same IAM policy that takes 25 lines in Terraform — but CDK does it in 1 line and guarantees least-privilege. For AWS-only projects, CDK is strictly more productive. Terraform wins when you need multi-cloud or when the team already has Terraform expertise.
