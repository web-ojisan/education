-- 九九(かけ算)暗記ドリル: ファクト別習熟ビューとインデックス
--
-- 設計メモ:
-- - 習熟の定義: 同一ファクト(problems 1行 = a×b)で「5連続正答・各閾値秒以内」を
--   過去に一度でも達成したら習得済み。以後は成績が落ちても維持する(昇級のみで降級なしの方針)。
-- - 即答閾値: 基礎帯(a<=9、4択回答)は3秒 / 拡張帯(a>=11、テンキー入力)は5秒(入力時間込み)。
--   閾値は設定値にせずビュー定義内の定数とする。変更はマイグレーションで行う。
-- - マテリアライズドビューにしない理由: 習得した瞬間に九九表へ反映したい(リフレッシュ遅延が
--   体験を壊す)うえ、子ども1人あたりのログ件数に対する集計で十分軽い。
--   マテビュー+pg_cronの方針はランキング等の重い横断集計向けとする。
-- - security_invoker = on のため、answer_logs / children 等の既存RLSが呼び出し元の権限で
--   そのまま効く(親は自分の子の行しか見えない)。ビュー自体はRLSを持てないが、
--   基盤テーブルのポリシーで守られる。攻撃テストは tests/multiplication-mastery.test.ts を参照。

create view public.multiplication_mastery
with (security_invoker = on)
as
with fact_logs as (
  select
    al.child_id,
    al.problem_id,
    (p.params ->> 'a')::int as a,
    (p.params ->> 'b')::int as b,
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
  where pt.shape_type = 'multiplication_fact'
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
  case when fl.a <= 9 then 'basic' else 'extension' end as band,
  count(*) as attempts,
  (m.mastered_at is not null) as mastered,
  m.mastered_at
from fact_logs fl
left join mastery m on m.child_id = fl.child_id and m.problem_id = fl.problem_id
group by fl.child_id, fl.problem_id, fl.a, fl.b, m.mastered_at;

comment on view public.multiplication_mastery is
  '九九ファクト別の習熟状況。一度習得(5連続・閾値内正答)したら維持される。security_invokerのため基盤テーブルのRLSで保護される';

-- 匿名には見せない。認証済みの親のみ(内容は基盤RLSにより自分の子の分だけ)
revoke all on public.multiplication_mastery from anon;
grant select on public.multiplication_mastery to authenticated;
grant select on public.multiplication_mastery to service_role;

-- ストリーク計算(child_id, problem_idごとの時系列走査)用の複合インデックス
create index answer_logs_child_problem_completed_idx
  on public.answer_logs (child_id, problem_id, completed_at);
