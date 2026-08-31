// ドリル回答画面のReactアイランド。問題表示→回答→正誤とタイムスタンプの記録までを担当する。
import { useEffect, useMemo, useState } from 'react';
import { renderProblem, type ProblemRow } from '../lib/problem-templates';
import { createSupabaseBrowserClient } from '../lib/supabase';

type DrillProblem = {
  id: string;
  shapeType: string;
  title: string;
  params: unknown;
};

type Props = {
  childId: string;
  problems: DrillProblem[];
};

type Phase = 'answering' | 'result';

// 選択肢の表示ラベル(内部の値はproblem-templates.tsの enum のまま。表示のための対応表)
const SHAPE_LABELS: Record<string, string> = {
  circle: 'まる',
  triangle: 'さんかく',
  square: 'しかく',
};

function displayLabel(choice: string): string {
  return SHAPE_LABELS[choice] ?? choice;
}

export default function DrillIsland({ childId, problems }: Props) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('answering');
  const [selected, setSelected] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const current = problems[index];
  const rendered = useMemo(() => {
    if (!current) return null;
    const row: ProblemRow = { id: current.id, shape_type: current.shapeType, params: current.params };
    return renderProblem(row);
  }, [current]);

  useEffect(() => {
    setStartedAt(new Date().toISOString());
    setSelected(null);
    setPhase('answering');
    setErrorMessage(null);
  }, [index]);

  if (!current || !rendered) {
    return <p>{problems.length === 0 ? '問題が登録されていません。' : 'おつかれさま!今日のぶんは終わりです。'}</p>;
  }

  const isCorrect = selected !== null && selected === rendered.correctAnswer;

  const handleSelect = async (choice: string) => {
    if (phase !== 'answering') return;
    const completedAt = new Date().toISOString();

    setSelected(choice);
    setPhase('result');

    const { error } = await supabase.from('answer_logs').insert({
      child_id: childId,
      problem_id: current.id,
      is_correct: choice === rendered.correctAnswer,
      started_at: startedAt,
      completed_at: completedAt,
      context: 'drill',
    });

    if (error) {
      setErrorMessage(`記録に失敗しました: ${error.message}`);
    }
  };

  return (
    <div>
      <p>
        {index + 1} / {problems.length} 問目・{current.title}
      </p>

      {/*
        rendered.svg は params(行数・列数・図形の種類など、DBの数値/enum値)から
        組み立てた文字列で、外部から受け取った自由入力は含まれないため安全に埋め込める
      */}
      <div dangerouslySetInnerHTML={{ __html: rendered.svg }} />

      <div>
        {rendered.choices.map((choice) => (
          <button
            key={choice}
            type="button"
            onClick={() => handleSelect(choice)}
            disabled={phase !== 'answering'}
            aria-pressed={selected === choice}
          >
            {displayLabel(choice)}
          </button>
        ))}
      </div>

      {phase === 'result' && (
        <div role="status">
          <p>{isCorrect ? 'せいかい!' : 'ざんねん...'}</p>
          {errorMessage && <p role="alert">{errorMessage}</p>}
          <button type="button" onClick={() => setIndex((i) => i + 1)}>
            つぎへ
          </button>
        </div>
      )}
    </div>
  );
}
