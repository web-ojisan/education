// ドリル回答画面のReactアイランド。問題表示→回答→正誤とタイムスタンプの記録までを担当する。
import { useEffect, useMemo, useState } from 'react';
import { renderProblem, type ProblemRow } from '../lib/problem-templates';
import { createSupabaseBrowserClient } from '../lib/supabase';
import { drainAnswerLogQueue, enqueueAnswerLog, type QueuedAnswerLog } from '../lib/offline-queue';
// vite-plugin-pwaが提供する仮想モジュール。開発時(dev-sw.js)と本番(sw.js)でSWの
// 実際のURLが異なるため、直接navigator.serviceWorker.register('/sw.js')を呼ばずこちらを使う
import { useRegisterSW } from 'virtual:pwa-register/react';

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
  // テンキー入力方式(九九の拡張帯)での入力中の答え
  const [typed, setTyped] = useState('');
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString());
  // このセット(ページ表示〜完走)を1つにまとめるID。将来のゴーストレース再生用に記録する
  const [sessionId] = useState(() => crypto.randomUUID());
  // 送信結果の補足メッセージ(「あとで送信します」等)。RLS違反等の本当の異常系は
  // 今回のオフライン対応の対象外のため、送信失敗は一律オフラインキューへ回す
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  // サーバー側の初期描画時はnavigatorが無いのでオンライン扱いにしておき、
  // クライアントでのマウント後にuseEffectで実際の状態へ更新する
  const [isOffline, setIsOffline] = useState(false);

  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  // /drillだけをオフライン対応させたいので、Service Workerの登録もこの画面でのみ行う
  // (astro.config.mjsでinjectRegisterをoffにしているため、ここで明示的に登録する)
  useRegisterSW({ immediate: true });

  useEffect(() => {
    setIsOffline(!navigator.onLine);

    const sendAnswerLog = (entry: QueuedAnswerLog) =>
      supabase.from('answer_logs').insert(entry) as unknown as Promise<{ error: unknown }>;

    const handleOnline = () => {
      setIsOffline(false);
      drainAnswerLogQueue(sendAnswerLog).catch((error) => {
        console.error('オフライン中の回答ログ送信に失敗しました', error);
      });
    };
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    // マウント時点で既にオンラインならその場で溜まっている分を送っておく
    if (navigator.onLine) handleOnline();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const current = problems[index];
  const rendered = useMemo(() => {
    if (!current) return null;
    const row: ProblemRow = { id: current.id, shape_type: current.shapeType, params: current.params };
    return renderProblem(row);
  }, [current]);

  useEffect(() => {
    setStartedAt(new Date().toISOString());
    setSelected(null);
    setTyped('');
    setPhase('answering');
    setStatusMessage(null);
  }, [index]);

  // オフライン中は/childrenへ遷移してもページを描画できない(SSR専用画面のため)。
  // 子どもの切替は「昇級済みスキル帯の復習」等と違い今回のオフライン対応の対象外なので、
  // オフライン中はここで止めておく
  const childSwitchLink = (
    <p>
      <a
        href="/children"
        aria-disabled={isOffline}
        title={isOffline ? 'オフライン中は子どもを切り替えられません' : undefined}
        onClick={(event) => {
          if (isOffline) event.preventDefault();
        }}
      >
        ← 子どもを選びなおす
      </a>
    </p>
  );

  const offlineBanner = isOffline && (
    <div role="status">
      <p>オフラインです。回答はあとで自動的に送信されます。</p>
    </div>
  );

  if (!current || !rendered) {
    return (
      <div>
        {offlineBanner}
        {childSwitchLink}
        <p>{problems.length === 0 ? '問題が登録されていません。' : 'おつかれさま!今日のぶんは終わりです。'}</p>
      </div>
    );
  }

  const isCorrect = selected !== null && selected === rendered.correctAnswer;

  const handleSelect = async (choice: string) => {
    if (phase !== 'answering') return;
    const completedAt = new Date().toISOString();

    setSelected(choice);
    setPhase('result');
    setStatusMessage(null);

    const entry: QueuedAnswerLog = {
      child_id: childId,
      problem_id: current.id,
      is_correct: choice === rendered.correctAnswer,
      started_at: startedAt,
      completed_at: completedAt,
      context: 'drill',
      session_id: sessionId,
    };

    // オフライン中はそもそも送信を試みず、あとで送るためにキューへ積むだけにする
    if (isOffline) {
      await enqueueAnswerLog(entry);
      setStatusMessage('オフラインのため、記録はあとで自動的に送信されます。');
      return;
    }

    const { error } = await supabase.from('answer_logs').insert(entry);

    if (error) {
      // 通信エラー等で送れなかった場合も、あとで再送できるようにキューへ積んでおく
      await enqueueAnswerLog(entry);
      setStatusMessage('通信できなかったため、記録はあとで自動的に送信されます。');
    }
  };

  return (
    <div>
      {offlineBanner}
      {childSwitchLink}

      <p>
        {index + 1} / {problems.length} 問目・{current.title}
      </p>

      {/*
        rendered.svg は params(行数・列数・図形の種類など、DBの数値/enum値)から
        組み立てた文字列で、外部から受け取った自由入力は含まれないため安全に埋め込める
      */}
      <div dangerouslySetInnerHTML={{ __html: rendered.svg }} />

      {rendered.inputMode === 'keypad' ? (
        <div>
          <p aria-live="polite">こたえ: {typed === '' ? '?' : typed}</p>
          <div>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((digit) => (
              <button
                key={digit}
                type="button"
                disabled={phase !== 'answering'}
                // 答えの最大は 17×17=289 の3桁なので、それ以上は入力させない
                onClick={() => setTyped((t) => (t.length >= 3 ? t : t + digit))}
              >
                {digit}
              </button>
            ))}
            <button type="button" disabled={phase !== 'answering'} onClick={() => setTyped('')}>
              けす
            </button>
            <button
              type="button"
              disabled={phase !== 'answering' || typed === ''}
              // 先頭の0を正規化してから判定する(「056」→「56」)
              onClick={() => handleSelect(String(parseInt(typed, 10)))}
            >
              こたえる
            </button>
          </div>
        </div>
      ) : (
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
      )}

      {phase === 'result' && (
        <div role="status">
          <p>{isCorrect ? 'せいかい!' : 'ざんねん...'}</p>
          {statusMessage && <p>{statusMessage}</p>}
          <button type="button" onClick={() => setIndex((i) => i + 1)}>
            つぎへ
          </button>
        </div>
      )}
    </div>
  );
}
