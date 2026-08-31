// 問題テンプレートごとのSVG生成ロジック。
// 重要: 正解は必ずparamsから導出する。正解を別カラムに保存して食い違う、という事態を
// 構造的に起こさないための設計(数値と図が必ず整合する)。
// 問題の中身(どんなテンプレートを揃えるか)は今後PNG教材の解析等を踏まえて詰めるため、
// ここではDB構造の配線を確認するための最小限のテンプレートのみ実装している。

export type ShapeKind = 'circle' | 'triangle' | 'square';

export type CountGridShapesParams = {
  shape: ShapeKind;
  rows: number;
  cols: number;
  /** 欠けているマス([行, 列]の配列) */
  missing: [number, number][];
};

export type SequenceNextShapeParams = {
  /** 繰り返しの1単位 */
  unit: ShapeKind[];
  /** 見えている図形の数 */
  visibleCount: number;
};

export type RenderedProblem = {
  svg: string;
  /** 表示用の正解(選択肢と比較するための文字列表現) */
  correctAnswer: string;
  /** 選択肢(表示用の文字列表現)。correctAnswerを必ず含む */
  choices: string[];
};

const CELL = 48;
const PADDING = 8;
const FILL = '#2563eb';

function shapeMarkup(kind: ShapeKind, cx: number, cy: number, size: number): string {
  const r = size / 2;
  switch (kind) {
    case 'circle':
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${FILL}" />`;
    case 'square':
      return `<rect x="${cx - r}" y="${cy - r}" width="${size}" height="${size}" fill="${FILL}" />`;
    case 'triangle':
      return `<polygon points="${cx},${cy - r} ${cx - r},${cy + r} ${cx + r},${cy + r}" fill="${FILL}" />`;
  }
}

/** 正解を含む数値の選択肢を作る(正解が常に同じ位置に来ないよう決定的に回転させる) */
function buildNumberChoices(correct: number): number[] {
  const candidates = Array.from(new Set([correct, Math.max(0, correct - 1), correct + 1, correct + 2]));
  const rotate = correct % candidates.length;
  return [...candidates.slice(rotate), ...candidates.slice(0, rotate)];
}

export function renderCountGridShapes(params: CountGridShapesParams): RenderedProblem {
  const { shape, rows, cols, missing } = params;
  const missingSet = new Set(missing.map(([r, c]) => `${r}:${c}`));

  const shapes: string[] = [];
  let count = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (missingSet.has(`${r}:${c}`)) continue;
      count++;
      const cx = PADDING + c * CELL + CELL / 2;
      const cy = PADDING + r * CELL + CELL / 2;
      shapes.push(shapeMarkup(shape, cx, cy, CELL * 0.7));
    }
  }

  const width = cols * CELL + PADDING * 2;
  const height = rows * CELL + PADDING * 2;
  const svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${shapes.join('')}</svg>`;

  return {
    svg,
    correctAnswer: String(count),
    choices: buildNumberChoices(count).map(String),
  };
}

export function renderSequenceNextShape(params: SequenceNextShapeParams): RenderedProblem {
  const { unit, visibleCount } = params;
  const sequence: ShapeKind[] = Array.from({ length: visibleCount }, (_, i) => unit[i % unit.length]);
  const correctAnswer = unit[visibleCount % unit.length];

  const shapes = sequence.map((kind, i) =>
    shapeMarkup(kind, PADDING + i * CELL + CELL / 2, PADDING + CELL / 2, CELL * 0.7),
  );
  const width = sequence.length * CELL + PADDING * 2;
  const height = CELL + PADDING * 2;
  const svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${shapes.join('')}</svg>`;

  // ShapeKindは3種類のみなので、常に正解を含む固定の選択肢になる
  const choices: ShapeKind[] = ['circle', 'triangle', 'square'];

  return {
    svg,
    correctAnswer,
    choices,
  };
}

export type ProblemRow = {
  id: string;
  shape_type: string;
  params: unknown;
};

export function renderProblem(row: ProblemRow): RenderedProblem {
  switch (row.shape_type) {
    case 'count_grid_shapes':
      return renderCountGridShapes(row.params as CountGridShapesParams);
    case 'sequence_next_shape':
      return renderSequenceNextShape(row.params as SequenceNextShapeParams);
    default:
      throw new Error(`未知のshape_typeです: ${row.shape_type}`);
  }
}
