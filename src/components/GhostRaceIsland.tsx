// ゴーストレースのReactアイランド。過去の回答記録(完了タイムスタンプ列)をゴーストとして
// 再生し、5問1セットで並走レースする。
// - 誤答したら同じ問題を解き直す(正解するまで進めない)。全試行を answer_logs に記録する。
// - 秒数・タイムは一切数値表示しない(低学年向け表示ポリシー)。見せるのはレーンの進捗と先着のみ。
import { useEffect, useMemo, useRef, useState } from 'react';
import { renderProblem, type ProblemRow } from '../lib/problem-templates';
import { createSupabaseBrowserClient } from '../lib/supabase';
import { enqueueAnswerLog, type QueuedAnswerLog } from '../lib/offline-queue';
import { GHOST_SET_SIZE } from '../lib/ghost-race';

type RaceProblem = {
  id: string;
  shapeType: string;
  params: unknown;
};

type Props = {
  childId: string;
  ghostName: string;
  problems: RaceProblem[];
  ghostOffsetsMs: number[];
};

type Phase = 'ready' | 'racing' | 'finished';

export default function GhostRaceIsland({ childId, ghostName, problems, ghostOffsetsMs }: Props) {
  const [phase, setPhase] = useState<Phase>('ready');
  const [elapsedMs, setElapsedMs] = useState(0);
  // 自分が正解済みの問題数(=レーンの進み)
  const [myIndex, setMyIndex] = useState(0);
  const [myFinishMs, setMyFinishMs] = useState<number | null>(null);
  const [typed, setTyped] = useState('');
  const [missMessage, setMissMessage] = useState<string | null>(null);
  // このレース1回分の回答をまとめるsession_id(次のレースのゴースト候補にもなる)
  const [raceSessionId] = useState(() => crypto.randomUUID());
  const raceStartMsRef = useRef(0);
  const questionStartedAtRef = useRef('');

  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  useEffect(() => {
    if (phase !== 'racing') return;
    const id = setInterval(() => setElapsedMs(Date.now() - raceStartMsRef.current), 200);
    return () => clearInterval(id);
  }, [phase]);

  const current = myIndex < problems.length ? problems[myIndex] : null;
  const rendered = useMemo(() => {
    if (!current) return null;
    const row: ProblemRow = { id: current.id, shape_type: current.shapeType, params: current.params };
    return renderProblem(row);
  }, [current]);

  // ゴーストの進み: 経過時間が各問の完了オフセットを超えた数
  const ghostFinishMs = ghostOffsetsMs[ghostOffsetsMs.length - 1];
  const ghostIndex = Math.min(
    ghostOffsetsMs.filter((offset) => offset <= (phase === 'finished' ? (myFinishMs ?? elapsedMs) : elapsedMs)).length,
    GHOST_SET_SIZE,
  );

  const handleStart = () => {
    raceStartMsRef.current = Date.now();
    questionStartedAtRef.current = new Date().toISOString();
    setElapsedMs(0);
    setPhase('racing');
  };

  const handleAnswer = async (choice: string) => {
    if (phase !== 'racing' || !current || !rendered) return;
    const completedAt = new Date().toISOString();
    const isCorrect = choice === rendered.correctAnswer;

    const entry: QueuedAnswerLog = {
      child_id: childId,
      problem_id: current.id,
      is_correct: isCorrect,
      started_at: questionStartedAtRef.current,
      completed_at: completedAt,
      context: 'ghost_race',
      session_id: raceSessionId,
    };

    // 次の試行(正解なら次の問題、誤答なら解き直し)の開始時刻
    questionStartedAtRef.current = new Date().toISOString();
    setTyped('');

    if (isCorrect) {
      setMissMessage(null);
      const nextIndex = myIndex + 1;
      setMyIndex(nextIndex);
      if (nextIndex >= problems.length) {
        setMyFinishMs(Date.now() - raceStartMsRef.current);
        setPhase('finished');
      }
    } else {
      // 正解するまで同じ問題を解き直す(連打でゴールできないようにする)
      setMissMessage('ざんねん!もういちど!');
    }

    const { error } = await supabase.from('answer_logs').insert(entry);
    if (error) {
      // 通信エラー等で送れなかった場合も、あとで再送できるようにキューへ積んでおく
      await enqueueAnswerLog(entry);
    }
  };

  const lane = (label: string, progress: number) => (
    <p>
      {label}: {Array.from({ length: GHOST_SET_SIZE }, (_, i) => (i < progress ? '●' : '○')).join(' ')}
      {progress >= GHOST_SET_SIZE && ' 🏁'}
    </p>
  );

  // 勝敗はゴール先着のみで見せる(秒数は表示しない)
  const resultMessage =
    myFinishMs === null
      ? null
      : myFinishMs < ghostFinishMs
        ? `${ghostName}のゴーストにかった!`
        : myFinishMs > ghostFinishMs
          ? `${ghostName}のゴーストにまけた…もういちど!`
          : `${ghostName}のゴーストとひきわけ!`;

  return (
    <div>
      <div role="status">
        {lane('じぶん', myIndex)}
        {lane(ghostName, ghostIndex)}
      </div>

      {phase === 'ready' && (
        <div>
          <p>{ghostName}のゴーストと5問しょうぶ!じゅんびはいい?</p>
          <button type="button" onClick={handleStart}>
            スタート!
          </button>
        </div>
      )}

      {phase === 'racing' && current && rendered && (
        <div>
          <p>{myIndex + 1}問目</p>
          {/*
            rendered.svg は params(DBの数値)から組み立てた文字列で、
            外部から受け取った自由入力は含まれないため安全に埋め込める
          */}
          <div dangerouslySetInnerHTML={{ __html: rendered.svg }} />
          {missMessage && <p role="status">{missMessage}</p>}

          {rendered.inputMode === 'keypad' ? (
            <div>
              <p aria-live="polite">こたえ: {typed === '' ? '?' : typed}</p>
              <div>
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((digit) => (
                  <button
                    key={digit}
                    type="button"
                    // 答えの最大は 17×17=289 の3桁なので、それ以上は入力させない
                    onClick={() => setTyped((t) => (t.length >= 3 ? t : t + digit))}
                  >
                    {digit}
                  </button>
                ))}
                <button type="button" onClick={() => setTyped('')}>
                  けす
                </button>
                <button
                  type="button"
                  disabled={typed === ''}
                  // 先頭の0を正規化してから判定する(「056」→「56」)
                  onClick={() => handleAnswer(String(parseInt(typed, 10)))}
                >
                  こたえる
                </button>
              </div>
            </div>
          ) : (
            <div>
              {rendered.choices.map((choice) => (
                <button key={choice} type="button" onClick={() => handleAnswer(choice)}>
                  {choice}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {phase === 'finished' && (
        <div role="status">
          <p>{resultMessage}</p>
          <button type="button" onClick={() => window.location.reload()}>
            もういちどレースする
          </button>
          <p>
            <a href="/ghost-race">ほかのゴーストをえらぶ</a>
          </p>
        </div>
      )}
    </div>
  );
}
