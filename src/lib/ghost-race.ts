// ゴーストレース用の純粋ロジック。answer_logsの行から「レース可能なセット」を組み立てる。
// DBアクセスはせず、ページ側(ghost-race.astro)から使う。
//
// セットの定義:
// - 同じsession_idの回答ログを1セットとみなす。
// - ゴーストレース走にはリトライ(誤答→同じ問題を解き直し)が含まれるため、
//   問題ごとに「最後の試行」を採用する(通常ドリルは1問1試行なのでそのまま)。
// - ちょうど5問ぶん完了しているセットだけをゴースト候補にする(途中離脱は除外)。

export const GHOST_SET_SIZE = 5;

export type GhostLogRow = {
  session_id: string;
  child_id: string;
  problem_id: string;
  started_at: string;
  completed_at: string;
  shape_type: string;
  params: unknown;
};

export type GhostSession = {
  sessionId: string;
  childId: string;
  /** セット開始時刻(セット内で最初のstarted_at)。一覧の表示用 */
  startedAt: string;
  /** 完了順の出題列 */
  problems: { id: string; shapeType: string; params: unknown }[];
  /** セット開始からの各問完了オフセット(ミリ秒)。ゴースト再生用 */
  offsetsMs: number[];
};

/** 5問完走したセットだけをゴースト候補として組み立てる(新しい順) */
export function buildGhostSessions(rows: GhostLogRow[]): GhostSession[] {
  const bySession = new Map<string, GhostLogRow[]>();
  for (const row of rows) {
    const list = bySession.get(row.session_id) ?? [];
    list.push(row);
    bySession.set(row.session_id, list);
  }

  const sessions: GhostSession[] = [];
  for (const [sessionId, logs] of bySession) {
    // 問題ごとに最後の試行だけを残す(リトライの途中経過は完了時刻に含まれる形になる)
    const lastAttemptByProblem = new Map<string, GhostLogRow>();
    for (const log of logs) {
      const prev = lastAttemptByProblem.get(log.problem_id);
      if (!prev || Date.parse(log.completed_at) > Date.parse(prev.completed_at)) {
        lastAttemptByProblem.set(log.problem_id, log);
      }
    }

    if (lastAttemptByProblem.size !== GHOST_SET_SIZE) continue;

    const ordered = [...lastAttemptByProblem.values()].sort(
      (x, y) => Date.parse(x.completed_at) - Date.parse(y.completed_at),
    );
    // セット開始 = セット内の全試行で最初のstarted_at(1問目のリトライ前も含む)
    const raceStartMs = Math.min(...logs.map((log) => Date.parse(log.started_at)));

    sessions.push({
      sessionId,
      childId: ordered[0].child_id,
      startedAt: new Date(raceStartMs).toISOString(),
      problems: ordered.map((log) => ({ id: log.problem_id, shapeType: log.shape_type, params: log.params })),
      offsetsMs: ordered.map((log) => Date.parse(log.completed_at) - raceStartMs),
    });
  }

  // 新しい順
  return sessions.sort((x, y) => Date.parse(y.startedAt) - Date.parse(x.startedAt));
}
