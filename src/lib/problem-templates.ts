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

export type MultiplicationFactParams = {
  /** 段(かけられる数) */
  a: number;
  /** かける数 */
  b: number;
};

export type RenderedProblem = {
  svg: string;
  /** 表示用の正解(選択肢と比較するための文字列表現) */
  correctAnswer: string;
  /** 選択肢(表示用の文字列表現)。correctAnswerを必ず含む */
  choices: string[];
  /** 回答の入力方式。未指定は choices(選択式)扱い。keypad はテンキーで入力させる */
  inputMode?: 'choices' | 'keypad';
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

/** 九九の典型的な間違い(隣の段・かける数のずれ)から誤答の選択肢を決定的に作る */
function buildMultiplicationChoices(a: number, b: number): number[] {
  const correct = a * b;
  const candidates = [
    correct,
    (a - 1) * b,
    a * (b + 1),
    (a + 1) * b,
    a * (b - 1),
    correct + 1,
    correct + 2,
    correct + 3,
  ].filter((n) => n > 0);
  const unique = Array.from(new Set(candidates)).slice(0, 4);
  // 正解が常に同じ位置に来ないよう決定的に回転させる(buildNumberChoicesと同じ方式)
  const rotate = correct % unique.length;
  return [...unique.slice(rotate), ...unique.slice(0, rotate)];
}

/**
 * 穴あき九九: 「a × □ = 積」の隠されたかける数(b)を答える。
 * 順方向(renderMultiplicationFact)とは想起の方向が逆で、因数分解・√の分解への橋渡しになる。
 * 穴は常にかける数(b)側に固定する(a×b と b×a は別ファクトとして両方あるため全方向カバーできる)
 */
export function renderMultiplicationMissingFactor(params: MultiplicationFactParams): RenderedProblem {
  const { a, b } = params;

  const width = 240;
  const height = 96;
  const svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="central" font-size="40" font-family="sans-serif" fill="${FILL}">${a} × □ = ${a * b}</text></svg>`;

  return {
    svg,
    correctAnswer: String(b),
    // 答えは因数(1〜17)なので、近い数を並べる既存の選択肢生成で十分
    choices: buildNumberChoices(b).map(String),
    // 基礎帯(1〜9の段)は4択、拡張帯(11〜17の段)は思い出して打つテンキー入力
    inputMode: a <= 9 ? 'choices' : 'keypad',
  };
}

export function renderMultiplicationFact(params: MultiplicationFactParams): RenderedProblem {
  const { a, b } = params;
  const correct = a * b;

  // 図形テンプレートと同じ経路で描画できるよう、式もSVGテキストとして生成する
  const width = 240;
  const height = 96;
  const svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="central" font-size="40" font-family="sans-serif" fill="${FILL}">${a} × ${b} = ?</text></svg>`;

  return {
    svg,
    correctAnswer: String(correct),
    choices: buildMultiplicationChoices(a, b).map(String),
    // 基礎帯(1〜9の段)は4択、拡張帯(11〜17の段)は思い出して打つテンキー入力
    inputMode: a <= 9 ? 'choices' : 'keypad',
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
    case 'multiplication_fact':
      return renderMultiplicationFact(row.params as MultiplicationFactParams);
    case 'multiplication_missing_factor':
      return renderMultiplicationMissingFactor(row.params as MultiplicationFactParams);
    default:
      throw new Error(`未知のshape_typeです: ${row.shape_type}`);
  }
}
