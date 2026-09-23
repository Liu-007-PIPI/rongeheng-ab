/*
  第二轮文案口径 v3（2026-09-23）——只改字，不改数。

  背景：v2 的界面用的是"应急储备""净结余""折合年化利率""低价替代项"这类词。
  这些词参与者看不懂，而看不懂会变成一种与分组无关的噪声：A、B 两组同时被它拉平，
  反而更难测出"信息怎么呈现"本身的效果。所以全部改成口语说法，并给每个概念配一行解释。

  这个脚本只更新 scenario_config 里的文字字段与版本号。
  金额、期数、月收入、储备线、模拟月数一个都没动，服务端重算的结果与 v2 逐位相同，
  worst_balance_over_term() 与 submit_decision() 也不需要改。

  执行前请确认当前项目是 culhmjigwxpkbijisjcp。
  执行后在 Supabase SQL Editor 里跑一次末尾的校验查询，确认三行都已是 2026-09-23-v3。
*/

update scenario_config set
  scenario_version = '2026-09-23-v3',
  title            = '想换一台笔记本电脑',
  product_name     = '轻薄笔记本电脑',
  alternative_name = '上一代机型，配置一样（16G / 512G）'
where scenario_id = 'laptop';

update scenario_config set
  scenario_version = '2026-09-23-v3',
  title            = '想换一部手机',
  product_name     = '智能手机',
  alternative_name = '一模一样的型号，在别家买'
where scenario_id = 'phone';

update scenario_config set
  scenario_version = '2026-09-23-v3',
  title            = '想报一门培训课',
  product_name     = '技能培训课',
  alternative_name = '差不多的课，换一家机构'
where scenario_id = 'course';

/*
  校验：三行都应显示 2026-09-23-v3，且后面这几个数值必须与 v2 完全一致——
  laptop 6000/6000/2200/3000/1500/12，phone 4999/2800/1200/1500/1000/12，
  course 2999/3200/1500/1900/800/6。有任何一个对不上就说明改错了字段，请回滚。
*/
select
  scenario_id,
  scenario_version    as ver,
  title,
  base_price          as price,
  available_funds     as funds,
  necessary_expense_30d as expense,
  monthly_income      as income,
  emergency_reserve   as reserve,
  horizon_months      as months
from scenario_config
order by scenario_id;
