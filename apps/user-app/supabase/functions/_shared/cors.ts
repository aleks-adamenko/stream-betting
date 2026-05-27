// CORS headers reused by every Edge Function the browser calls.
//
// The studio + user-app live on different origins from the function
// host (`*.functions.supabase.co`), so without these headers the
// browser refuses the response. `Access-Control-Allow-Origin: *` is
// safe here because the actual auth check is the JWT in the
// Authorization header, not the origin.

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Helper for the preflight OPTIONS request. */
export function corsPreflight(): Response {
  return new Response("ok", { headers: corsHeaders });
}

/** Wraps a JSON body in a `Response` with the standard CORS headers. */
export function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}
