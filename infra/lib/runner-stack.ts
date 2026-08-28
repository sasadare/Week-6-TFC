import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';

export interface RunnerStackProps extends StackProps {
  /**
   * The GitHub repository owner (user or org) hosting the workflows that will
   * dispatch jobs to this self-hosted runner.
   */
  readonly githubOwner: string;
  /**
   * The GitHub repository name.
   */
  readonly githubRepo: string;
}

export class RunnerStack extends Stack {
  public readonly project: codebuild.Project;
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: RunnerStackProps) {
    super(scope, id, props);

    // IAM role assumed by the CodeBuild runner. It needs permission to deploy
    // CDK stacks and to write CloudWatch Logs.
    this.role = new iam.Role(this, 'RunnerRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      description: 'Role for the GitHub Actions self-hosted CodeBuild runner.',
    });

    // CloudWatch Logs permissions.
    this.role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: ['arn:aws:logs:*:*:*'],
      })
    );

    // CDK deploy permissions. CDK bootstrap creates named IAM roles that the
    // deployer assumes; allow assuming the CDK bootstrap roles plus the
    // CloudFormation actions used during `cdk deploy`.
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkBootstrapRoles',
        effect: iam.Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: [
          'arn:aws:iam::*:role/cdk-*-deploy-role-*',
          'arn:aws:iam::*:role/cdk-*-file-publishing-role-*',
          'arn:aws:iam::*:role/cdk-*-image-publishing-role-*',
          'arn:aws:iam::*:role/cdk-*-lookup-role-*',
        ],
      })
    );

    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CdkDeploy',
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudformation:*',
          'ssm:GetParameter',
          'ssm:GetParameters',
          's3:GetObject',
          's3:PutObject',
          's3:ListBucket',
        ],
        resources: ['*'],
      })
    );

    // GitHub source. The webhook triggers a build when a workflow job is
    // queued (WORKFLOW_JOB_QUEUED), which is how CodeBuild registers itself as
    // an ephemeral GitHub Actions self-hosted runner.
    const source = codebuild.Source.gitHub({
      owner: props.githubOwner,
      repo: props.githubRepo,
      webhook: true,
      webhookFilters: [
        codebuild.FilterGroup.inEventOf(codebuild.EventAction.WORKFLOW_JOB_QUEUED),
      ],
    });

    this.project = new codebuild.Project(this, 'RunnerProject', {
      projectName: 'github-actions-runner',
      description: 'CodeBuild project acting as a GitHub Actions self-hosted runner.',
      role: this.role,
      source,
      environment: {
        // ARM64 Graviton, small compute.
        buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      // When triggered by WORKFLOW_JOB_QUEUED, CodeBuild ignores the buildspec
      // and runs the GitHub Actions runner agent. This buildspec is used only
      // for any non-webhook (manual) invocations and pins the Node runtime.
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': {
              nodejs: 22,
            },
          },
          build: {
            commands: ['echo "Runner agent is managed by the WORKFLOW_JOB_QUEUED trigger."'],
          },
        },
      }),
      logging: {
        cloudWatch: {
          logGroup: new logs.LogGroup(this, 'RunnerLogGroup', {
            retention: logs.RetentionDays.ONE_MONTH,
          }),
        },
      },
    });
  }
}
