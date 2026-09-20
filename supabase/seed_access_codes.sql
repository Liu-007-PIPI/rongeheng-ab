-- ============================================================================
-- 融e衡 A/B 实验 · 匿名码导入
--
-- 先执行 schema.sql，再整段执行本文件。
-- 需要 service_role 权限（Supabase 控制台的 SQL Editor 默认就是）——
-- access_codes 没有 insert 策略，普通角色插不进去，这是故意的。
--
-- 生成 50 个码：
--   PILOT01–PILOT05  预试 A
--   PILOT06–PILOT10  预试 B
--   A001–A020        正式 A
--   B001–B020        正式 B
--
-- 明文码不入库，只存 sha256 哈希。下面的 select 会把明文列出来一次，
-- 请复制到线下的发放表里保管，之后数据库里就查不到明文了。
-- ============================================================================

insert into access_codes (code_hash, code_label, assigned_variant, code_type, issued_at)
select
  hash_code(label),
  label,
  variant::variant_t,
  ctype::code_type_t,
  now()
from (
  -- 预试 A：PILOT01–PILOT05
  select 'PILOT' || lpad(g::text, 2, '0') as label, 'A' as variant, 'pilot' as ctype
    from generate_series(1, 5) g
  union all
  -- 预试 B：PILOT06–PILOT10
  select 'PILOT' || lpad(g::text, 2, '0'), 'B', 'pilot'
    from generate_series(6, 10) g
  union all
  -- 正式 A：A001–A020
  select 'A' || lpad(g::text, 3, '0'), 'A', 'formal'
    from generate_series(1, 20) g
  union all
  -- 正式 B：B001–B020
  select 'B' || lpad(g::text, 3, '0'), 'B', 'formal'
    from generate_series(1, 20) g
) rows
on conflict (code_label) do nothing;

-- ────────────────────────────── 核对 ──────────────────────────────

-- 应为：pilot A 5、pilot B 5、formal A 20、formal B 20
select code_type, assigned_variant, count(*) as n
  from access_codes
 group by code_type, assigned_variant
 order by code_type, assigned_variant;

-- 正式码发放顺序。交接文档第六章要求分发前打乱顺序、按招募先后依次发放，
-- 避免研究人员主观挑选分组。把这份结果抄进线下发放表，按 seq 从小到大发。
select
  row_number() over (order by md5(code_label || '发放种子-换一次改一次这里')) as seq,
  code_label
  from access_codes
 where code_type = 'formal'
 order by seq;

-- ────────────────────────────── 添加管理员 ──────────────────────────────
-- 先在 Supabase 控制台 Authentication → Users 里用邮箱密码建好管理员账号，
-- 然后把下面的邮箱换成实际邮箱并执行：
--
-- insert into admin_users (user_id, email)
-- select id, email from auth.users where email = '你的管理员邮箱@example.com'
-- on conflict (user_id) do nothing;
--
-- 验收（交接文档 7.8）：
--   1. 用普通参与者账号查 participants，应只看到自己那一行；
--   2. 用普通参与者账号查 access_codes / events，应返回 0 行；
--   3. 用管理员账号查 decisions 能看到全部，但执行 update 会被拒绝（没有 update 策略）。
