const RAW_HTTP_RESPONSE = Symbol.for("cybara.rawHttpResponse");

export interface RawHttpResponse {
  [RAW_HTTP_RESPONSE]: true;
  status: number;
  contentType: string;
  body: string;
}

export function makeRawHttpResponse(
  body: string,
  contentType: string,
  status = 200
): RawHttpResponse {
  return { [RAW_HTTP_RESPONSE]: true, status, contentType, body };
}

export function isRawHttpResponse(value: unknown): value is RawHttpResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[RAW_HTTP_RESPONSE] === true
  );
}
