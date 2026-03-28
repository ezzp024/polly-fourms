window.POLLY_CONFIG = {
  // Leave blank to run in demo mode (local browser storage only).
  // Fill these from Supabase project settings for real multi-user forum data.
  supabaseUrl: "https://viecsadnnuzgjictrbnc.supabase.co",
  supabaseAnonKey: "sb_publishable_QQixhXNHiMSeC0ISsarLjQ_8yQlxnWh",

  // Admin identity must be configured server-side.
  adminEmailHash: "",
  secondaryAdminEmailHash: "",

  // Nicknames with moderation tools access in local/demo mode.
  moderatorNames: ["admin"],

  // Nicknames with full admin label in local/demo mode.
  adminNames: ["admin"],

  // Set false to disable self-service registration.
  allowRegistration: true
};
