import * as transformers from "@huggingface/transformers";

type TransformersNamespace = Record<string, unknown> & {
  default?: Record<string, unknown>;
};

const namespace = transformers as TransformersNamespace;
const defaultNamespace =
  namespace.default && typeof namespace.default === "object" ? namespace.default : {};

const resolvedPipeline =
  (typeof namespace.pipeline === "function" ? namespace.pipeline : undefined) ||
  (typeof defaultNamespace.pipeline === "function" ? defaultNamespace.pipeline : undefined);

const resolvedEnv =
  (namespace.env && typeof namespace.env === "object" ? namespace.env : undefined) ||
  (defaultNamespace.env && typeof defaultNamespace.env === "object"
    ? defaultNamespace.env
    : undefined);

export const pipeline = resolvedPipeline;
export const env = resolvedEnv;

export default { pipeline, env };
