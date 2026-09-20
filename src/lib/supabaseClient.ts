/**
 * Supabase 客户端。
 *
 * 前端只使用 publishable key（旧称 anon key）。这个密钥设计上就是公开的，
 * 真正的防护来自数据库里的 RLS 策略和 SECURITY DEFINER 函数。
 *
 * secret key（旧称 service_role）**绝不允许**出现在这个文件、.env 示例、
 * 浏览器请求或代码仓库里——它能绕过全部 RLS。
 */
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const URL_ENV = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const KEY_ENV = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';

/** 环境变量是否配齐。没配齐就退回本地存储，不会静默连到别处。 */
export function isSupabaseConfigured(): boolean {
  return URL_ENV.length > 0 && KEY_ENV.length > 0;
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase 未配置：请在 .env.local 里填 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY');
  }
  if (!client) {
    client = createClient(URL_ENV, KEY_ENV, {
      auth: {
        // 会话存在 localStorage 里，参与者刷新页面后还是同一个匿名身份，
        // 这样才能按 auth.uid() 找回自己的作答进度
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

/**
 * 确保当前有一个（匿名）登录身份。
 * 参与者不需要注册，Supabase 的匿名登录会发一个只属于这台浏览器的 uid，
 * 数据库里的 RLS 就靠这个 uid 判断"哪些行是你自己的"。
 */
export async function ensureAnonymousSession(): Promise<void> {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  if (data.session) return;

  const { error } = await supabase.auth.signInAnonymously();
  if (error) {
    throw new Error(
      `匿名登录失败：${error.message}。请确认 Supabase 控制台 Authentication → Providers 里已开启 Anonymous sign-ins。`,
    );
  }
}

/** 把 Postgres 函数抛出的英文错误码翻成页面能用的原因。 */
export function translateRpcError(message: string): string {
  if (message.includes('invalid_code')) return 'not_found';
  if (message.includes('code_unavailable')) return 'completed';
  if (message.includes('code_bound_elsewhere')) return 'in_use_elsewhere';
  if (message.includes('not_authenticated')) return 'failed';
  return 'failed';
}
