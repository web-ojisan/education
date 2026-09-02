// 親向け学習サマリの集計ロジック。DBアクセスはせず、summary.astroから使う。
// 「回答時間を子どもに見せない」は低学年向けの表示ポリシーなので、
// 親向けのここでは回答時間を積極的に集計・表示する。
// 日付の区切りはすべて Asia/Tokyo 基準で行う。

const DAY_MS = 24 * 60 * 60 * 1000;
// これを超える回答は離席とみなし、スピード集計から除外する
const AWAY_SECONDS = 30;

export type SummaryLogRow = {
  problem_id: string;
  is_correct: boolean;
  started_at: string;
  completed_at: string;
  shape_type: string;
  params: unknown;
};

export type SummaryMasteryRow = {
  problem_id: string;
  mastered: boolean;
  mastered_at: string | null;
};

/** Asia/Tokyo基準の YYYY-MM-DD キー(文字列比較で日付順になる) */
export function jstDateKey(value: string | Date): string {
  return new Date(value).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

function durationSeconds(log: SummaryLogRow): number {
  return (Date.parse(log.completed_at) - Date.parse(log.started_at)) / 1000;
}

function factParams(log: SummaryLogRow): { a: number; b: number } {
  return log.params as { a: number; b: number };
}

// ============================================================
// ① 習得数の成長曲線
// ============================================================

export type CurvePoint = { date: string; value: number };

/** 直近days日間の「マスター済み九九の累積数」を日次で返す(窓より前の習得分も土台に含む) */
export function buildMasteryCurve(masteredAts: string[], today: Date, days = 56): CurvePoint[] {
  const masteredKeys = masteredAts.map(jstDateKey).sort();
  const points: CurvePoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayKey = jstDateKey(new Date(today.getTime() - i * DAY_MS));
    points.push({ date: dayKey, value: masteredKeys.filter((key) => key <= dayKey).length });
  }
  return points;
}

// ============================================================
// ② 回答スピードの推移
// ============================================================

export type SpeedPoint = { label: string; avgSeconds: number | null };

/** 直近weeks週の週別平均回答時間(正答のみ、離席とみなす30秒超は除外)。古い週→今週の順 */
export function buildSpeedTrend(logs: SummaryLogRow[], today: Date, weeks = 8): SpeedPoint[] {
  const sums = Array.from({ length: weeks }, () => ({ total: 0, count: 0 }));
  for (const log of logs) {
    if (!log.is_correct) continue;
    const seconds = durationSeconds(log);
    if (seconds <= 0 || seconds > AWAY_SECONDS) continue;
    const daysAgo = Math.floor((today.getTime() - Date.parse(log.completed_at)) / DAY_MS);
    if (daysAgo < 0) continue;
    const weekIndex = Math.floor(daysAgo / 7);
    if (weekIndex >= weeks) continue;
    sums[weekIndex].total += seconds;
    sums[weekIndex].count += 1;
  }
  const points: SpeedPoint[] = [];
  for (let weekIndex = weeks - 1; weekIndex >= 0; weekIndex--) {
    const { total, count } = sums[weekIndex];
    points.push({
      label: weekIndex === 0 ? '今週' : `${weekIndex}週前`,
      avgSeconds: count === 0 ? null : Math.round((total / count) * 10) / 10,
    });
  }
  return points;
}

// ============================================================
// ③ 日々の取り組み量
// ============================================================

export type DailyActivity = {
  days: { date: string; count: number }[];
  /** 今日(取り組みがまだなければ昨日)から連続で取り組んだ日数 */
  streak: number;
};

export function buildDailyActivity(logs: SummaryLogRow[], today: Date, days = 28): DailyActivity {
  const countByKey = new Map<string, number>();
  for (const log of logs) {
    const key = jstDateKey(log.completed_at);
    countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
  }

  const dayList: { date: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = jstDateKey(new Date(today.getTime() - i * DAY_MS));
    dayList.push({ date: key, count: countByKey.get(key) ?? 0 });
  }

  // ストリーク: 今日から遡って連続日数を数える。今日まだ取り組みがなければ昨日を起点にする
  let streak = 0;
  let offset = countByKey.has(jstDateKey(today)) ? 0 : 1;
  for (;;) {
    const key = jstDateKey(new Date(today.getTime() - offset * DAY_MS));
    if (!countByKey.has(key)) break;
    streak += 1;
    offset += 1;
  }

  return { days: dayList, streak };
}

// ============================================================
// ④ つまずきポイント
// ============================================================

export type WeakFact = {
  label: string;
  attempts: number;
  incorrectCount: number;
  avgSeconds: number | null;
};

/**
 * 未習得ファクトのうち試行3回以上のものを「誤答数×2+遅答数」でスコア化し、ワーストlimit件を返す。
 * 遅答の閾値は習熟判定と同じ(基礎帯3秒/拡張帯5秒)
 */
export function buildWeakFacts(
  logs: SummaryLogRow[],
  masteredProblemIds: Set<string>,
  limit = 5,
): WeakFact[] {
  type Bucket = {
    sample: SummaryLogRow;
    attempts: number;
    incorrectCount: number;
    slowCount: number;
    correctTotalSeconds: number;
    correctCount: number;
  };
  const byProblem = new Map<string, Bucket>();

  for (const log of logs) {
    if (masteredProblemIds.has(log.problem_id)) continue;
    const bucket =
      byProblem.get(log.problem_id) ??
      ({ sample: log, attempts: 0, incorrectCount: 0, slowCount: 0, correctTotalSeconds: 0, correctCount: 0 } as Bucket);
    bucket.attempts += 1;
    const seconds = durationSeconds(log);
    const { a } = factParams(log);
    const threshold = a <= 9 ? 3 : 5;
    if (!log.is_correct) {
      bucket.incorrectCount += 1;
    } else {
      if (seconds > threshold) bucket.slowCount += 1;
      if (seconds > 0 && seconds <= AWAY_SECONDS) {
        bucket.correctTotalSeconds += seconds;
        bucket.correctCount += 1;
      }
    }
    byProblem.set(log.problem_id, bucket);
  }

  return [...byProblem.values()]
    .map((bucket) => ({ bucket, score: bucket.incorrectCount * 2 + bucket.slowCount }))
    .filter(({ bucket, score }) => bucket.attempts >= 3 && score > 0)
    .sort((x, y) => y.score - x.score || y.bucket.attempts - x.bucket.attempts)
    .slice(0, limit)
    .map(({ bucket }) => {
      const { a, b } = factParams(bucket.sample);
      const label =
        bucket.sample.shape_type === 'multiplication_missing_factor'
          ? `${a} × □ = ${a * b}(あなあき)`
          : `${a} × ${b}`;
      return {
        label,
        attempts: bucket.attempts,
        incorrectCount: bucket.incorrectCount,
        avgSeconds:
          bucket.correctCount === 0
            ? null
            : Math.round((bucket.correctTotalSeconds / bucket.correctCount) * 10) / 10,
      };
    });
}

// ============================================================
// 「今週のひとこと」用のハイライト数値
// ============================================================

export type WeeklyHighlights = {
  masteredThisWeek: number;
  answersThisWeek: number;
};

export function buildWeeklyHighlights(
  masteredAts: string[],
  logs: SummaryLogRow[],
  today: Date,
): WeeklyHighlights {
  const weekAgoMs = today.getTime() - 7 * DAY_MS;
  return {
    masteredThisWeek: masteredAts.filter((at) => Date.parse(at) > weekAgoMs).length,
    answersThisWeek: logs.filter((log) => Date.parse(log.completed_at) > weekAgoMs).length,
  };
}
