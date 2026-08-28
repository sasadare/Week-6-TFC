import * as path from 'path';
import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

export class ValidatorStack extends Stack {
  public readonly api: apigateway.RestApi;
  public readonly table: dynamodb.Table;
  public readonly validatorFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // DynamoDB table to store validation results.
    this.table = new dynamodb.Table(this, 'ResultsTable', {
      partitionKey: { name: 'templateId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Lambda function that validates CloudFormation templates.
    this.validatorFunction = new NodejsFunction(this, 'ValidatorFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(__dirname, '..', 'lambda', 'validator', 'index.ts'),
      handler: 'handler',
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        TABLE_NAME: this.table.tableName,
      },
      bundling: {
        minify: true,
        // js-yaml is bundled; AWS SDK v3 is provided by the Node 22 runtime.
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant the Lambda permission to write results to DynamoDB.
    this.table.grantWriteData(this.validatorFunction);

    // API Gateway REST API with a POST /validate endpoint.
    this.api = new apigateway.RestApi(this, 'ValidatorApi', {
      restApiName: 'cfn-validator-api',
      description: 'Validates CloudFormation templates for security best practices.',
      deployOptions: {
        stageName: 'prod',
      },
    });

    const validate = this.api.root.addResource('validate');
    validate.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.validatorFunction, {
        proxy: true,
      })
    );
  }
}
