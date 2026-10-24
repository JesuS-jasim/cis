import { ApiError, json, requireProfile, corsHeaders } from "../_shared/http.ts";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function parseState(value: unknown) {
  if (!value || typeof value !== "object") throw new ApiError("Invalid institute data.");
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.teachers) || !Array.isArray(source.courses) ||
    !Array.isArray(source.students) || !source.att || typeof source.att !== "object") {
    throw new ApiError("Institute data is incomplete.");
  }
  return {
    teachers: source.teachers,
    courses: source.courses,
    students: source.students,
    att: source.att as Record<string, { status?: string }>,
  };
}

function teacherView(current: ReturnType<typeof parseState>, teacherId: number) {
  const courses = current.courses.filter((item) => Number(item.teacher_id) === teacherId);
  const courseIds = new Set(courses.map((item) => Number(item.id)));
  const students = current.students.filter((item) => item.course_ids?.some((id: number) => courseIds.has(Number(id))));
  const att = Object.fromEntries(Object.entries(current.att).filter(([key]) => courseIds.has(Number(key.split("|")[2]))));
  return {
    teachers: current.teachers.filter((item) => Number(item.id) === teacherId),
    courses,
    students,
    att,
  };
}

function mergeTeacherChanges(current: ReturnType<typeof parseState>, next: ReturnType<typeof parseState>, teacherId: number) {
  const visible = teacherView(current, teacherId);
  if (stable(visible.teachers) !== stable(next.teachers) ||
    stable(visible.courses) !== stable(next.courses) ||
    stable(visible.students) !== stable(next.students)) {
    throw new ApiError("Teachers can only change attendance records.", 403);
  }

  const mergedAtt = { ...current.att };
  const keys = new Set([...Object.keys(visible.att), ...Object.keys(next.att)]);
  for (const key of keys) {
    if (stable(visible.att[key]) === stable(next.att[key])) continue;
    const [type, personId, courseId, date] = key.split("|");
    const course = visible.courses.find((item) => Number(item.id) === Number(courseId));
    if (!date || !course || Number(course.teacher_id) !== teacherId) {
      throw new ApiError("You can only edit attendance for your assigned courses.", 403);
    }
    if (type === "t" && Number(personId) !== teacherId) {
      throw new ApiError("You can only edit your own teacher attendance.", 403);
    }
    if (type === "s") {
      const student = visible.students.find((item) => Number(item.id) === Number(personId));
      if (!student || !student.course_ids?.some((id: number) => Number(id) === Number(courseId))) {
        throw new ApiError("This student is not enrolled in your course.", 403);
      }
    } else if (type !== "t") {
      throw new ApiError("Invalid attendance record.");
    }
    const record = next.att[key];
    if (record && !["حاضر", "متأخر", "مجاز", "غائب"].includes(record.status ?? "")) {
      throw new ApiError("Invalid attendance status.");
    }
    if (record) mergedAtt[key] = record;
    else delete mergedAtt[key];
  }
  return { ...current, att: mergedAtt };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const { admin, profile } = await requireProfile(request);
    const body = await request.json();
    const { data: row, error: loadError } = await admin
      .from("institute_state")
      .select("data, updated_at")
      .eq("id", 1)
      .single();
    if (loadError) throw new ApiError("Could not load institute data.", 500);

    if (body.action === "get") {
      let query = admin.from("app_profiles").select("id, auth_user_id, email, full_name, role, teacher_id, is_active");
      if (profile.role !== "admin") query = query.eq("id", profile.id);
      const { data: users, error: usersError } = await query.order("id");
      if (usersError) throw new ApiError("Could not load institute accounts.", 500);
      const visibleState = profile.role === "admin"
        ? parseState(row.data)
        : teacherView(parseState(row.data), Number(profile.teacher_id));
      return json({ ...visibleState, users, revision: row.updated_at });
    }

    if (body.action !== "save") throw new ApiError("Unknown action.");
    const next = parseState(body.data);
    const current = parseState(row.data);

    if (profile.role === "teacher") {
      if (profile.teacher_id == null) throw new ApiError("No teacher record is linked to this account.", 403);
      next = mergeTeacherChanges(current, next, Number(profile.teacher_id));
    }

    if (typeof body.revision !== "string") throw new ApiError("Missing data revision. Reload the page and try again.", 409);
    const { data: revision, error: saveError } = await admin.rpc("save_institute_state", {
      p_expected_updated_at: body.revision,
      p_data: next,
    });
    if (saveError) {
      const conflict = saveError.code === "40001";
      throw new ApiError(conflict ? "Institute data changed in another session. Reload and try again." : "Could not save institute data.", conflict ? 409 : 500);
    }
    return json({ saved: true, revision });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    return json({ error: message }, status);
  }
});
