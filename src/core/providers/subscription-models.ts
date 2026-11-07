export type SubscriptionInput = "text" | "image";

export type SubscriptionModelTuple = readonly [
  id: string,
  name: string,
  context: number,
  maxTokens: number,
  reasoning: boolean,
  input: readonly SubscriptionInput[],
];

export interface SubscriptionModel {
  id: string;
  name: string;
  context: number;
  maxTokens: number;
  reasoning: boolean;
  input: SubscriptionInput[];
}

export function subscriptionModels(
  entries: readonly SubscriptionModelTuple[]
): SubscriptionModel[] {
  return entries.map(([id, name, context, maxTokens, reasoning, input]) => ({
    id,
    name,
    context,
    maxTokens,
    reasoning,
    input: [...input],
  }));
}
