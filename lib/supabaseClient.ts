// FILE: lib/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;

// Cliente público (somente leitura/escrita dentro das regras de RLS do Supabase)
export const supabase = createClient(supabaseUrl, supabaseKey);
