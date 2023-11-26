const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const dotenv = require('dotenv');
dotenv.config();

const sendEmail = () => {
    const region = process.env.BUCKET_REGION;
    const functionName = 'sendEmailFunction';
    const accessKeyLambda = process.env.LAMBDA_ACCESS_KEY
    const secretAccessKeyLambda = process.env.LAMBDA_SECRET_ACCESS_KEY
    // Configure AWS SDK
    const lambdaClient = new LambdaClient({ region, 
        credentials: {
            accessKeyId: accessKeyLambda,
            secretAccessKey: secretAccessKeyLambda 
        }
    });
    
    // Create parameters for the invoke command
    const invokeParams = {
      FunctionName: functionName
    //   Payload: JSON.stringify(payload),
    };
    
    // Invoke the Lambda function
    lambdaClient.send(new InvokeCommand(invokeParams))
      .then((data) => {
        // Log the response from the Lambda function
        console.log('Lambda Function Response:', JSON.parse(Buffer.from(data.Payload).toString()));
      })
      .catch((err) => {
        console.error('Error invoking Lambda function:', err);
      });
    
}

module.exports = sendEmail;