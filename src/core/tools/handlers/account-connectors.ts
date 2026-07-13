import { connectorReadAction, connectorWriteAction } from "../../account-connectors/client";

export async function handleAccountConnectorRead(args: Record<string, unknown>): Promise<unknown> {
  return connectorReadAction(args);
}

export async function handleAccountConnectorWrite(args: Record<string, unknown>): Promise<unknown> {
  return connectorWriteAction(args);
}
