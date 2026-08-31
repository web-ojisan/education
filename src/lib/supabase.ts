// Supabaseクライアント生成ヘルパー。
// service_role キーはここでは一切扱わない(RLSで守れる範囲はanon key + ユーザーセッションのみで完結させる)。
import { createBrowserClient, createServerClient } from '@supabase/ssr';
import type { AstroCookies } from 'astro';

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

/**
 * ブラウザ(Reactアイランド・.astro内の<script>)から使うSupabaseクライアント。
 * セッションはCookieに保存され、サーバー側のクライアントと共有される。
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/**
 * AstroのSSR(.astroページのフロントマター)から使うSupabaseクライアント。
 * リクエストのCookieからセッションを読み、更新があればレスポンスのCookieに書き戻す。
 */
export function createSupabaseServerClient(request: Request, cookies: AstroCookies) {
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('cookie'));
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookies.set(name, value, options);
        }
      },
    },
  });
}

function parseCookieHeader(header: string | null): { name: string; value: string }[] {
  if (!header) return [];
  return header
    .split(';')
    .map((part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex === -1) return null;
      const name = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      if (!name) return null;
      try {
        return { name, value: decodeURIComponent(value) };
      } catch {
        return { name, value };
      }
    })
    .filter((c): c is { name: string; value: string } => c !== null);
}
