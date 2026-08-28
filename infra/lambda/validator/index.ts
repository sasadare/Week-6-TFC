import * as yaml from 'js-yaml';

interface Finding {
  resourceId: string;
  resourceType: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  rule: string;
  message: string;
}

interface ValidationResult {
  status: 'PASS' | 'WARN' | 'FAIL';
  findings: Finding[];
  score: number;
}

const DEPRECATED_RUNTIMES = ['python3.8', 'nodejs14.x'];

// Point deductions applied to the score per finding severity.
const SEVERITY_WEIGHTS: Record<Finding['severity'], number> = {
  HIGH: 25,
  MEDIUM: 15,
  LOW: 5,
};

/**
 * Custom schema so that CloudFormation intrinsic functions (short form, e.g.
 * !Ref, !GetAtt, !Sub) do not blow up the YAML parser. Each tag is mapped to a
 * plain object representation so downstream checks can still inspect values.
 */
const CFN_TAGS = [
  'Ref', 'Condition', 'GetAtt', 'GetAZs', 'ImportValue', 'Join', 'Select',
  'Split', 'Sub', 'Base64', 'Cidr', 'FindInMap', 'And', 'Equals', 'If',
  'Not', 'Or', 'Transform',
];

const cfnTypes = CFN_TAGS.flatMap((tag) =>
  (['scalar', 'sequence', 'mapping'] as const).map(
    (kind) =>
      new yaml.Type(`!${tag}`, {
        kind,
        multi: false,
        construct: (data) => ({ [`Fn::${tag}`]: data }),
      })
  )
);

const CFN_SCHEMA = yaml.DEFAULT_SCHEMA.extend(cfnTypes);

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

/**
 * Recursively walks any value looking for a Resource property equal to "*".
 * Handles both object policy documents and stringified JSON policy documents.
 */
function hasWildcardResource(node: unknown): boolean {
  if (node == null) return false;
  if (typeof node === 'string') {
    return node.trim() === '*';
  }
  if (Array.isArray(node)) {
    return node.some((item) => hasWildcardResource(item));
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, any>;
    if ('Resource' in obj) {
      const res = obj.Resource;
      if (res === '*') return true;
      if (Array.isArray(res) && res.includes('*')) return true;
    }
    return Object.values(obj).some((v) => hasWildcardResource(v));
  }
  return false;
}

export function validateTemplate(template: unknown): ValidationResult {
  const findings: Finding[] = [];
  const doc = asRecord(template);
  const resources = asRecord(doc.Resources);

  for (const [logicalId, rawResource] of Object.entries(resources)) {
    const resource = asRecord(rawResource);
    const type: string = resource.Type ?? '';
    const properties = asRecord(resource.Properties);

    // 1. Wildcard IAM: Resource: '*' in a policy document.
    if (
      type === 'AWS::IAM::Policy' ||
      type === 'AWS::IAM::Role' ||
      type === 'AWS::IAM::ManagedPolicy'
    ) {
      if (hasWildcardResource(properties)) {
        findings.push({
          resourceId: logicalId,
          resourceType: type,
          severity: 'HIGH',
          rule: 'wildcard-iam',
          message: `IAM resource "${logicalId}" grants access to Resource: '*'.`,
        });
      }
    }

    // 2. Missing encryption on DynamoDB tables.
    if (type === 'AWS::DynamoDB::Table') {
      if (!properties.SSESpecification) {
        findings.push({
          resourceId: logicalId,
          resourceType: type,
          severity: 'MEDIUM',
          rule: 'missing-encryption',
          message: `DynamoDB table "${logicalId}" has no SSESpecification (encryption at rest).`,
        });
      }
    }

    // 2b. Missing encryption on S3 buckets.
    if (type === 'AWS::S3::Bucket') {
      if (!properties.BucketEncryption) {
        findings.push({
          resourceId: logicalId,
          resourceType: type,
          severity: 'MEDIUM',
          rule: 'missing-encryption',
          message: `S3 bucket "${logicalId}" has no BucketEncryption configuration.`,
        });
      }
    }

    // Lambda-specific checks.
    if (type === 'AWS::Lambda::Function') {
      const code = asRecord(properties.Code);

      // 3. Inline Lambda code via Code.ZipFile.
      if ('ZipFile' in code) {
        findings.push({
          resourceId: logicalId,
          resourceType: type,
          severity: 'LOW',
          rule: 'inline-lambda-code',
          message: `Lambda function "${logicalId}" uses inline code (Code.ZipFile).`,
        });
      }

      // 5. Deprecated runtimes.
      const runtime: string = properties.Runtime ?? '';
      if (DEPRECATED_RUNTIMES.includes(runtime)) {
        findings.push({
          resourceId: logicalId,
          resourceType: type,
          severity: 'HIGH',
          rule: 'deprecated-runtime',
          message: `Lambda function "${logicalId}" uses deprecated runtime "${runtime}".`,
        });
      }
    }

    // 4. Missing DeletionPolicy.
    if (!('DeletionPolicy' in resource)) {
      findings.push({
        resourceId: logicalId,
        resourceType: type,
        severity: 'LOW',
        rule: 'missing-deletion-policy',
        message: `Resource "${logicalId}" has no DeletionPolicy.`,
      });
    }
  }

  // Compute score: start at 100 and subtract weighted deductions, floored at 0.
  const deductions = findings.reduce(
    (sum, f) => sum + SEVERITY_WEIGHTS[f.severity],
    0
  );
  const score = Math.max(0, 100 - deductions);

  // Status: FAIL if any HIGH finding, WARN if any finding at all, else PASS.
  let status: ValidationResult['status'] = 'PASS';
  if (findings.some((f) => f.severity === 'HIGH')) {
    status = 'FAIL';
  } else if (findings.length > 0) {
    status = 'WARN';
  }

  return { status, findings, score };
}

interface ApiEvent {
  body?: string | null;
  isBase64Encoded?: boolean;
}

export const handler = async (event: ApiEvent) => {
  try {
    let body = event.body ?? '';
    if (event.isBase64Encoded && body) {
      body = Buffer.from(body, 'base64').toString('utf-8');
    }

    if (!body.trim()) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Request body is empty. Expected a CloudFormation YAML template.' }),
      };
    }

    let template: unknown;
    try {
      template = yaml.load(body, { schema: CFN_SCHEMA });
    } catch (err) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Failed to parse YAML template.',
          detail: (err as Error).message,
        }),
      };
    }

    const { status, findings, score } = validateTemplate(template);

    // Persist to DynamoDB if a table is configured. Kept optional so the
    // handler stays testable without AWS credentials.
    const tableName = process.env.TABLE_NAME;
    if (tableName) {
      try {
        // Lazy import so unit tests of validateTemplate don't require the SDK.
        const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
        const { DynamoDBDocumentClient, PutCommand } = await import('@aws-sdk/lib-dynamodb');
        const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
        const templateId = `tmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await client.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              templateId,
              timestamp: new Date().toISOString(),
              status,
              score,
              findings,
            },
          })
        );
      } catch (err) {
        // Storage failures shouldn't fail validation; log and continue.
        console.error('Failed to persist result to DynamoDB:', err);
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, findings, score }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal error.', detail: (err as Error).message }),
    };
  }
};
