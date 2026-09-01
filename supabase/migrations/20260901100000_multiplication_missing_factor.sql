-- 九九の穴あきモード(multiplication_missing_factor)追加に伴い、習熟ビューを再作成する。
-- 変更点:
-- - 対象テンプレートを multiplication_fact(順方向)と multiplication_missing_factor(穴あき)の2つにする。
-- - mode列('forward' | 'missing_factor')を追加する。想起の方向が違うため、
--   同じ a×b でも順方向と穴あきの習熟は別々に判定する(problem_idが別なので自然に分かれる)。
-- - 習得条件・閾値(基礎帯3秒/拡張帯5秒、5連続、一度達成で維持)は両モード共通。
-- CREATE OR REPLACE では列の追加位置を変えられないため、DROPして作り直す。

drop view public.multiplication_mastery;

create view public.multiplication_mastery
with (security_invoker = on)
as
with fact_logs as (
  select
    al.child_id,
    al.problem_id,
    (p.params ->> 'a')::int as a,
    (p.params ->> 'b')::int as b,
    pt.shape_type,
    al.completed_at,
    al.created_at,
    al.id as log_id,
    -- 即答判定: 正答かつ帯ごとの閾値秒以内(基礎帯3秒 / 拡張帯5秒)
    (
      al.is_correct
      and (al.completed_at - al.started_at)
        <= make_interval(secs => case when (p.params ->> 'a')::int <= 9 then 3 else 5 end)
    ) as is_quick_correct
  from public.answer_logs al
  join public.problems p on p.id = al.problem_id
  join public.problem_templates pt on pt.id = p.template_id
  where pt.shape_type in ('multiplication_fact', 'multiplication_missing_factor')
    and al.context = 'drill'
),
numbered as (
  select
    fact_logs.*,
    -- gaps-and-islands: 非即答が現れるたびに番号が進むため、
    -- 「即答の連続」は同じ miss_count を共有する島になる
    count(*) filter (where not is_quick_correct) over (
      partition by child_id, problem_id
      order by completed_at, created_at, log_id
    ) as miss_count
  from fact_logs
),
streaks as (
  select
    child_id,
    problem_id,
    completed_at,
    row_number() over (
      partition by child_id, problem_id, miss_count
      order by completed_at, created_at, log_id
    ) as streak_pos
  from numbered
  where is_quick_correct
),
mastery as (
  select
    child_id,
    problem_id,
    -- 5連続を初めて達成した瞬間(= 連続5問目のcompleted_at)。streak_pos=5 は連続5問目を意味する
    min(completed_at) filter (where streak_pos = 5) as mastered_at
  from streaks
  group by child_id, problem_id
)
select
  fl.child_id,
  fl.problem_id,
  fl.a,
  fl.b,
  case when fl.shape_type = 'multiplication_fact' then 'forward' else 'missing_factor' end as mode,
  case when fl.a <= 9 then 'basic' else 'extension' end as band,
  count(*) as attempts,
  (m.mastered_at is not null) as mastered,
  m.mastered_at
from fact_logs fl
left join mastery m on m.child_id = fl.child_id and m.problem_id = fl.problem_id
group by fl.child_id, fl.problem_id, fl.a, fl.b, fl.shape_type, m.mastered_at;

comment on view public.multiplication_mastery is
  '九九ファクト別の習熟状況(順方向/穴あき)。一度習得(5連続・閾値内正答)したら維持される。security_invokerのため基盤テーブルのRLSで保護される';

-- 匿名には見せない。認証済みの親のみ(内容は基盤RLSにより自分の子の分だけ)
revoke all on public.multiplication_mastery from anon;
grant select on public.multiplication_mastery to authenticated;
grant select on public.multiplication_mastery to service_role;
