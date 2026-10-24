import { createClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export class ApiError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function requireProfile(request: Request) {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");

  if (!url || !anonKey || !serviceKey) throw new ApiError("Server configuration is incomplete.", 500);
  if (!authorization?.startsWith("Bearer ")) throw new ApiError("Sign in is required.", 401);

  const authClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) throw new ApiError("Your session is invalid. Sign in again.", 401);

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: profile, error: profileError } = await admin
    .from("app_profiles")
    .select("id, auth_user_id, email, full_name, role, teacher_id, is_active")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (profileError) throw new ApiError("Could not load your account profile.", 500);
  if (!profile || !profile.is_active) throw new ApiError("This account is not enabled for the institute app.", 403);

  return { admin, user, profile };
}
