-- マイルストーン1: スキーマ初版
-- parents / children / skills / problem_templates / problems / answer_logs と
-- 各テーブルのRLSポリシーを定義する。
--
-- 設計メモ:
-- - 子どもは直接認証しない。すべてのアクセスは親のセッション(auth.uid() = 親のid)で行い、
--   「今どの子として操作しているか」はアプリ層(Cookie等)で管理する。
--   RLSは「親の境界」だけを守る(親Bが親A配下のデータへ触れないこと)。
-- - SVGはテンプレート+paramsから都度生成するため、SVG文字列そのものは保存しない。
-- - 将来のゴーストレース/レーティング/ランキング/定期テスト大会は実装しないが、
--   answer_logsのcontext/session_id、childrenのgradeなど、必要なカラムだけ先に用意する。

create extension if not exists "pgcrypto";

-- ============================================================
-- parents: 親アカウント。auth.users と1:1で、idを一致させる
-- ============================================================
create table public.parents (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

comment on table public.parents is '親アカウント。Google認証したauth.usersに対応する行を持つ';

-- Googleログイン(auth.usersへのINSERT)時に自動でparents行を作成する
create function public.handle_new_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.parents (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_parent();

-- ============================================================
-- children: 親配下の子プロフィール。子は直接認証しない
-- ============================================================
create table public.children (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.parents (id) on delete cascade,
  name text not null,
  -- 学年。低学年(1-3)向けサービスだが、将来の高学年・中学生向け拡張のため広めに許容する
  grade smallint not null check (grade between 1 and 9),
  created_at timestamptz not null default now()
);

comment on table public.children is '親配下の子プロフィール。直接認証は行わず、常に親のセッションで操作する';

create index children_parent_id_idx on public.children (parent_id);

-- ============================================================
-- skills: 思考スキルタグのマスタ(空間認識/規則性発見/場合分け/論理推論 など)
-- ============================================================
create table public.skills (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ja text not null,
  description_ja text
);

comment on table public.skills is '思考スキルタグのマスタデータ';

-- ============================================================
-- problem_templates: 問題テンプレート。SVGはparamsから都度生成するため保存しない
-- ============================================================
create table public.problem_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  -- src/lib/problem-templates.ts の生成関数を選ぶためのキー
  shape_type text not null,
  -- 期待するparamsの形をドキュメントするためのメモ(実行時バリデーションはしない)
  param_schema jsonb not null default '{}'::jsonb,
  title_ja text not null,
  description_ja text,
  created_at timestamptz not null default now()
);

comment on table public.problem_templates is '問題テンプレートのマスタデータ';

-- テンプレートとスキルタグの中間テーブル(1テンプレートが複数スキルタグを持てる)
create table public.template_skills (
  template_id uuid not null references public.problem_templates (id) on delete cascade,
  skill_id uuid not null references public.skills (id) on delete cascade,
  primary key (template_id, skill_id)
);

comment on table public.template_skills is 'problem_templatesとskillsの多対多中間テーブル';

-- ============================================================
-- problems: テンプレートを具体的なパラメータで実体化した個々の問題
-- ============================================================
create table public.problems (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.problem_templates (id) on delete cascade,
  params jsonb not null,
  -- 変形元の問題への自己参照。0=自分自身がbase、1〜3はbase_problem_idが変形元を指す
  base_problem_id uuid references public.problems (id) on delete set null,
  -- 変形距離: 0=同一問題 / 1=数値差し替え / 2=図形の向き・比率変更 / 3=同スキル別テンプレート
  variation_distance smallint not null default 0 check (variation_distance between 0 and 3),
  grade_min smallint not null default 1,
  grade_max smallint not null default 9,
  created_at timestamptz not null default now(),
  constraint problems_base_not_self check (base_problem_id is null or base_problem_id <> id),
  constraint problems_grade_range check (grade_min <= grade_max)
);

comment on table public.problems is 'テンプレート+具体パラメータで実体化した問題。SVGはparamsから都度生成する';

create index problems_template_id_idx on public.problems (template_id);
create index problems_base_problem_id_idx on public.problems (base_problem_id);

-- ============================================================
-- answer_logs: 子どもの回答記録(正誤・開始/完了タイムスタンプ)
-- ============================================================
create table public.answer_logs (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children (id) on delete cascade,
  problem_id uuid not null references public.problems (id) on delete cascade,
  is_correct boolean not null,
  -- ゴーストレースでの再生・所要時間算出のため、開始/完了の両方を持つ
  started_at timestamptz not null,
  completed_at timestamptz not null,
  -- 'drill'(通常のドリル)/'ghost_race'(復習用ゴーストレース)/'exam'(将来の定期テスト大会)
  context text not null default 'drill' check (context in ('drill', 'ghost_race', 'exam')),
  -- 5問1セット等のグルーピング用。将来のゴーストレース/大会で使用(現時点では未使用でよい)
  session_id uuid,
  created_at timestamptz not null default now(),
  constraint answer_logs_timing check (completed_at >= started_at)
);

comment on table public.answer_logs is '子どもの回答ログ。順位や時間を子どもに見せるかは表示層のポリシーとし、ここでは焼き込まない';

create index answer_logs_child_id_idx on public.answer_logs (child_id);
create index answer_logs_problem_id_idx on public.answer_logs (problem_id);
create index answer_logs_session_id_idx on public.answer_logs (session_id);

-- ============================================================
-- RLS有効化
-- ============================================================
alter table public.parents enable row level security;
alter table public.children enable row level security;
alter table public.skills enable row level security;
alter table public.problem_templates enable row level security;
alter table public.template_skills enable row level security;
alter table public.problems enable row level security;
alter table public.answer_logs enable row level security;

-- parents: 自分の行のみ参照・更新可能
create policy "parents_select_own" on public.parents
  for select using (id = auth.uid());

create policy "parents_insert_own" on public.parents
  for insert with check (id = auth.uid());

create policy "parents_update_own" on public.parents
  for update using (id = auth.uid());

-- children: 親は自分の子のみCRUD可能。他の親の子は一切見えない
create policy "children_select_own" on public.children
  for select using (parent_id = auth.uid());

create policy "children_insert_own" on public.children
  for insert with check (parent_id = auth.uid());

create policy "children_update_own" on public.children
  for update using (parent_id = auth.uid());

create policy "children_delete_own" on public.children
  for delete using (parent_id = auth.uid());

-- skills / problem_templates / template_skills / problems: マスタデータ。
-- ログイン済みの親であれば全員が参照できる(子ごとの出し分けはアプリ層で行う)
create policy "skills_select_authenticated" on public.skills
  for select using (auth.role() = 'authenticated');

create policy "problem_templates_select_authenticated" on public.problem_templates
  for select using (auth.role() = 'authenticated');

create policy "template_skills_select_authenticated" on public.template_skills
  for select using (auth.role() = 'authenticated');

create policy "problems_select_authenticated" on public.problems
  for select using (auth.role() = 'authenticated');

-- answer_logs: 親は自分の子に紐づく回答ログのみ参照・作成可能。
-- 更新・削除ポリシーは用意しない(記録の改ざん防止のため、意図的にできないようにする)
create policy "answer_logs_select_own_children" on public.answer_logs
  for select using (
    exists (
      select 1 from public.children
      where children.id = answer_logs.child_id
        and children.parent_id = auth.uid()
    )
  );

create policy "answer_logs_insert_own_children" on public.answer_logs
  for insert with check (
    exists (
      select 1 from public.children
      where children.id = answer_logs.child_id
        and children.parent_id = auth.uid()
    )
  );
