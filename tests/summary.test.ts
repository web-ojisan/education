// 親向けサマリの集計ロジック(summary.ts)とチャートモデル(summary-charts.ts)の単体テスト。
// DBには接続しない。日付境界はAsia/Tokyo基準であることも確認する。
import { describe, expect, it } from 'vitest';
import {
  buildDailyActivity,
  buildMasteryCurve,
  buildSpeedTrend,
  buildWeakFacts,
  buildWeeklyHighlights,
  jstDateKey,
  type SummaryLogRow,
} from '../src/lib/summary';
import { buildBarChart, buildLineChart } from '../src/lib/summary-charts';

// JSTの2026-09-03 12:00
const TODAY = new Date('2026-09-03T03:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function log(
  daysAgo: number,
  durationSec: number,
  isCorrect = true,
  overrides: Partial<SummaryLogRow> = {},
): SummaryLogRow {
  const completed = new Date(TODAY.getTime() - daysAgo * DAY_MS);
  return {
    problem_id: 'p1',
    is_correct: isCorrect,
    started_at: new Date(completed.getTime() - durationSec * 1000).toISOString(),
    completed_at: completed.toISOString(),
    shape_type: 'multiplication_fact',
    params: { a: 7, b: 8 },
    ...overrides,
  };
}

describe('jstDateKey', () => {
  it('UTC深夜でも日本時間の日付になる(日付境界がJST基準)', () => {
    // UTC 2026-09-01 20:00 = JST 2026-09-02 05:00
    expect(jstDateKey('2026-09-01T20:00:00.000Z')).toBe('2026-09-02');
  });
});

describe('buildMasteryCurve', () => {
  it('累積カウントが単調増加し、窓より前の習得分も土台に含まれる', () => {
    const masteredAts = [
      new Date(TODAY.getTime() - 100 * DAY_MS).toISOString(), // 窓(56日)より前
      new Date(TODAY.getTime() - 10 * DAY_MS).toISOString(),
      new Date(TODAY.getTime() - 2 * DAY_MS).toISOString(),
    ];
    const curve = buildMasteryCurve(masteredAts, TODAY);
    expect(curve.length).toBe(56);
    expect(curve[0].value).toBe(1); // 窓の初日時点で1件習得済み
    expect(curve[curve.length - 1].value).toBe(3);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].value).toBeGreaterThanOrEqual(curve[i - 1].value);
    }
  });
});

describe('buildSpeedTrend', () => {
  it('正答のみを週別に平均し、誤答と30秒超(離席)は除外する', () => {
    const logs = [
      log(0, 2),
      log(1, 4),
      log(2, 10, false), // 誤答は除外
      log(3, 31), // 離席扱いで除外
      log(8, 6), // 1週前
    ];
    const trend = buildSpeedTrend(logs, TODAY);
    expect(trend.length).toBe(8);
    const thisWeek = trend[trend.length - 1];
    expect(thisWeek.label).toBe('今週');
    expect(thisWeek.avgSeconds).toBe(3); // (2+4)/2
    expect(trend[trend.length - 2].avgSeconds).toBe(6);
    expect(trend[0].avgSeconds).toBeNull(); // データのない週はnull
  });
});

describe('buildDailyActivity', () => {
  it('日別カウントと連続日数(ストリーク)を計算する', () => {
    const logs = [log(0, 2), log(0, 3), log(1, 2), log(2, 2), log(4, 2)];
    const activity = buildDailyActivity(logs, TODAY);
    expect(activity.days.length).toBe(28);
    expect(activity.days[activity.days.length - 1].count).toBe(2); // 今日2回
    expect(activity.streak).toBe(3); // 今日・昨日・一昨日(3日前が空きで途切れる)
  });

  it('今日まだ取り組みがない場合は昨日を起点にストリークを数える', () => {
    const logs = [log(1, 2), log(2, 2)];
    expect(buildDailyActivity(logs, TODAY).streak).toBe(2);
  });
});

describe('buildWeakFacts', () => {
  it('未習得・試行3回以上を「誤答×2+遅答」スコアでランキングする', () => {
    const logs = [
      // p-bad: 誤答2回+遅答1回(スコア5)
      log(0, 2, false, { problem_id: 'p-bad', params: { a: 7, b: 8 } }),
      log(0, 2, false, { problem_id: 'p-bad', params: { a: 7, b: 8 } }),
      log(0, 5, true, { problem_id: 'p-bad', params: { a: 7, b: 8 } }),
      // p-slow: 遅答2回(スコア2)
      log(0, 6, true, { problem_id: 'p-slow', params: { a: 6, b: 7 } }),
      log(0, 6, true, { problem_id: 'p-slow', params: { a: 6, b: 7 } }),
      log(0, 2, true, { problem_id: 'p-slow', params: { a: 6, b: 7 } }),
      // p-few: 誤答だが試行2回のみ → 対象外
      log(0, 2, false, { problem_id: 'p-few', params: { a: 3, b: 3 } }),
      log(0, 2, false, { problem_id: 'p-few', params: { a: 3, b: 3 } }),
      // p-mastered: 習得済み → 対象外
      log(0, 9, false, { problem_id: 'p-mastered', params: { a: 2, b: 2 } }),
      log(0, 9, false, { problem_id: 'p-mastered', params: { a: 2, b: 2 } }),
      log(0, 9, false, { problem_id: 'p-mastered', params: { a: 2, b: 2 } }),
    ];
    const weak = buildWeakFacts(logs, new Set(['p-mastered']));
    expect(weak.map((fact) => fact.label)).toEqual(['7 × 8', '6 × 7']);
    expect(weak[0].incorrectCount).toBe(2);
    expect(weak[0].avgSeconds).toBe(5);
  });

  it('拡張帯は遅答閾値5秒、穴あきはラベルが変わる', () => {
    const logs = [
      // 4秒回答は拡張帯(13の段)では遅答にならない → スコア0で対象外
      log(0, 4, true, { problem_id: 'p-ext', params: { a: 13, b: 7 } }),
      log(0, 4, true, { problem_id: 'p-ext', params: { a: 13, b: 7 } }),
      log(0, 4, true, { problem_id: 'p-ext', params: { a: 13, b: 7 } }),
      // 穴あきの誤答
      ...[1, 2, 3].map(() =>
        log(0, 2, false, {
          problem_id: 'p-missing',
          shape_type: 'multiplication_missing_factor',
          params: { a: 9, b: 8 },
        }),
      ),
    ];
    const weak = buildWeakFacts(logs, new Set());
    expect(weak.length).toBe(1);
    expect(weak[0].label).toBe('9 × □ = 72(あなあき)');
  });
});

describe('buildWeeklyHighlights', () => {
  it('今週(7日以内)の新規習得数と回答数を数える', () => {
    const masteredAts = [
      new Date(TODAY.getTime() - 2 * DAY_MS).toISOString(),
      new Date(TODAY.getTime() - 10 * DAY_MS).toISOString(),
    ];
    const logs = [log(0, 2), log(3, 2), log(9, 2)];
    const highlights = buildWeeklyHighlights(masteredAts, logs, TODAY);
    expect(highlights.masteredThisWeek).toBe(1);
    expect(highlights.answersThisWeek).toBe(2);
  });
});

describe('buildLineChart', () => {
  it('折れ線と面のパス・最新点マーカー・端ラベルを生成する', () => {
    const model = buildLineChart(
      [
        { label: '8/1', value: 1 },
        { label: '8/2', value: null }, // 欠測はスキップして繋ぐ
        { label: '8/3', value: 3 },
      ],
      'こ',
    );
    expect(model.hasData).toBe(true);
    expect(model.linePath.startsWith('M ')).toBe(true);
    expect(model.linePath.split('L').length).toBe(2); // 2点を1本で結ぶ
    expect(model.areaPath.endsWith('Z')).toBe(true);
    expect(model.lastValue?.text).toBe('3こ');
    expect(model.xLabels.map((l) => l.text)).toEqual(['8/1', '8/3']);
    expect(model.gridYs.length).toBe(3);
  });

  it('全点nullならhasData=false', () => {
    expect(buildLineChart([{ label: 'a', value: null }]).hasData).toBe(false);
  });
});

describe('buildBarChart', () => {
  it('値に応じた高さの棒を並べ、0の日は高さ0になる', () => {
    const model = buildBarChart([
      { label: '8/1', value: 2 },
      { label: '8/2', value: 0 },
      { label: '8/3', value: 5 },
    ]);
    expect(model.hasData).toBe(true);
    expect(model.bars.length).toBe(3);
    expect(model.bars[1].h).toBe(0);
    expect(model.bars[2].h).toBeGreaterThan(model.bars[0].h);
    // 最大値の棒がベースラインから描かれている
    expect(model.bars[2].y + model.bars[2].h).toBeCloseTo(model.baselineY, 1);
  });

  it('全て0ならhasData=false', () => {
    expect(buildBarChart([{ label: 'a', value: 0 }]).hasData).toBe(false);
  });
});
