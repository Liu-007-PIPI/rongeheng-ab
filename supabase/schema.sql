-- ============================================================================
-- 融e衡 A/B 实验 · Supabase 初始化
-- 对应《融e衡项目Claude交接文档》第七章（字段设计）与 7.8（访问控制）
--
-- 在 Supabase 控制台 → SQL Editor 里整段执行。可重复执行。
-- 执行完再跑 seed_access_codes.sql 导入 50 个匿名码。
--
-- 设计要点：
-- 1. 匿名码只存哈希，明文不入库；前端拿不到 assigned_variant，分组由数据库函数分配。
-- 2. 所有业务表启用 RLS，且不给 anon/authenticated 任何直接写入权限，
--    参与者的一切写入都走 SECURITY DEFINER 函数，参数受控。
-- 3. 管理员可读、可导出、可按匿名码删除，但没有任何 UPDATE 策略——改不了参与者答案。
-- ============================================================================

create extension if not exists "pgcrypto";

-- ────────────────────────────── 枚举 ──────────────────────────────

do $enum$ begin
  create type variant_t as enum ('A', 'B');
exception when duplicate_object then null; end $enum$;

do $enum$ begin
  create type code_type_t as enum ('pilot', 'formal');
exception when duplicate_object then null; end $enum$;

do $enum$ begin
  create type code_status_t as enum ('unused', 'started', 'completed', 'withdrawn');
exception when duplicate_object then null; end $enum$;

do $enum$ begin
  create type completion_status_t as enum ('in_progress', 'completed', 'withdrawn');
exception when duplicate_object then null; end $enum$;

do $enum$ begin
  create type final_choice_t as enum
    ('full_payment', 'installment', 'save_then_buy', 'alternative', 'not_now');
exception when duplicate_object then null; end $enum$;

do $enum$ begin
  create type payment_path_t as enum ('full_payment', 'installment');
exception when duplicate_object then null; end $enum$;

-- ────────────────────────────── 管理员 ──────────────────────────────

create table if not exists admin_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

-- SECURITY DEFINER，避免 is_admin() 自己被 admin_users 的 RLS 挡住导致递归
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (select 1 from admin_users where user_id = auth.uid());
$fn$;

-- ────────────────────────────── 7.1 匿名码 ──────────────────────────────

create table if not exists access_codes (
  id               uuid primary key default gen_random_uuid(),
  code_hash        text unique not null,
  code_label       text unique not null,
  assigned_variant variant_t   not null,
  code_type        code_type_t not null,
  status           code_status_t not null default 'unused',
  auth_user_id     uuid unique references auth.users(id) on delete set null,
  issued_at        timestamptz,
  first_used_at    timestamptz,
  completed_at     timestamptz
);

-- ────────────────────────────── 7.2 参与者 ──────────────────────────────

create table if not exists participants (
  participant_id         uuid primary key default gen_random_uuid(),
  auth_user_id           uuid unique not null references auth.users(id) on delete cascade,
  access_code_id         uuid unique not null references access_codes(id) on delete cascade,
  variant                variant_t   not null,
  age_group              text,
  role_status            text,
  disposable_funds_band  text,
  installment_experience text,
  recent_large_purchase  boolean,
  consent_version        text not null,
  consent_at             timestamptz not null,
  created_at             timestamptz not null default now()
);

-- ────────────────────────────── 7.3 会话 ──────────────────────────────

create table if not exists experiment_sessions (
  session_id        uuid primary key default gen_random_uuid(),
  participant_id    uuid not null references participants(participant_id) on delete cascade,
  variant           variant_t not null,
  scenario_order    text[] not null,
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  total_duration_ms bigint,
  completion_status completion_status_t not null default 'in_progress',
  app_version       text not null,
  constraint experiment_sessions_participant_uniq unique (participant_id)
);

-- ────────────────────────────── 7.4 情境配置 ──────────────────────────────

create table if not exists scenario_config (
  scenario_id           text primary key,
  scenario_version      text not null,
  title                 text not null,
  product_name          text not null,
  base_price            numeric(12,2) not null,
  available_funds       numeric(12,2) not null,
  necessary_expense_30d numeric(12,2) not null,
  emergency_reserve     numeric(12,2) not null,
  installment_periods   integer not null,
  installment_payment   numeric(12,2) not null,
  installment_total     numeric(12,2) not null,
  alternative_name      text not null,
  alternative_price     numeric(12,2) not null,
  is_active             boolean not null default true
);

-- ────────────────────────────── 7.5 决策 ──────────────────────────────

create table if not exists decisions (
  decision_id           uuid primary key default gen_random_uuid(),
  session_id            uuid not null references experiment_sessions(session_id) on delete cascade,
  participant_id        uuid not null references participants(participant_id) on delete cascade,
  scenario_id           text not null,
  scenario_position     integer not null check (scenario_position between 1 and 3),
  final_choice          final_choice_t not null,
  selected_payment_path payment_path_t,
  installment_term      integer,
  projected_min_balance numeric(12,2) not null,
  high_risk_choice      boolean not null,
  viewed_cashflow       boolean not null default false,
  viewed_total_cost     boolean not null default false,
  clicked_lower_price   boolean not null default false,
  changed_choice        boolean not null default false,
  decision_time_ms      bigint not null,
  submitted_at          timestamptz not null default now(),
  constraint decisions_session_scenario_uniq unique (session_id, scenario_id)
);

-- ────────────────────────────── 7.6 事件 ──────────────────────────────
-- 不记录 IP、地址、姓名、手机号、卡号、设备唯一标识或剪贴板内容（交接文档 7.6）

create table if not exists events (
  event_id       uuid primary key default gen_random_uuid(),
  session_id     uuid not null references experiment_sessions(session_id) on delete cascade,
  participant_id uuid not null references participants(participant_id) on delete cascade,
  scenario_id    text,
  event_name     text not null,
  event_ts       timestamptz not null default now(),
  metadata       jsonb not null default '{}'::jsonb
);

-- ────────────────────────────── 7.7 撤回日志 ──────────────────────────────

create table if not exists withdrawal_log (
  id             uuid primary key default gen_random_uuid(),
  access_code_id uuid not null references access_codes(id) on delete cascade,
  requested_at   timestamptz not null default now(),
  processed_at   timestamptz,
  processed_by   uuid references auth.users(id),
  note           text
);

-- ────────────────────────────── 索引 ──────────────────────────────

create index if not exists idx_participants_auth     on participants(auth_user_id);
create index if not exists idx_sessions_participant  on experiment_sessions(participant_id);
create index if not exists idx_decisions_session     on decisions(session_id);
create index if not exists idx_decisions_participant on decisions(participant_id);
create index if not exists idx_decisions_scenario    on decisions(scenario_id);
create index if not exists idx_events_session        on events(session_id);
create index if not exists idx_events_participant    on events(participant_id);
create index if not exists idx_events_ts             on events(event_ts);
create index if not exists idx_access_codes_status   on access_codes(status);

-- ============================================================================
-- RLS
-- ============================================================================

alter table admin_users         enable row level security;
alter table access_codes        enable row level security;
alter table participants        enable row level security;
alter table experiment_sessions enable row level security;
alter table scenario_config     enable row level security;
alter table decisions           enable row level security;
alter table events              enable row level security;
alter table withdrawal_log      enable row level security;

-- 先清掉同名策略，保证脚本可重复执行
do $cleanup$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('admin_users','access_codes','participants','experiment_sessions',
                        'scenario_config','decisions','events','withdrawal_log')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $cleanup$;

-- access_codes：参与者一行都读不到，分组只能由数据库函数分配。
-- 故意不建 insert / update 策略：导码用 service_role（绕过 RLS），
-- 状态变更只允许走下面的 SECURITY DEFINER 函数。
create policy access_codes_admin_read on access_codes
  for select using (is_admin());
create policy access_codes_admin_delete on access_codes
  for delete using (is_admin());

-- participants：本人只读自己；管理员只读不改。
-- 无 update 策略 ⇒ 任何人都改不了参与者答案（交接文档 8.8）
create policy participants_self_read on participants
  for select using (auth_user_id = auth.uid());
create policy participants_admin_read on participants
  for select using (is_admin());
create policy participants_admin_delete on participants
  for delete using (is_admin());

create policy sessions_self_read on experiment_sessions
  for select using (
    participant_id in (select participant_id from participants where auth_user_id = auth.uid())
  );
create policy sessions_admin_read on experiment_sessions
  for select using (is_admin());
create policy sessions_admin_delete on experiment_sessions
  for delete using (is_admin());

create policy decisions_self_read on decisions
  for select using (
    participant_id in (select participant_id from participants where auth_user_id = auth.uid())
  );
create policy decisions_admin_read on decisions
  for select using (is_admin());
create policy decisions_admin_delete on decisions
  for delete using (is_admin());

-- events：参与者读不到也写不了，只有管理员能读
create policy events_admin_read on events
  for select using (is_admin());
create policy events_admin_delete on events
  for delete using (is_admin());

-- scenario_config：登录用户可读（页面要渲染参数），只有管理员能改
create policy scenario_config_read on scenario_config
  for select using (auth.uid() is not null);
create policy scenario_config_admin_write on scenario_config
  for all using (is_admin()) with check (is_admin());

create policy withdrawal_admin_read on withdrawal_log
  for select using (is_admin());
create policy withdrawal_admin_insert on withdrawal_log
  for insert with check (is_admin());

-- admin_users：新增管理员请用 service_role 或控制台手工 insert
create policy admin_users_read on admin_users
  for select using (is_admin());

-- ============================================================================
-- 参与者写入通道：全部走 SECURITY DEFINER 函数。
-- 前端只能调用这几个函数，无法直接 INSERT / UPDATE 任何业务表。
-- ============================================================================

-- 新版 Supabase 项目会把 pgcrypto 的函数装进 extensions schema 而不是 public，
-- 这里同时把两个 schema 都放进搜索路径，兼容新旧项目，避免 "function digest(...) does not exist"。
create or replace function hash_code(p_code text)
returns text
language sql
immutable
set search_path = public, extensions
as $fn$
  select encode(digest(upper(trim(p_code)), 'sha256'), 'hex');
$fn$;

-- 只回状态，不回分组，也不回是预试还是正式（交接文档 9.1）
create or replace function peek_access_code(p_code text)
returns code_status_t
language plpgsql stable security definer set search_path = public
as $fn$
declare v_status code_status_t;
begin
  select status into v_status from access_codes where code_hash = hash_code(p_code);
  if v_status is null then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;
  return v_status;
end $fn$;

-- 绑定匿名码、建参与者、建会话、随机情境顺序，一次事务完成
create or replace function start_experiment(
  p_code            text,
  p_baseline        jsonb,
  p_consent_version text,
  p_app_version     text
)
returns table (out_session_id uuid, out_participant_id uuid, out_variant variant_t, out_order text[])
language plpgsql security definer set search_path = public
as $fn$
declare
  v_code  access_codes%rowtype;
  v_pid   uuid;
  v_sid   uuid;
  v_order text[];
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select * into v_code from access_codes where code_hash = hash_code(p_code) for update;
  if not found then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;
  if v_code.status in ('completed', 'withdrawn') then
    raise exception 'code_unavailable' using errcode = 'P0001';
  end if;

  -- 已绑定过：同一个用户回来就恢复，换了用户则拒绝（一码一人）
  if v_code.auth_user_id is not null and v_code.auth_user_id <> auth.uid() then
    raise exception 'code_bound_elsewhere' using errcode = 'P0001';
  end if;

  select p.participant_id into v_pid from participants p where p.access_code_id = v_code.id;

  if v_pid is null then
    insert into participants (
      auth_user_id, access_code_id, variant,
      age_group, role_status, disposable_funds_band, installment_experience,
      recent_large_purchase, consent_version, consent_at
    ) values (
      auth.uid(), v_code.id, v_code.assigned_variant,
      p_baseline->>'age_group',
      p_baseline->>'role_status',
      p_baseline->>'disposable_funds_band',
      p_baseline->>'installment_experience',
      (p_baseline->>'recent_large_purchase')::boolean,
      p_consent_version, now()
    ) returning participants.participant_id into v_pid;

    update access_codes
       set status = 'started',
           auth_user_id = auth.uid(),
           first_used_at = coalesce(first_used_at, now())
     where id = v_code.id;
  end if;

  select s.session_id, s.scenario_order into v_sid, v_order
    from experiment_sessions s where s.participant_id = v_pid;

  if v_sid is null then
    -- 情境顺序在服务端随机，前端无法指定
    select array_agg(x order by random()) into v_order
      from unnest(array['laptop','phone','course']) as x;
    insert into experiment_sessions (participant_id, variant, scenario_order, app_version)
    values (v_pid, v_code.assigned_variant, v_order, p_app_version)
    returning experiment_sessions.session_id into v_sid;
  end if;

  return query select v_sid, v_pid, v_code.assigned_variant, v_order;
end $fn$;

-- 提交一个情境的决策。风险标签由服务端按冻结规则重算，不信任前端传值。
create or replace function submit_decision(
  p_scenario_id         text,
  p_scenario_position   integer,
  p_final_choice        final_choice_t,
  p_payment_path        payment_path_t,
  p_installment_term    integer,
  p_due_now             numeric,
  p_viewed_cashflow     boolean,
  p_viewed_total_cost   boolean,
  p_clicked_lower_price boolean,
  p_changed_choice      boolean,
  p_decision_time_ms    bigint
)
returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare
  v_pid     uuid;
  v_sid     uuid;
  v_cfg     scenario_config%rowtype;
  v_balance numeric;
  v_risk    boolean;
  v_did     uuid;
begin
  select p.participant_id into v_pid from participants p where p.auth_user_id = auth.uid();
  if v_pid is null then
    raise exception 'no_participant' using errcode = 'P0001';
  end if;

  select s.session_id into v_sid from experiment_sessions s where s.participant_id = v_pid;
  if v_sid is null then
    raise exception 'no_session' using errcode = 'P0001';
  end if;

  select * into v_cfg from scenario_config where scenario_id = p_scenario_id;
  if not found then
    raise exception 'unknown_scenario' using errcode = 'P0001';
  end if;

  -- 交接文档 4.4，与前端 calc.ts 同一条公式
  v_balance := v_cfg.available_funds - v_cfg.necessary_expense_30d - coalesce(p_due_now, 0);
  v_risk    := v_balance < v_cfg.emergency_reserve;

  insert into decisions (
    session_id, participant_id, scenario_id, scenario_position,
    final_choice, selected_payment_path, installment_term,
    projected_min_balance, high_risk_choice,
    viewed_cashflow, viewed_total_cost, clicked_lower_price, changed_choice,
    decision_time_ms
  ) values (
    v_sid, v_pid, p_scenario_id, p_scenario_position,
    p_final_choice, p_payment_path, p_installment_term,
    v_balance, v_risk,
    coalesce(p_viewed_cashflow, false), coalesce(p_viewed_total_cost, false),
    coalesce(p_clicked_lower_price, false), coalesce(p_changed_choice, false),
    p_decision_time_ms
  )
  -- 幂等：同一情境重复提交不报错也不产生第二条，断网重试是安全的
  on conflict (session_id, scenario_id) do nothing
  returning decisions.decision_id into v_did;

  if v_did is null then
    select d.decision_id into v_did from decisions d
     where d.session_id = v_sid and d.scenario_id = p_scenario_id;
  end if;

  -- 三个情境齐了就自动收尾
  update experiment_sessions s
     set completion_status = 'completed',
         completed_at = now(),
         total_duration_ms = extract(epoch from (now() - s.started_at)) * 1000
   where s.session_id = v_sid
     and s.completion_status = 'in_progress'
     and (select count(*) from decisions d where d.session_id = v_sid) >= 3;

  update access_codes ac
     set status = 'completed', completed_at = now()
   where ac.auth_user_id = auth.uid()
     and exists (select 1 from experiment_sessions s
                  where s.session_id = v_sid and s.completion_status = 'completed');

  return v_did;
end $fn$;

create or replace function log_event(
  p_scenario_id text,
  p_event_name  text,
  p_metadata    jsonb
)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare v_pid uuid; v_sid uuid;
begin
  select p.participant_id into v_pid from participants p where p.auth_user_id = auth.uid();
  if v_pid is null then return; end if;
  select s.session_id into v_sid from experiment_sessions s where s.participant_id = v_pid;
  if v_sid is null then return; end if;

  insert into events (session_id, participant_id, scenario_id, event_name, metadata)
  values (v_sid, v_pid, p_scenario_id, p_event_name, coalesce(p_metadata, '{}'::jsonb));
end $fn$;

-- 管理员撤回：删除该码的全部关联数据，标记 withdrawn，写日志
create or replace function admin_withdraw_code(p_code_label text, p_note text)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_code    access_codes%rowtype;
  v_deleted integer;
begin
  if not is_admin() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  select * into v_code from access_codes
   where code_label = upper(trim(p_code_label)) for update;
  if not found then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;

  -- 删 participants 会级联带走 sessions / decisions / events
  delete from participants where access_code_id = v_code.id;
  get diagnostics v_deleted = row_count;

  update access_codes set status = 'withdrawn', auth_user_id = null where id = v_code.id;

  insert into withdrawal_log (access_code_id, processed_at, processed_by, note)
  values (v_code.id, now(), auth.uid(), coalesce(p_note, '按参与者请求删除全部关联记录'));

  return jsonb_build_object('participants_deleted', v_deleted);
end $fn$;

-- ────────────────────────────── 函数执行权限 ──────────────────────────────

revoke all on function start_experiment(text, jsonb, text, text) from public;
revoke all on function submit_decision(text, integer, final_choice_t, payment_path_t, integer,
                                       numeric, boolean, boolean, boolean, boolean, bigint) from public;
revoke all on function log_event(text, text, jsonb) from public;
revoke all on function admin_withdraw_code(text, text) from public;

grant execute on function peek_access_code(text) to anon, authenticated;
grant execute on function start_experiment(text, jsonb, text, text) to authenticated;
grant execute on function submit_decision(text, integer, final_choice_t, payment_path_t, integer,
                                          numeric, boolean, boolean, boolean, boolean, bigint) to authenticated;
grant execute on function log_event(text, text, jsonb) to authenticated;
-- 函数内部会再查一次 is_admin()，所以这里授予 authenticated 是安全的
grant execute on function admin_withdraw_code(text, text) to authenticated;

-- ============================================================================
-- 情境参数（与 src/config/scenarios.ts 保持一致，改任一侧都要同步另一侧）
-- ============================================================================

insert into scenario_config (
  scenario_id, scenario_version, title, product_name, base_price, available_funds,
  necessary_expense_30d, emergency_reserve, installment_periods, installment_payment,
  installment_total, alternative_name, alternative_price, is_active
) values
  ('laptop', '2026-09-19-v1', '换一台笔记本电脑', '轻薄笔记本电脑',
   6000, 5000, 3200, 1000, 12, 550, 6600, '同需求上一代机型（16G / 512G）', 4999, true),
  ('phone',  '2026-09-19-v1', '换一部手机', '智能手机',
   4999, 6200, 2800, 1200, 12, 467, 5604, '同型号其他可靠渠道', 3999, true),
  ('course', '2026-09-19-v1', '报一门培训课程', '技能培训课程',
   2999, 3800, 2600,  800,  6, 520, 3120, '同类课程其他机构', 1999, true)
on conflict (scenario_id) do update set
  scenario_version      = excluded.scenario_version,
  base_price            = excluded.base_price,
  available_funds       = excluded.available_funds,
  necessary_expense_30d = excluded.necessary_expense_30d,
  emergency_reserve     = excluded.emergency_reserve,
  installment_periods   = excluded.installment_periods,
  installment_payment   = excluded.installment_payment,
  installment_total     = excluded.installment_total,
  alternative_name      = excluded.alternative_name,
  alternative_price     = excluded.alternative_price;
