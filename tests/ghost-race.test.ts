// ゴーストレースのセット組み立てロジック(buildGhostSessions)の単体テスト。DBには接続しない。
import { describe, expect, it } from 'vitest';
import { buildGhostSessions, type GhostLogRow } from '../src/lib/ghost-race';

const BASE_MS = Date.parse('2026-09-01T09:00:00.000Z');

// 「セット開始のoffsetSec秒後に開始し、durationSec秒かけて回答した」ログを作る
function log(
  sessionId: string,
  problemId: string,
  offsetSec: number,
  durationSec: number,
  overrides: Partial<GhostLogRow> = {},
): GhostLogRow {
  return {
    session_id: sessionId,
    child_id: 'child-1',
    problem_id: problemId,
    started_at: new Date(BASE_MS + offsetSec * 1000).toISOString(),
    completed_at: new Date(BASE_MS + (offsetSec + durationSec) * 1000).toISOString(),
    shape_type: 'multiplication_fact',
    params: { a: 2, b: 3 },
    ...overrides,
  };
}

describe('buildGhostSessions', () => {
  it('5問完走したセットだけが候補になり、完了順とオフセットが正しい', () => {
    const rows = [
      // わざと順不同で渡す
      log('s1', 'p3', 20, 2),
      log('s1', 'p1', 0, 3),
      log('s1', 'p5', 40, 2),
      log('s1', 'p2', 10, 2),
      log('s1', 'p4', 30, 4),
    ];
    const sessions = buildGhostSessions(rows);
    expect(sessions.length).toBe(1);
    const session = sessions[0];
    expect(session.sessionId).toBe('s1');
    expect(session.childId).toBe('child-1');
    expect(session.problems.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    // セット開始(最初のstarted_at=offset 0)からの完了オフセット
    expect(session.offsetsMs).toEqual([3000, 12000, 22000, 34000, 42000]);
    expect(session.startedAt).toBe(new Date(BASE_MS).toISOString());
  });

  it('5問未満のセット(途中離脱)は除外される', () => {
    const rows = [log('s1', 'p1', 0, 2), log('s1', 'p2', 10, 2), log('s1', 'p3', 20, 2)];
    expect(buildGhostSessions(rows)).toEqual([]);
  });

  it('リトライがあるセットは問題ごとに最後の試行を採用する(ゴーストレース走の記録)', () => {
    const rows = [
      log('s1', 'p1', 0, 2),
      // p2は1回誤答して解き直している → 2回目(offset 15〜17秒)を採用
      log('s1', 'p2', 10, 3),
      log('s1', 'p2', 15, 2),
      log('s1', 'p3', 20, 2),
      log('s1', 'p4', 30, 2),
      log('s1', 'p5', 40, 2),
    ];
    const sessions = buildGhostSessions(rows);
    expect(sessions.length).toBe(1);
    expect(sessions[0].problems.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(sessions[0].offsetsMs[1]).toBe(17000);
  });

  it('複数セットは新しい順に並ぶ', () => {
    const oldSet = [0, 1, 2, 3, 4].map((i) => log('s-old', `p${i}`, i * 10, 2));
    const newSet = [0, 1, 2, 3, 4].map((i) =>
      log('s-new', `p${i}`, i * 10, 2, {
        started_at: new Date(BASE_MS + 3600_000 + i * 10_000).toISOString(),
        completed_at: new Date(BASE_MS + 3600_000 + i * 10_000 + 2000).toISOString(),
      }),
    );
    const sessions = buildGhostSessions([...oldSet, ...newSet]);
    expect(sessions.map((s) => s.sessionId)).toEqual(['s-new', 's-old']);
  });
});
