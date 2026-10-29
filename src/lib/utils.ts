export { cn } from "cn";

/** Reads `{ error }` from a failed API response, with a fallback message. */
export async function apiErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      return body.error;
    }
  } catch {
    // not JSON
  }
  return `Request failed (${response.status})`;
}
