#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ValidatorStack } from '../lib/validator-stack';
import { RunnerStack } from '../lib/runner-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

new ValidatorStack(app, 'ValidatorStack', { env });

new RunnerStack(app, 'RunnerStack', {
  env,
  // Override via `cdk deploy -c githubOwner=... -c githubRepo=...`.
  githubOwner: app.node.tryGetContext('githubOwner') ?? 'my-org',
  githubRepo: app.node.tryGetContext('githubRepo') ?? 'my-repo',
});

app.synth();
