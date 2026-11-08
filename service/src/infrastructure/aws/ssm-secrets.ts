import { GetParametersByPathCommand, SSMClient } from "@aws-sdk/client-ssm";

// Env-variable names only: a parameter named anything else under the prefix is ignored rather than injected.
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

// Secrets for the Lambdas, from SSM Parameter Store SecureStrings under one path (C108): `/polaris/LLM_API_KEY` ->
// `LLM_API_KEY`. Read ONCE per cold start by the worker container; standard tier and the AWS-managed key are free,
// unlike Secrets Manager. Values are returned, never logged.
export async function loadSsmParameters({
  region,
  prefix,
  endpoint,
}: {
  region: string;
  prefix: string;
  endpoint?: string | undefined;
}): Promise<Record<string, string>> {
  const client = new SSMClient({ region, ...(endpoint === undefined ? {} : { endpoint }) });
  const path = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const out: Record<string, string> = {};
  let nextToken: string | undefined;
  do {
    const page = await client.send(
      new GetParametersByPathCommand({ Path: path, WithDecryption: true, Recursive: false, NextToken: nextToken }),
    );
    for (const parameter of page.Parameters ?? []) {
      const name = parameter.Name?.slice(path.length);
      if (name !== undefined && ENV_NAME.test(name) && parameter.Value !== undefined) out[name] = parameter.Value;
    }
    nextToken = page.NextToken;
  } while (nextToken !== undefined);
  return out;
}
