# 🚀 Week 6 — Infrastructure as Code: CDK, CI/CD & Multi-Tool

**CloudFormation Template Validator — CDK TypeScript + Self-Hosted Runner + Terraform Parity**
**NGDE Q3 2026 Cohort — APJC/IST**
**Author:** sasadare | August 2026

---

## 📋 Assignment Overview

| Field | Value |
|-------|-------|
| Project Type | Serverless IaC Security Validator |
| Primary IaC Tool | AWS CDK (TypeScript) |
| Secondary IaC Tool | Terraform (HCL) — parity implementation |
| Core Service | API Gateway → Lambda (Node 22, arm64) → DynamoDB |
| CI/CD | GitHub Actions on a CodeBuild self-hosted runner |
| Exit Criteria | Build + Test + Synth all green ✅ |
| Week Focus | Building deployable IaC, wiring self-hosted CI/CD runners, and comparing CDK vs Terraform on identical infrastructure |

---

## 🎯 Objective

Build a **CloudFormation template validator** — a REST endpoint that accepts a CFN YAML template, scans it for security anti-patterns, and returns a `PASS`/`WARN`/`FAIL` verdict with a 0–100 score. The same infrastructure is expressed **twice** (CDK and Terraform) to compare the two IaC approaches, and deployed through a **GitHub Actions self-hosted runner** backed by CodeBuild.

---

## 🏗️ Architecture

### Runtime Path — The Validator

```
POST /validate  →  API Gateway (REST)  →  Lambda (Node 22, arm64)  →  DynamoDB
                                              │
                                              └─ parses YAML (js-yaml)
                                                 runs 5 security checks
                                                 returns { status, findings, score }
```

- **API Gateway** — REST API exposing `POST /validate`
- **Lambda** — Node.js 22 on arm64 (Graviton); parses the YAML body with `js-yaml` (custom schema so CFN intrinsic tags like `!Ref`/`!GetAtt` don't break parsing)
- **DynamoDB** — stores results, partition key `templateId` + sort key `timestamp`, encrypted at rest

### Deployment Path — Self-Hosted Runner

```
git push  →  GitHub Actions (WORKFLOW_JOB_QUEUED)  →  CodeBuild runner (ARM64, Node 22)
                                                          │
                                                          └─ npm ci → build → test → cdk synth → cdk deploy
```

- **CodeBuild** configured as a GitHub Actions self-hosted runner (Source type `GITHUB`, webhook filtered on `WORKFLOW_JOB_QUEUED`), ARM64 Graviton, small compute, Node 22
- **IAM role** with CDK deploy permissions + CloudWatch Logs

---

## 🔍 Security Checks Implemented

| # | Check | Rule ID | Severity | Detection |
|---|-------|---------|----------|-----------|
| 1 | Wildcard IAM | `wildcard-iam` | HIGH | IAM policy with `Resource: '*'` |
| 2 | Missing encryption | `missing-encryption` | MEDIUM | DynamoDB w/o `SSESpecification`, S3 w/o `BucketEncryption` |
| 3 | Inline Lambda code | `inline-lambda-code` | LOW | Lambda with `Code.ZipFile` |
| 4 | Missing DeletionPolicy | `missing-deletion-policy` | LOW | Any resource without `DeletionPolicy` |
| 5 | Deprecated runtime | `deprecated-runtime` | HIGH | Lambda runtime `python3.8` or `nodejs14.x` |

**Scoring:** start at 100, subtract weighted deductions (HIGH −25, MEDIUM −15, LOW −5), floored at 0.
**Status:** `FAIL` if any HIGH finding · `WARN` if any finding · `PASS` if clean.

---

## 📁 Project Structure

| Path | Note | Purpose |
|------|------|---------|
| `Week-6/` | Root directory | |
| ├── `README.md` | ← This file | Main assignment documentation |
| ├── `.github/workflows/ci.yml` | ← CI/CD pipeline | Build/test/synth/deploy on self-hosted runner |
| ├── `docs/cdk-vs-terraform.md` | ← Comparison | CDK vs Terraform on identical infra |
| ├── `sample-templates/` | | Test fixtures for the validator |
| │   ├── `good.yaml` | ← Compliant template | Encrypted, DeletionPolicy, no wildcards |
| │   └── `bad.yaml` | ← Non-compliant template | Wildcard IAM, no encryption, inline py3.8 |
| ├── `infra/` | ← CDK TypeScript app | Primary IaC implementation |
| │   ├── `bin/app.ts` | ← CDK app entry point | Instantiates both stacks |
| │   ├── `lib/validator-stack.ts` | ← API GW + Lambda + DynamoDB | The validator service |
| │   ├── `lib/runner-stack.ts` | ← CodeBuild GH Actions runner | Self-hosted CI/CD runner |
| │   ├── `lambda/validator/index.ts` | ← Handler | YAML parse + 5 security checks |
| │   ├── `test/infra.test.ts` | ← CDK assertion + unit tests | 14 tests |
| │   └── `cdk.json` / `tsconfig.json` / `package.json` / `jest.config.js` | | CDK project config |
| └── `terraform/` | ← Terraform HCL app | Parity implementation |
|     ├── `main.tf` | ← Resources | DynamoDB + Lambda + HTTP API + IAM |
|     ├── `variables.tf` | ← Inputs | Region, project name, tags |
|     └── `outputs.tf` | ← Outputs | API URL, table, function names |

---

## ✅ Validation — Exit Criteria

| # | Exit Criterion | Command | Result |
|---|---------------|---------|--------|
| 1 | TypeScript compiles | `npx tsc` | ✅ Zero errors |
| 2 | Tests pass | `npx jest` | ✅ 14/14 passing |
| 3 | CDK synthesizes | `npx cdk synth` | ✅ Both stacks synthesized |
| 4 | Lambda is Node 22 / arm64 | assertion test | ✅ Verified |
| 5 | DynamoDB keys correct | assertion test | ✅ `templateId` PK + `timestamp` SK |
| 6 | POST /validate exists | assertion test | ✅ Verified |
| 7 | Lambda can write DynamoDB | assertion test | ✅ `dynamodb:PutItem` granted |
| 8 | Runner uses GITHUB source | assertion test | ✅ Verified |
| 9 | Runner is ARM small + WORKFLOW_JOB_QUEUED | assertion test | ✅ Verified |
| 10 | Validator logic correct | unit tests | ✅ Wildcard/encryption/runtime/policy/score |

### Test Breakdown (14 tests)

- **ValidatorStack (4):** DynamoDB key schema · Node 22 arm64 Lambda · POST /validate · DynamoDB write grant
- **RunnerStack (4):** GITHUB source · ARM small compute · WORKFLOW_JOB_QUEUED webhook · CloudWatch Logs policy
- **validateTemplate (6):** wildcard IAM → FAIL · missing encryption → WARN · inline code + deprecated runtime → FAIL · missing DeletionPolicy · clean template → PASS/100 · score floored at 0

---

## 🚀 Live Deployment Proof

**Deployed to:** `us-east-1` (account `887083406861`)
**API Endpoint:** `https://uzjo9tna5h.execute-api.us-east-1.amazonaws.com/prod/`

### Test 1: Non-compliant template → FAIL

```bash
$ curl -X POST https://uzjo9tna5h.execute-api.us-east-1.amazonaws.com/prod/validate \
  -H "Content-Type: text/plain" \
  --data-binary @sample-templates/bad.yaml
```

```json
{
  "status": "FAIL",
  "findings": [
    {"resourceId":"BadRole","resourceType":"AWS::IAM::Role","severity":"HIGH","rule":"wildcard-iam","message":"IAM resource \"BadRole\" grants access to Resource: '*'."},
    {"resourceId":"BadRole","resourceType":"AWS::IAM::Role","severity":"LOW","rule":"missing-deletion-policy","message":"Resource \"BadRole\" has no DeletionPolicy."},
    {"resourceId":"BadTable","resourceType":"AWS::DynamoDB::Table","severity":"MEDIUM","rule":"missing-encryption","message":"DynamoDB table \"BadTable\" has no SSESpecification (encryption at rest)."},
    {"resourceId":"BadTable","resourceType":"AWS::DynamoDB::Table","severity":"LOW","rule":"missing-deletion-policy","message":"Resource \"BadTable\" has no DeletionPolicy."},
    {"resourceId":"BadLambda","resourceType":"AWS::Lambda::Function","severity":"LOW","rule":"inline-lambda-code","message":"Lambda function \"BadLambda\" uses inline code (Code.ZipFile)."},
    {"resourceId":"BadLambda","resourceType":"AWS::Lambda::Function","severity":"HIGH","rule":"deprecated-runtime","message":"Lambda function \"BadLambda\" uses deprecated runtime \"python3.8\"."},
    {"resourceId":"BadLambda","resourceType":"AWS::Lambda::Function","severity":"LOW","rule":"missing-deletion-policy","message":"Resource \"BadLambda\" has no DeletionPolicy."}
  ],
  "score": 15
}
```

**Result:** 7 findings detected — 2 HIGH, 1 MEDIUM, 4 LOW — score 15/100 ❌

### Test 2: Compliant template → PASS

```bash
$ curl -X POST https://uzjo9tna5h.execute-api.us-east-1.amazonaws.com/prod/validate \
  -H "Content-Type: text/plain" \
  --data-binary @sample-templates/good.yaml
```

```json
{"status":"PASS","findings":[],"score":100}
```

**Result:** Zero findings, score 100/100 ✅

---

## 📊 CDK vs Terraform — Same Infra, Two Approaches

The same validator infrastructure is implemented in both tools. Full analysis in [`docs/cdk-vs-terraform.md`](docs/cdk-vs-terraform.md).

### Lines of Code (This Project)

| Component | CDK | Terraform |
|-----------|-----|-----------|
| DynamoDB table | ~10 lines | ~25 lines |
| Lambda function | ~15 lines (auto-bundles) | ~35 lines (manual zip) |
| API Gateway | ~8 lines | ~30 lines |
| IAM | 1 line (`grantWriteData`) | ~25 lines |
| **Total** | **~50 lines** | **~130 lines** |

### Key Differences

| Aspect | CDK (TypeScript) | Terraform (HCL) |
|--------|-----------------|-----------------|
| Abstraction | L2 constructs (high-level) | Resources (low-level) |
| State | CloudFormation-managed | Terraform state file |
| Lambda bundling | `NodejsFunction` auto-bundles | Manual zip via `archive_file` |
| IAM | `grant*()` (automatic, least-privilege) | Hand-written policy JSON |
| Rollback | CloudFormation automatic | Manual re-apply |
| Best for | AWS-only, complex logic | Multi-cloud, static infra |

**Key insight:** CDK's `grantWriteData()` produces the same IAM policy that takes ~25 lines in Terraform — in one line, with least-privilege guaranteed. For AWS-only projects CDK is strictly more productive; Terraform wins on multi-cloud or existing team expertise.

---

## 🔄 CI/CD — Self-Hosted Runner Flow

The workflow ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on the CodeBuild self-hosted runner provisioned by `RunnerStack`:

```yaml
runs-on:
  - codebuild-week6-runner-${{ github.run_id }}-${{ github.run_attempt }}
```

Pipeline stages: `checkout` → `setup-node@22` → `npm ci` → `build` → `jest` → `cdk synth` → `cdk deploy` (on `main` push only).

The `WORKFLOW_JOB_QUEUED` webhook filter on the CodeBuild project is what lets CodeBuild register itself as an ephemeral runner the moment a job is queued — no long-lived runner infrastructure to maintain.

---

## 🧠 Learnings & Observations

- **Kiro scaffolded the entire CDK project in 6m 45s** (5.01 credits) — including both stacks, Lambda handler, 14 tests, and all config files. Human intervention was limited to runtime version correction (nodejs20.x → nodejs22.x) and test alignment.

- **Testable handler design** — Extracting `validateTemplate()` as a pure function (separate from the Lambda `handler`) means the security logic is unit-tested without any AWS mocks. The handler only adds I/O and optional DynamoDB persistence.

- **CFN intrinsic tags break naive YAML parsing** — `js-yaml` throws on `!Ref`/`!GetAtt`/`!Sub` by default. A custom schema mapping each tag to `{ "Fn::<Tag>": data }` keeps parsing robust while preserving values for inspection.

- **`NodejsFunction` needs a local bundler** — Without `esbuild` installed, CDK falls back to Docker for bundling, which fails in Docker-less environments. Adding `esbuild` as a devDependency makes `synth` and tests run anywhere.

- **Runtime deps vs. type deps** — The AWS SDK v3 is provided by the Node 22 runtime, so it's marked as an external module in bundling (not shipped) but still installed as a devDependency so TypeScript type-checks.

- **Self-hosted runners via CodeBuild** — The `WORKFLOW_JOB_QUEUED` trigger turns CodeBuild into an on-demand GitHub Actions runner — ARM64 Graviton for cost efficiency, ephemeral per-job, no idle capacity.

- **CDK abstracts the boilerplate Terraform makes explicit** — Terraform's ~130 lines aren't wasted; they're the exact IAM, bundling, and permission wiring CDK generates implicitly. Explicitness is a feature when you need multi-cloud or fine-grained control.

- **Content-Type matters for Lambda body parsing** — API Gateway passes the raw body to Lambda; using `--data-binary` (not `-d`) with curl preserves YAML newlines. The Lambda reads `event.body` directly as YAML — no JSON wrapper needed.

---

## 🔄 How to Reproduce

```bash
# --- CDK path ---
cd ~/Desktop/Kiro/Week-6/infra
npm install
npm run build                                   # tsc — zero errors
npx jest                                         # 14/14 passing
npx cdk synth -c githubOwner=sasadare -c githubRepo=Week-6-TFC

# Deploy (requires bootstrapped account)
npx cdk deploy ValidatorStack --require-approval never
npx cdk deploy RunnerStack -c githubOwner=sasadare -c githubRepo=Week-6-TFC

# --- Terraform path (parity) ---
cd ~/Desktop/Kiro/Week-6/terraform
terraform init
terraform plan
terraform apply

# --- Test the live API ---
curl -X POST https://uzjo9tna5h.execute-api.us-east-1.amazonaws.com/prod/validate \
  -H "Content-Type: text/plain" \
  --data-binary @sample-templates/bad.yaml
# → FAIL, score 15, 7 findings

curl -X POST https://uzjo9tna5h.execute-api.us-east-1.amazonaws.com/prod/validate \
  -H "Content-Type: text/plain" \
  --data-binary @sample-templates/good.yaml
# → PASS, score 100, 0 findings
```

---

## ✅ Assignment Checklist

| # | Requirement | Status | Deliverable |
|---|-------------|--------|-------------|
| 1 | Build a serverless validator (API GW + Lambda + DynamoDB) | ✅ Complete | `infra/lib/validator-stack.ts` |
| 2 | Implement CFN security checks | ✅ Complete | `infra/lambda/validator/index.ts` (5 checks) |
| 3 | Self-hosted CI/CD runner | ✅ Complete | `infra/lib/runner-stack.ts` + `.github/workflows/ci.yml` |
| 4 | CDK assertion + unit tests | ✅ Complete | `infra/test/infra.test.ts` (14 tests) |
| 5 | Terraform parity implementation | ✅ Complete | `terraform/*.tf` |
| 6 | CDK vs Terraform comparison | ✅ Complete | `docs/cdk-vs-terraform.md` |
| 7 | Sample templates (good/bad) | ✅ Complete | `sample-templates/` |
| 8 | Live deployment + validation | ✅ Complete | API endpoint live in us-east-1 |
| 9 | Validate build/test/synth | ✅ Complete | tsc + jest + cdk synth all green |

---

## 🛠️ Tools & Environment

| Tool | Version | Purpose |
|------|---------|---------|
| 💻 aws-cdk-lib | 2.150.x+ | CDK L2 constructs (primary IaC) |
| 💻 TypeScript | 5.5.x | CDK app + Lambda handler language |
| 💻 Node.js | 22.x | CDK toolchain + Lambda runtime |
| 🔧 esbuild | 0.23.x | Local Lambda bundling (Docker-free) |
| 🧪 jest + ts-jest | 29.x | CDK assertions + unit tests |
| 📦 js-yaml | 4.1.0 | CFN YAML parsing with custom schema |
| 🌍 Terraform | ~> 1.5 | Parity IaC implementation (HCL) |
| ☁️ AWS Provider | ~> 5.0 | Terraform AWS resources |
| 🔁 CodeBuild | LinuxArm STANDARD 3.0 | GitHub Actions self-hosted runner |
| 🤖 Kiro | Pro+ | AI-assisted scaffolding (5.01 credits, 6m 45s) |

---

🎓 **NGDE Q3 2026 Cohort — Week 6 Assignment**
Author: sasadare | August 2026
