/**
 * 管理员登录，两种模式，取决于当前数据通道。
 *
 * ── supabase 模式 ──────────────────────────────────────────────
 * 真实的邮箱密码登录。登录后还要调用 is_admin() 确认这个账号在 admin_users 表里，
 * 不在就立刻登出。真正的防护来自数据库的 RLS：即使有人伪造前端状态，
 * 没有管理员身份的 token 也读不到任何别人的行。
 *
 * ── local 模式 ─────────────────────────────────────────────────
 * ⚠️ 这不是访问控制，只是一道本地开发闸门。
 * 口令在前端比对，打包后的 JS 里能读到；数据也还在浏览器 localStorage 里，
 * 绕过这个页面直接读 localStorage 就能看到全部内容。
 * 它的作用仅限于：预试期间避免把后台页面误当成参与者页面点进去。
 *
 * 两种模式都用 sessionStorage 存登录标记而不是 localStorage：
 * 关掉标签页即失效，退出后按浏览器后退也回不到已登录状态（交接文档 9.3）。
 */
import { backendKind } from '../lib/storage';
import { getSupabase } from '../lib/supabaseClient';

const SESSION_KEY = 'rongeheng_admin_session_v1';

/** 未配置环境变量时的开发口令，仅 local 模式使用。 */
const DEFAULT_PASSPHRASE = 'rongeheng-dev';

export type AuthMode = 'local' | 'supabase';

export function authMode(): AuthMode {
  return backendKind() === 'supabase' ? 'supabase' : 'local';
}

export function configuredPassphrase(): string {
  return import.meta.env.VITE_ADMIN_PASSPHRASE || DEFAULT_PASSPHRASE;
}

/** 是否仍在使用默认口令，用于在界面上追加一条提醒。 */
export function isUsingDefaultPassphrase(): boolean {
  return !import.meta.env.VITE_ADMIN_PASSPHRASE;
}

function markSignedIn(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, new Date().toISOString());
  } catch {
    /* 隐私模式下无法保存，本次仍可继续操作 */
  }
}

function clearMark(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* 同上 */
  }
}

function hasMark(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) !== null;
  } catch {
    return false;
  }
}

export interface SignInResult {
  ok: boolean;
  message?: string;
}

/**
 * local 模式：口令；supabase 模式：邮箱 + 密码。
 */
export async function signIn(a: string, b?: string): Promise<SignInResult> {
  if (authMode() === 'local') {
    if (a !== configuredPassphrase()) return { ok: false, message: '口令不正确。' };
    markSignedIn();
    return { ok: true };
  }

  const supabase = getSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email: a, password: b ?? '' });
  if (error) {
    return { ok: false, message: `登录失败：${error.message}` };
  }

  const { data: isAdmin, error: rpcError } = await supabase.rpc('is_admin');
  if (rpcError) {
    await supabase.auth.signOut();
    return { ok: false, message: `无法确认管理员身份：${rpcError.message}` };
  }
  if (!isAdmin) {
    await supabase.auth.signOut();
    return {
      ok: false,
      message: '这个账号不是管理员。请在 SQL Editor 里把它插入 admin_users 表后重试。',
    };
  }

  markSignedIn();
  return { ok: true };
}

export async function signOut(): Promise<void> {
  clearMark();
  if (authMode() === 'supabase') {
    try {
      await getSupabase().auth.signOut();
    } catch {
      /* 已经掉线时忽略 */
    }
  }
}

/** 当前是否已登录。supabase 模式下还要再确认一次管理员身份。 */
export async function checkSignedIn(): Promise<boolean> {
  if (!hasMark()) return false;
  if (authMode() === 'local') return true;

  try {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      clearMark();
      return false;
    }
    const { data: isAdmin } = await supabase.rpc('is_admin');
    if (!isAdmin) {
      clearMark();
      return false;
    }
    return true;
  } catch {
    clearMark();
    return false;
  }
}

/**
 * 写进 withdrawal_log 的操作者标识。
 * supabase 模式下数据库函数会用 auth.uid() 覆盖它，前端传什么都不算数。
 */
export const OPERATOR_ID = 'local-admin';
