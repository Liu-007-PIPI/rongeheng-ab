-- ══════════════════════════════════════════════════════════════════
-- 融e衡 A/B 实验 · 第二轮迁移脚本
--
-- 在 Supabase SQL Editor 里整段执行。可重复执行，不会覆盖第一轮数据。
--
-- 本轮改动：
--   1. scenario_config 增加 monthly_income、horizon_months（多月现金流模拟的前提）
--   2. decisions 增加 worst_balance_term、high_risk_term（完整还款期口径）
--      与 key_info_exposed、key_info_exposed_ms（默认展开后的触达度量）
--   3. participants 增加 attention_check_passed
--   4. submit_decision 同时按两套口径在服务端重算，前端结果一律不采信
--   5. 新增 submit_attention_check
--
-- 第一轮的既有记录：新列一律为 NULL，代表"该轮未采集此口径"，不是 0 也不是 false。
-- 两轮情境参数不同，不可合并分析。
-- ══════════════════════════════════════════════════════════════════

/* ── 1. 情境配置 ── */

alter table scenario_config
  add column if not exists monthly_income  numeric(12,2),
  add column if not exists horizon_months  integer;

-- 第二轮参数（scenario_version = 2026-09-22-v2）。
-- 与前端 src/config/scenarios.ts 必须逐字段一致，服务端重算才有意义。
insert into scenario_config (
  scenario_id, scenario_version, title, product_name,
  base_price, available_funds, necessary_expense_30d, monthly_income,
  emergency_reserve, horizon_months,
  installment_periods, installment_payment, installment_total,
  alternative_name, alternative_price, is_active
) values
  ('laptop', '2026-09-22-v2', '换一台笔记本电脑', '轻薄笔记本电脑',
   6000, 6000, 2200, 3000, 1500, 12, 12, 550, 6600,
   '同需求上一代机型（16G / 512G）', 4999, true),
  ('phone',  '2026-09-22-v2', '换一部手机', '智能手机',
   4999, 2800, 1200, 1500, 1000, 12, 12, 467, 5604,
   '同型号其他可靠渠道', 3999, true),
  ('course', '2026-09-22-v2', '报一门培训课程', '技能培训课程',
   2999, 3200, 1500, 1900,  800,  6,  6, 520, 3120,
   '同类课程其他机构', 1999, true)
on conflict (scenario_id) do update set
  scenario_version      = excluded.scenario_version,
  title                 = excluded.title,
  product_name          = excluded.product_name,
  base_price            = excluded.base_price,
  available_funds       = excluded.available_funds,
  necessary_expense_30d = excluded.necessary_expense_30d,
  monthly_income        = excluded.monthly_income,
  emergency_reserve     = excluded.emergency_reserve,
  horizon_months        = excluded.horizon_months,
  installment_periods   = excluded.installment_periods,
  installment_payment   = excluded.installment_payment,
  installment_total     = excluded.installment_total,
  alternative_name      = excluded.alternative_name,
  alternative_price     = excluded.alternative_price,
  is_active             = excluded.is_active;

/* ── 2. 决策表 ── */

alter table decisions
  add column if not exists worst_balance_term  numeric(12,2),
  add column if not exists high_risk_term      boolean,
  add column if not exists key_info_exposed    boolean,
  add column if not exists key_info_exposed_ms bigint;

comment on column decisions.high_risk_choice is
  '30 天口径：可自由使用资金 − 月必要支出 − 当期支付 < 应急储备。不计收入，与第一轮同定义。';
comment on column decisions.high_risk_term is
  '完整还款期口径：还款期内任何一个月末余额跌破应急储备。第二轮主要判定。第一轮记录为 NULL。';
comment on column decisions.key_info_exposed is
  '本版本核心信息区块在视口内累计停留是否达到 2 秒。第一轮记录为 NULL（当时用点击折叠衡量）。';

/* ── 3. 参与者表 ── */

alter table participants
  add column if not exists attention_check_passed boolean;

comment on column participants.attention_check_passed is
  '注意力检查是否通过。NULL = 未作答或第一轮记录。主分析排除未通过者，另做全样本敏感性分析。';

/* ── 4. 完整还款期的服务端重算 ── */

-- 与前端 calc.ts 的 balancePath 同一套规则：
--   第 k 个月末余额 = 期初可自由使用资金 + k × 月净结余 − 截至该月末的累计支付
-- 返回还款期内的最低余额。累计支付由调用方按路径给出每月支付额与期数。
create or replace function worst_balance_over_term(
  p_available_funds numeric,
  p_monthly_income  numeric,
  p_monthly_expense numeric,
  p_horizon         integer,
  p_payment         numeric,  -- 每期支付额（一次性支付时填全额）
  p_periods         integer   -- 支付期数（一次性支付填 1，不支付填 0）
)
returns numeric
language plpgsql immutable
as $fn$
declare
  v_net   numeric := coalesce(p_monthly_income, 0) - coalesce(p_monthly_expense, 0);
  v_worst numeric;
  v_bal   numeric;
  k       integer;
  v_paid  numeric;
begin
  v_worst := null;
  for k in 1 .. greatest(coalesce(p_horizon, 1), 1) loop
    v_paid := coalesce(p_payment, 0) * least(k, greatest(coalesce(p_periods, 0), 0));
    v_bal  := p_available_funds + k * v_net - v_paid;
    if v_worst is null or v_bal < v_worst then
      v_worst := v_bal;
    end if;
  end loop;
  return v_worst;
end;
$fn$;

/* ── 5. submit_decision：两套口径都在服务端重算 ── */

-- 必须先删旧签名。create or replace 只替换签名完全一致的函数，
-- 否则第一轮那个带 p_viewed_cashflow / p_viewed_total_cost / p_clicked_lower_price 的版本
-- 会作为重载残留，PostgREST 按参数名匹配时会出现歧义或选错。
drop function if exists submit_decision(
  text, integer, final_choice_t, payment_path_t, integer, numeric,
  boolean, boolean, boolean, boolean, bigint
);

create or replace function submit_decision(
  p_scenario_id         text,
  p_scenario_position   integer,
  p_final_choice        final_choice_t,
  p_payment_path        payment_path_t,
  p_installment_term    integer,
  p_due_now             numeric,
  p_key_info_exposed    boolean,
  p_key_info_exposed_ms bigint,
  p_changed_choice      boolean,
  p_decision_time_ms    bigint
)
returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare
  v_pid      uuid;
  v_sid      uuid;
  v_cfg      scenario_config%rowtype;
  v_balance  numeric;
  v_risk     boolean;
  v_worst    numeric;
  v_risk_t   boolean;
  v_payment  numeric;
  v_periods  integer;
  v_net      numeric;
  v_months   integer;
  v_did      uuid;
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

  -- 30 天口径：与第一轮完全相同，保留用于跨轮对照
  v_balance := v_cfg.available_funds - v_cfg.necessary_expense_30d - coalesce(p_due_now, 0);
  v_risk    := v_balance < v_cfg.emergency_reserve;

  -- 完整还款期口径：按最终选择还原支付节奏
  v_net := coalesce(v_cfg.monthly_income, 0) - v_cfg.necessary_expense_30d;
  case p_final_choice
    when 'full_payment' then
      v_payment := v_cfg.base_price;
      v_periods := 1;
    when 'installment' then
      v_payment := v_cfg.installment_payment;
      v_periods := v_cfg.installment_periods;
    when 'alternative' then
      if p_payment_path = 'installment' then
        -- 替代项分期沿用原商品费率，与前端 deriveAlternativeInstallment 同一条推导
        v_payment := round(
          (v_cfg.alternative_price * (v_cfg.installment_total / v_cfg.base_price))
          / v_cfg.installment_periods, 2);
        v_periods := v_cfg.installment_periods;
      else
        v_payment := v_cfg.alternative_price;
        v_periods := 1;
      end if;
    when 'save_then_buy' then
      -- 攒到"买完仍不低于应急储备"才付款
      if v_net <= 0 then
        v_payment := 0;
        v_periods := 0;
      else
        v_months := greatest(1, ceil(
          (v_cfg.emergency_reserve + v_cfg.base_price - v_cfg.available_funds) / v_net)::integer);
        if v_months <= coalesce(v_cfg.horizon_months, 0) then
          -- 用"从第 v_months 个月起累计已付 base_price"等价地表达一次性支付
          v_worst := least(
            v_cfg.available_funds + v_net,                                   -- 买入前的最低点
            v_cfg.available_funds + v_months * v_net - v_cfg.base_price      -- 买入当月
          );
        else
          v_worst := v_cfg.available_funds + v_net;                          -- 窗口内不发生支付
        end if;
        v_payment := null;  -- 已直接算出 v_worst，跳过下面的通用计算
        v_periods := null;
      end if;
    when 'not_now' then
      v_payment := 0;
      v_periods := 0;
  end case;

  if v_worst is null then
    v_worst := worst_balance_over_term(
      v_cfg.available_funds, v_cfg.monthly_income, v_cfg.necessary_expense_30d,
      coalesce(v_cfg.horizon_months, 1), coalesce(v_payment, 0), coalesce(v_periods, 0));
  end if;

  v_risk_t := v_worst < v_cfg.emergency_reserve;

  insert into decisions (
    session_id, participant_id, scenario_id, scenario_position,
    final_choice, selected_payment_path, installment_term,
    projected_min_balance, high_risk_choice,
    worst_balance_term, high_risk_term,
    key_info_exposed, key_info_exposed_ms, changed_choice,
    decision_time_ms
  ) values (
    v_sid, v_pid, p_scenario_id, p_scenario_position,
    p_final_choice, p_payment_path, p_installment_term,
    v_balance, v_risk,
    v_worst, v_risk_t,
    coalesce(p_key_info_exposed, false), coalesce(p_key_info_exposed_ms, 0),
    coalesce(p_changed_choice, false),
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

  update access_codes c
     set status = 'completed', completed_at = now()
    from participants p
   where p.participant_id = v_pid
     and c.id = p.access_code_id
     and (select count(*) from decisions d where d.session_id = v_sid) >= 3;

  return v_did;
end;
$fn$;

/* ── 6. 注意力检查 ── */

create or replace function submit_attention_check(p_passed boolean)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare
  v_pid uuid;
begin
  select p.participant_id into v_pid from participants p where p.auth_user_id = auth.uid();
  if v_pid is null then
    raise exception 'no_participant' using errcode = 'P0001';
  end if;

  -- 只写一次：刷新或重复提交不得覆盖首答，否则参与者可以反复试到答对为止
  update participants
     set attention_check_passed = p_passed
   where participant_id = v_pid
     and attention_check_passed is null;
end;
$fn$;

grant execute on function submit_attention_check(boolean) to anon, authenticated;
grant execute on function worst_balance_over_term(numeric, numeric, numeric, integer, numeric, integer)
  to anon, authenticated;

-- 让 PostgREST 立刻看到新函数与新列，不然前端会收到 404
notify pgrst, 'reload schema';

-- ══════════════════════════════════════════════════════════════════
-- 第二轮补充：开放模式（不需要预先发放的匿名码）
--
-- 参与者打开链接即可作答。分组由服务端按两组人数平衡分配，
-- 撤回码自动生成并写入 access_codes，因此撤回、后台、CSV 导出全部沿用原有逻辑，
-- 不需要任何改动——对下游来说，开放模式只是"码由系统即时签发"而已。
-- ══════════════════════════════════════════════════════════════════

/* ── 7. 会话表：记录这台浏览器提交的第几份 ── */

alter table experiment_sessions
  add column if not exists browser_submission_seq integer not null default 1;

comment on column experiment_sessions.browser_submission_seq is
  '这台浏览器提交的第几份作答。开放模式取消一码一人后用于数据质量审计：大于 1 表示该设备此前已提交过。仅为序号，非设备指纹。';

/* ── 8. 撤回码生成 ── */

-- 字符集去掉 0/O/1/I/L，避免参与者抄写时混淆
create or replace function generate_withdrawal_label()
returns text
language plpgsql volatile
as $fn$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_label    text;
  i          integer;
begin
  for attempt in 1 .. 200 loop
    v_label := 'R-';
    for i in 1 .. 6 loop
      v_label := v_label || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    if not exists (select 1 from access_codes where code_label = v_label) then
      return v_label;
    end if;
  end loop;
  -- 极低概率走到这里；退回带时间戳的写法，保证唯一
  return 'R-' || upper(to_hex(extract(epoch from clock_timestamp())::bigint));
end;
$fn$;

/* ── 9. 开放模式开场 ── */

create or replace function start_experiment_open(
  p_baseline               jsonb,
  p_consent_version        text,
  p_app_version            text,
  p_browser_submission_seq integer
)
returns table (out_session_id uuid, out_participant_id uuid, out_variant variant_t, out_order text[])
language plpgsql security definer set search_path = public
as $fn$
declare
  v_pid     uuid;
  v_sid     uuid;
  v_order   text[];
  v_label   text;
  v_code_id uuid;
  v_variant variant_t;
  v_a       integer;
  v_b       integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  -- 同一个匿名身份只能有一份作答。想再作答一次，前端会换一个新的匿名身份，
  -- 这里读到已有记录就直接把原进度返回，保证刷新不会重复建号。
  select p.participant_id into v_pid from participants p where p.auth_user_id = auth.uid();

  if v_pid is null then
    -- 平衡分配：少的那组优先，相等时随机。
    -- 事务级咨询锁保证并发提交时不会双双读到同一组计数。
    perform pg_advisory_xact_lock(hashtext('rongeheng_variant_assign'));

    select count(*) filter (where variant = 'A'),
           count(*) filter (where variant = 'B')
      into v_a, v_b
      from participants;

    v_variant := case
      when v_a < v_b then 'A'::variant_t
      when v_b < v_a then 'B'::variant_t
      else (case when random() < 0.5 then 'A' else 'B' end)::variant_t
    end;

    -- 即时签发一个撤回码，下游（撤回、后台、导出）沿用原有的按码操作
    v_label := generate_withdrawal_label();
    insert into access_codes (code_hash, code_label, assigned_variant, code_type,
                              status, auth_user_id, issued_at, first_used_at)
    values (hash_code(v_label), v_label, v_variant, 'formal',
            'started', auth.uid(), now(), now())
    returning id into v_code_id;

    insert into participants (
      auth_user_id, access_code_id, variant,
      age_group, role_status, disposable_funds_band, installment_experience,
      recent_large_purchase, consent_version, consent_at
    ) values (
      auth.uid(), v_code_id, v_variant,
      p_baseline->>'age_group',
      p_baseline->>'role_status',
      p_baseline->>'disposable_funds_band',
      p_baseline->>'installment_experience',
      (p_baseline->>'recent_large_purchase')::boolean,
      p_consent_version, now()
    ) returning participants.participant_id into v_pid;
  else
    select p.variant into v_variant from participants p where p.participant_id = v_pid;
  end if;

  select s.session_id, s.scenario_order into v_sid, v_order
    from experiment_sessions s where s.participant_id = v_pid;

  if v_sid is null then
    -- 情境顺序在服务端随机，前端无法指定
    select array_agg(x order by random()) into v_order
      from unnest(array['laptop','phone','course']) as x;
    insert into experiment_sessions (participant_id, variant, scenario_order, app_version,
                                     browser_submission_seq)
    values (v_pid, v_variant, v_order, p_app_version, greatest(coalesce(p_browser_submission_seq, 1), 1))
    returning experiment_sessions.session_id into v_sid;
  end if;

  return query select v_sid, v_pid, v_variant, v_order;
end;
$fn$;

revoke all on function start_experiment_open(jsonb, text, text, integer) from public;
grant execute on function start_experiment_open(jsonb, text, text, integer) to authenticated;
revoke all on function generate_withdrawal_label() from public;

notify pgrst, 'reload schema';
