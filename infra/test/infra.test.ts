import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ValidatorStack } from '../lib/validator-stack';
import { RunnerStack } from '../lib/runner-stack';
import { validateTemplate } from '../lambda/validator';

describe('ValidatorStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new ValidatorStack(app, 'TestValidatorStack');
    template = Template.fromStack(stack);
  });

  test('creates a DynamoDB table with templateId PK and timestamp SK', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: Match.arrayWith([
        { AttributeName: 'templateId', KeyType: 'HASH' },
        { AttributeName: 'timestamp', KeyType: 'RANGE' },
      ]),
    });
  });

  test('creates a Node.js 22 arm64 Lambda function', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
    });
  });

  test('creates a REST API with a POST /validate method', () => {
    template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      PathPart: 'validate',
    });
    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'POST',
    });
  });

  test('grants the Lambda write access to the DynamoDB table', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['dynamodb:PutItem']),
            Effect: 'Allow',
          }),
        ]),
      },
    });
  });
});

describe('RunnerStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new RunnerStack(app, 'TestRunnerStack', {
      githubOwner: 'acme',
      githubRepo: 'widgets',
    });
    template = Template.fromStack(stack);
  });

  test('creates a CodeBuild project with a GITHUB source', () => {
    template.hasResourceProperties('AWS::CodeBuild::Project', {
      Source: Match.objectLike({ Type: 'GITHUB' }),
    });
  });

  test('uses ARM small compute', () => {
    template.hasResourceProperties('AWS::CodeBuild::Project', {
      Environment: Match.objectLike({
        Type: 'ARM_CONTAINER',
        ComputeType: 'BUILD_GENERAL1_SMALL',
      }),
    });
  });

  test('has a webhook filtering on WORKFLOW_JOB_QUEUED', () => {
    template.hasResourceProperties('AWS::CodeBuild::Project', {
      Triggers: Match.objectLike({
        Webhook: true,
        FilterGroups: Match.arrayWith([
          Match.arrayWith([
            Match.objectLike({ Type: 'EVENT', Pattern: 'WORKFLOW_JOB_QUEUED' }),
          ]),
        ]),
      }),
    });
  });

  test('role can write CloudWatch Logs', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['logs:PutLogEvents']),
            Effect: 'Allow',
          }),
        ]),
      },
    });
  });
});

describe('validateTemplate', () => {
  test('flags wildcard IAM resource as a HIGH finding and FAIL status', () => {
    const result = validateTemplate({
      Resources: {
        MyPolicy: {
          Type: 'AWS::IAM::Policy',
          DeletionPolicy: 'Retain',
          Properties: {
            PolicyDocument: {
              Statement: [{ Effect: 'Allow', Action: 's3:*', Resource: '*' }],
            },
          },
        },
      },
    });
    expect(result.status).toBe('FAIL');
    expect(result.findings.some((f) => f.rule === 'wildcard-iam')).toBe(true);
  });

  test('flags DynamoDB table without encryption', () => {
    const result = validateTemplate({
      Resources: {
        Table: {
          Type: 'AWS::DynamoDB::Table',
          DeletionPolicy: 'Retain',
          Properties: {},
        },
      },
    });
    expect(result.findings.some((f) => f.rule === 'missing-encryption')).toBe(true);
    expect(result.status).toBe('WARN');
  });

  test('flags inline Lambda code and deprecated runtime', () => {
    const result = validateTemplate({
      Resources: {
        Fn: {
          Type: 'AWS::Lambda::Function',
          DeletionPolicy: 'Retain',
          Properties: {
            Runtime: 'python3.8',
            Code: { ZipFile: 'print("hi")' },
          },
        },
      },
    });
    expect(result.findings.some((f) => f.rule === 'inline-lambda-code')).toBe(true);
    expect(result.findings.some((f) => f.rule === 'deprecated-runtime')).toBe(true);
    expect(result.status).toBe('FAIL');
  });

  test('flags resources missing a DeletionPolicy', () => {
    const result = validateTemplate({
      Resources: {
        Bucket: {
          Type: 'AWS::S3::Bucket',
          Properties: {
            BucketEncryption: {
              ServerSideEncryptionConfiguration: [
                { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
              ],
            },
          },
        },
      },
    });
    expect(result.findings.some((f) => f.rule === 'missing-deletion-policy')).toBe(true);
  });

  test('returns PASS with score 100 for a clean template', () => {
    const result = validateTemplate({
      Resources: {
        Bucket: {
          Type: 'AWS::S3::Bucket',
          DeletionPolicy: 'Retain',
          Properties: {
            BucketEncryption: {
              ServerSideEncryptionConfiguration: [
                { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
              ],
            },
          },
        },
      },
    });
    expect(result.status).toBe('PASS');
    expect(result.score).toBe(100);
    expect(result.findings).toHaveLength(0);
  });

  test('score never drops below 0', () => {
    const resources: Record<string, unknown> = {};
    for (let i = 0; i < 10; i++) {
      resources[`Fn${i}`] = {
        Type: 'AWS::Lambda::Function',
        Properties: { Runtime: 'nodejs14.x', Code: { ZipFile: 'x' } },
      };
    }
    const result = validateTemplate({ Resources: resources });
    expect(result.score).toBe(0);
    expect(result.status).toBe('FAIL');
  });
});
