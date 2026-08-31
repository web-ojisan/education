-- マイルストーン1用のシードデータ。
-- 問題の中身(どんなテンプレートを作るか)は今後PNG教材の解析等を踏まえて詰めるため、
-- ここでは「テンプレート+params→SVG生成」の配線を確認できる最小限のダミーテンプレートのみ用意する。
--
-- 各テンプレートの正解は、必ずparamsから導出する(正解を別カラムに保存しない)。
-- 実際の計算ロジックは src/lib/problem-templates.ts を参照。

insert into public.skills (id, code, name_ja, description_ja) values
  ('11111111-1111-1111-1111-111111111101', 'spatial_awareness', '空間認識', '図形の配置や向きを把握する力'),
  ('11111111-1111-1111-1111-111111111102', 'pattern_recognition', '規則性発見', '並びの規則を見つける力'),
  ('11111111-1111-1111-1111-111111111103', 'case_analysis', '場合分け', '条件ごとに場合を分けて考える力'),
  ('11111111-1111-1111-1111-111111111104', 'logical_reasoning', '論理推論', '根拠をもとに結論を導く力');

insert into public.problem_templates (id, code, shape_type, param_schema, title_ja, description_ja) values
  (
    '22222222-2222-2222-2222-222222222201',
    'count_grid_shapes',
    'count_grid_shapes',
    '{"shape": "circle | triangle | square", "rows": "number", "cols": "number", "missing": "[row, col][] (欠けているマス)"}',
    '形はいくつある?',
    '格子状に並んだ図形の数を数える問題'
  ),
  (
    '22222222-2222-2222-2222-222222222202',
    'sequence_next_shape',
    'sequence_next_shape',
    '{"unit": "string[] (繰り返しの1単位)", "visibleCount": "number (見えている図形の数)"}',
    '次にくる形はどれ?',
    '繰り返しの規則から次の図形を当てる問題'
  );

insert into public.template_skills (template_id, skill_id) values
  ('22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111101'), -- count_grid_shapes: 空間認識
  ('22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111104'), -- count_grid_shapes: 論理推論
  ('22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111102'), -- sequence_next_shape: 規則性発見
  ('22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111104'); -- sequence_next_shape: 論理推論

-- P1: count_grid_shapesのbase問題(2行3列、欠けなし → 正解6)
insert into public.problems (id, template_id, params, base_problem_id, variation_distance, grade_min, grade_max) values
  (
    '33333333-3333-3333-3333-333333333301',
    '22222222-2222-2222-2222-222222222201',
    '{"shape": "triangle", "rows": 2, "cols": 3, "missing": []}',
    null,
    0,
    1,
    3
  );

-- P2: P1の変形(数値差し替え = variation_distance 1)。3行3列、1マス欠け → 正解8
insert into public.problems (id, template_id, params, base_problem_id, variation_distance, grade_min, grade_max) values
  (
    '33333333-3333-3333-3333-333333333302',
    '22222222-2222-2222-2222-222222222201',
    '{"shape": "triangle", "rows": 3, "cols": 3, "missing": [[0, 0]]}',
    '33333333-3333-3333-3333-333333333301',
    1,
    1,
    3
  );

-- P3: sequence_next_shapeのbase問題(circle→triangle→squareの繰り返し、5個表示 → 次はsquare)
insert into public.problems (id, template_id, params, base_problem_id, variation_distance, grade_min, grade_max) values
  (
    '33333333-3333-3333-3333-333333333303',
    '22222222-2222-2222-2222-222222222202',
    '{"unit": ["circle", "triangle", "square"], "visibleCount": 5}',
    null,
    0,
    1,
    3
  );
