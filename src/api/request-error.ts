export interface ApiRequestError {
  userMessage: string;
  errorCode: string;
  statusCode: number;
}

export function classifyApiRequestError(errorMessage: string): ApiRequestError {
  if (errorMessage.includes("No API credentials")) {
    return {
      userMessage: "API credentials not configured. Please add a provider with valid API keys.",
      errorCode: "MISSING_CREDENTIALS",
      statusCode: 400,
    };
  }
  if (errorMessage.includes("Rate limit")) {
    return {
      userMessage: "Rate limit exceeded. Please try again later.",
      errorCode: "RATE_LIMITED",
      statusCode: 429,
    };
  }
  if (errorMessage.includes("circuit breaker")) {
    return {
      userMessage: "Service temporarily unavailable. Please try again shortly.",
      errorCode: "SERVICE_UNAVAILABLE",
      statusCode: 503,
    };
  }
  if (errorMessage.includes("Agent is not running")) {
    return {
      userMessage: "Agent is not running. Start the agent and try again.",
      errorCode: "AGENT_NOT_RUNNING",
      statusCode: 409,
    };
  }
  if (errorMessage.includes("LLM API error")) {
    return {
      userMessage: `AI service error: ${errorMessage}`,
      errorCode: "LLM_ERROR",
      statusCode: 502,
    };
  }
  if (errorMessage.includes("not found")) {
    return { userMessage: errorMessage, errorCode: "NOT_FOUND", statusCode: 404 };
  }
  if (errorMessage.includes("already exists")) {
    return { userMessage: errorMessage, errorCode: "CONFLICT", statusCode: 409 };
  }
  if (
    errorMessage.includes("Validation") ||
    errorMessage.includes("required") ||
    errorMessage.startsWith("Refused:") ||
    errorMessage.startsWith("Invalid ")
  ) {
    return { userMessage: errorMessage, errorCode: "VALIDATION_ERROR", statusCode: 400 };
  }
  if (
    errorMessage.includes("Failed to launch browser") ||
    errorMessage.includes("Unable to launch a browser") ||
    errorMessage.includes("playwright chromium runtime is unavailable")
  ) {
    return { userMessage: errorMessage, errorCode: "BROWSER_UNAVAILABLE", statusCode: 503 };
  }
  return {
    userMessage: "An error occurred while processing your request.",
    errorCode: "INTERNAL_ERROR",
    statusCode: 500,
  };
}
