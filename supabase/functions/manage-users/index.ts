import { ApiError, json, requireProfile, corsHeaders } from "../_shared/http.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const { admin, profile } = await requireProfile(request);
    if (profile.role !== "admin") throw new ApiError("Only administrators can manage accounts.", 403);

    const body = await request.json();
    const action = body.action;

    if (action === "create") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const fullName = String(body.full_name ?? "").trim();
      const password = String(body.password ?? "");
      const role = body.role;
      const teacherId = body.teacher_id == null ? null : Number(body.teacher_id);
      if (!email || !fullName || password.length < 10 || !["admin", "teacher"].includes(role)) {
        throw new ApiError("Provide a name, valid email, role, and password of at least 10 characters.");
      }
      if (role === "teacher" && !Number.isSafeInteger(teacherId)) {
        throw new ApiError("A teacher account must be linked to a teacher record.");
      }

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (createError || !created.user) throw new ApiError(createError?.message ?? "Could not create account.", 400);

      const { data: createdProfile, error: profileError } = await admin
        .from("app_profiles")
        .insert({
          auth_user_id: created.user.id,
          email,
          full_name: fullName,
          role,
          teacher_id: teacherId,
        })
        .select("id, auth_user_id, email, full_name, role, teacher_id, is_active")
        .single();
      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id);
        throw new ApiError(profileError.message, 400);
      }
      return json({ user: createdProfile }, 201);
    }

    const id = Number(body.id);
    if (!Number.isSafeInteger(id)) throw new ApiError("A valid account ID is required.");
    const { data: target, error: targetError } = await admin
      .from("app_profiles")
      .select("id, auth_user_id, email, full_name, role, teacher_id, is_active")
      .eq("id", id)
      .single();
    if (targetError || !target) throw new ApiError("Account not found.", 404);

    if (action === "toggle") {
      const isActive = Boolean(body.is_active);
      if (target.id === profile.id && !isActive) throw new ApiError("You cannot disable your own account.", 400);
      if (target.role === "admin" && target.is_active && !isActive) {
        const { count, error: countError } = await admin
          .from("app_profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "admin")
          .eq("is_active", true);
        if (countError) throw new ApiError("Could not verify administrator accounts.", 500);
        if ((count ?? 0) <= 1) throw new ApiError("The last active administrator cannot be disabled.", 400);
      }
      const { data: updated, error } = await admin
        .from("app_profiles")
        .update({ is_active: isActive })
        .eq("id", id)
        .select("id, auth_user_id, email, full_name, role, teacher_id, is_active")
        .single();
      if (error) throw new ApiError(error.message, 400);
      return json({ user: updated });
    }

    if (action === "update") {
      const email = body.email == null ? target.email : String(body.email).trim().toLowerCase();
      const fullName = body.full_name == null ? target.full_name : String(body.full_name).trim();
      const role = body.role ?? target.role;
      const teacherId = body.teacher_id === undefined ? target.teacher_id : body.teacher_id == null ? null : Number(body.teacher_id);
      const password = body.password == null ? "" : String(body.password);
      if (!email || !fullName || !["admin", "teacher"].includes(role)) throw new ApiError("Invalid account details.");
      if (password && password.length < 10) throw new ApiError("Password must be at least 10 characters.");
      if (role === "teacher" && !Number.isSafeInteger(teacherId)) throw new ApiError("A teacher account must be linked to a teacher record.");

      const authUpdates: Record<string, unknown> = { email, email_confirm: true, user_metadata: { full_name: fullName } };
      if (password) authUpdates.password = password;
      const { error: authError } = await admin.auth.admin.updateUserById(target.auth_user_id, authUpdates);
      if (authError) throw new ApiError(authError.message, 400);

      const { data: updated, error } = await admin
        .from("app_profiles")
        .update({ email, full_name: fullName, role, teacher_id: teacherId })
        .eq("id", id)
        .select("id, auth_user_id, email, full_name, role, teacher_id, is_active")
        .single();
      if (error) throw new ApiError(error.message, 400);
      return json({ user: updated });
    }

    if (action === "delete") {
      if (target.id === profile.id) throw new ApiError("You cannot delete your own account.", 400);
      if (target.role === "admin" && target.is_active) {
        const { count, error: countError } = await admin
          .from("app_profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "admin")
          .eq("is_active", true);
        if (countError) throw new ApiError("Could not verify administrator accounts.", 500);
        if ((count ?? 0) <= 1) throw new ApiError("The last active administrator cannot be deleted.", 400);
      }
      const { error } = await admin.auth.admin.deleteUser(target.auth_user_id);
      if (error) throw new ApiError(error.message, 400);
      return json({ deleted: true });
    }

    throw new ApiError("Unknown account action.");
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    return json({ error: message }, status);
  }
});
