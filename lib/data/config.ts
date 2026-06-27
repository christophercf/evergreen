// Which data layer is active. Mock (default, no keys) vs Supabase (real backend).
export const DATA_SOURCE: "mock" | "supabase" =
  process.env.NEXT_PUBLIC_DATA_SOURCE === "supabase" ? "supabase" : "mock";

export const IS_MOCK = DATA_SOURCE === "mock";
export const IS_SUPABASE = DATA_SOURCE === "supabase";
