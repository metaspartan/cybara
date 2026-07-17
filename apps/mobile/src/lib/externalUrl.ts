import { Linking } from "react-native";
import { isAllowedExternalUrl } from "./externalUrlPolicy";

export { isAllowedExternalUrl } from "./externalUrlPolicy";

export async function openAllowedExternalUrl(value: string): Promise<boolean> {
  if (!isAllowedExternalUrl(value)) return false;
  await Linking.openURL(value);
  return true;
}
