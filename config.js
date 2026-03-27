window.POLLY_CONFIG = {
  // Leave blank to run in demo mode (local browser storage only).
  // Fill these from Supabase project settings for real multi-user forum data.
  supabaseUrl: "https://viecsadnnuzgjictrbnc.supabase.co",
  supabaseAnonKey: "sb_publishable_QQixhXNHiMSeC0ISsarLjQ_8yQlxnWh",

  // SHA-256 hash of primary admin email (lowercase trimmed).
  adminEmailHash: "cee7ad87d779a410d2a1e1d776ac0fa019f163a450204e5263dccb5bebe98ba7",

  // SHA-256 hash of secondary verification email (lowercase trimmed).
  secondaryAdminEmailHash: "e673258528b7661a14cb62d6e5eb65c30f92d11012096a4b5e4a855cbe778f47",

  // Nicknames with moderation tools access in local/demo mode.
  moderatorNames: ["admin"],

  // Nicknames with full admin label in local/demo mode.
  adminNames: ["admin"]
};
