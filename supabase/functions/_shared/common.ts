import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
}
export function preflight(req: Request) { return req.method === "OPTIONS" ? new Response("ok", { headers: corsHeaders }) : null; }
export function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function requireUser(req: Request) {
  const header = req.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new Error("Connexion requise.");
  const db = adminClient();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new Error("Session invalide ou expirée.");
  const { data: profile, error: pError } = await db.from("profiles").select("id,email,full_name,role").eq("id", data.user.id).single();
  if (pError || !profile) throw new Error("Profil utilisateur introuvable.");
  return { db, user: data.user, profile };
}

export function canAccessDebt(
  profile: { role?: string },
  userId: string,
  debt: { created_by?: string | null; assigned_to?: string | null },
) {
  return profile.role === "admin" || debt.created_by === userId || debt.assigned_to === userId;
}

const FR_UNITS = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize"];
function frenchInteger(n: number): string {
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) throw new Error("Montant invalide pour la conversion en lettres.");
  if (n < 17) return FR_UNITS[n];
  if (n < 20) return `dix-${FR_UNITS[n - 10]}`;
  if (n < 70) {
    const tens = Math.floor(n / 10) * 10; const rest = n % 10;
    const labels: Record<number, string> = {20:"vingt",30:"trente",40:"quarante",50:"cinquante",60:"soixante"};
    if (!rest) return labels[tens];
    return `${labels[tens]}${rest === 1 ? " et un" : `-${FR_UNITS[rest]}`}`;
  }
  if (n < 80) {
    const rest = n - 60;
    if (rest === 11) return "soixante et onze";
    return `soixante-${frenchInteger(rest)}`;
  }
  if (n < 100) {
    const rest = n - 80;
    if (!rest) return "quatre-vingts";
    return `quatre-vingt${rest === 1 ? "-un" : `-${frenchInteger(rest)}`}`;
  }
  if (n < 1000) {
    const hundreds = Math.floor(n / 100); const rest = n % 100;
    const prefix = hundreds === 1 ? "cent" : `${FR_UNITS[hundreds]} cent`;
    return `${prefix}${rest === 0 && hundreds > 1 ? "s" : ""}${rest ? ` ${frenchInteger(rest)}` : ""}`;
  }
  if (n < 1_000_000) {
    const thousands = Math.floor(n / 1000); const rest = n % 1000;
    return `${thousands === 1 ? "mille" : `${frenchInteger(thousands)} mille`}${rest ? ` ${frenchInteger(rest)}` : ""}`;
  }
  if (n < 1_000_000_000) {
    const millions = Math.floor(n / 1_000_000); const rest = n % 1_000_000;
    return `${frenchInteger(millions)} million${millions > 1 ? "s" : ""}${rest ? ` ${frenchInteger(rest)}` : ""}`;
  }
  const milliards = Math.floor(n / 1_000_000_000); const rest = n % 1_000_000_000;
  return `${frenchInteger(milliards)} milliard${milliards > 1 ? "s" : ""}${rest ? ` ${frenchInteger(rest)}` : ""}`;
}
export function amountInFrenchWords(value: number | string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000) throw new Error("Montant invalide pour la conversion en lettres.");
  const centsTotal = Math.round(amount * 100);
  const euros = Math.floor(centsTotal / 100); const cents = centsTotal % 100;
  const euroText = `${frenchInteger(euros)} euro${euros > 1 ? "s" : ""}`;
  return cents ? `${euroText} et ${frenchInteger(cents)} centime${cents > 1 ? "s" : ""}` : euroText;
}

export async function sendEmail(to: string, subject: string, html: string, text: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM");
  if (!key || !from) throw new Error("RESEND_API_KEY ou RESEND_FROM manquant dans les secrets Supabase.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Échec d'envoi e-mail (${response.status}): ${JSON.stringify(payload)}`);
  return payload;
}
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
}
export function randomToken(bytes = 32) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join("");
}
export async function sha256(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
export function getIp(req: Request) {
  return (req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "").split(",")[0].trim().slice(0, 100);
}
export function amountFr(value: number | string) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(value));
}
export function errorResponse(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "Erreur inattendue.";
  return json({ error: message }, status);
}
