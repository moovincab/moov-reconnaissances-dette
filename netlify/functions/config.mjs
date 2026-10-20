import {ok} from './shared/core.mjs';
export default async ()=>ok({supabaseUrl:process.env.SUPABASE_URL||'',publicKey:process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY||'',ready:!!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY) && (process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY))});
