import type { AppContext } from "../types.ts";

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

type ToolHandler<T = any> = (
  input: T,
  ctx: AppContext
) => Promise<{
  content: ContentBlock[];
  isError?: boolean;
}>;

/**
 * Wraps a tool handler to require authentication before execution.
 * Returns a standard error response if the user is not authenticated.
 */
export function requireAuth<T = any>(
  handler: ToolHandler<T>
): ToolHandler<T> {
  return async (input: T, ctx: AppContext) => {
    if (!ctx.sessionManager.isAuthenticated()) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Not logged in. Use the login tool with your phone number, then enter_otp to authenticate.",
          },
        ],
        isError: true,
      };
    }

    return handler(input, ctx);
  };
}
