// 親向けサマリのチャートモデル生成(純粋関数)。
// セキュリティ規約で set:html が使えないため、SVG文字列ではなく座標・パスのデータを返し、
// summary.astro のテンプレート側で <svg> 要素として組み立てる。
// 色は付けない(ページ側で var(--chart-*) を参照する)。

const WIDTH = 560;
const HEIGHT = 200;
const PAD = { top: 28, right: 56, bottom: 24, left: 12 };

export type LinePoint = { label: string; value: number | null };

export type LineChartModel = {
  width: number;
  height: number;
  hasData: boolean;
  /** 折れ線のパス(M x,y L x,y ...) */
  linePath: string;
  /** 線の下側をふんわり塗る面のパス */
  areaPath: string;
  /** 控えめな横グリッド線のY座標 */
  gridYs: number[];
  /** 最新点の丸マーカー */
  lastDot: { x: number; y: number } | null;
  /** 最新点の値ラベル(例「56こ」「3.2秒」) */
  lastValue: { x: number; y: number; text: string } | null;
  /** X軸の端ラベル(最初と最後) */
  xLabels: { x: number; text: string; anchor: 'start' | 'end' }[];
};

/** 目盛りの上限をきりのいい数に丸める */
function niceMax(maxValue: number): number {
  if (maxValue <= 5) return 5;
  const magnitude = 10 ** Math.floor(Math.log10(maxValue));
  const normalized = maxValue / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

export function buildLineChart(points: LinePoint[], unit = ''): LineChartModel {
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const bottomY = PAD.top + innerH;

  const plotted = points
    .map((point, i) => ({ ...point, i }))
    .filter((point): point is { label: string; value: number; i: number } => point.value !== null);

  const gridYs = [0, 0.5, 1].map((ratio) => PAD.top + innerH * ratio);

  if (plotted.length === 0) {
    return {
      width: WIDTH,
      height: HEIGHT,
      hasData: false,
      linePath: '',
      areaPath: '',
      gridYs,
      lastDot: null,
      lastValue: null,
      xLabels: [],
    };
  }

  const yMax = niceMax(Math.max(...plotted.map((point) => point.value)));
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const toX = (i: number) => Math.round((PAD.left + i * stepX) * 10) / 10;
  const toY = (value: number) => Math.round((PAD.top + innerH * (1 - value / yMax)) * 10) / 10;

  const coords = plotted.map((point) => ({ x: toX(point.i), y: toY(point.value), value: point.value }));
  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x},${c.y}`).join(' ');
  const areaPath = `${linePath} L ${coords[coords.length - 1].x},${bottomY} L ${coords[0].x},${bottomY} Z`;

  const last = coords[coords.length - 1];
  const lastPlotted = plotted[plotted.length - 1];
  const decimals = Number.isInteger(lastPlotted.value) ? 0 : 1;

  return {
    width: WIDTH,
    height: HEIGHT,
    hasData: true,
    linePath,
    areaPath,
    gridYs,
    lastDot: { x: last.x, y: last.y },
    lastValue: { x: last.x + 8, y: last.y - 8, text: `${lastPlotted.value.toFixed(decimals)}${unit}` },
    xLabels: [
      { x: toX(0), text: points[0].label, anchor: 'start' },
      { x: toX(points.length - 1), text: points[points.length - 1].label, anchor: 'end' },
    ],
  };
}

export type BarChartModel = {
  width: number;
  height: number;
  hasData: boolean;
  bars: { x: number; y: number; w: number; h: number }[];
  /** X軸の端ラベル(最初と最後) */
  xLabels: { x: number; text: string; anchor: 'start' | 'end' }[];
  baselineY: number;
};

export function buildBarChart(values: { label: string; value: number }[]): BarChartModel {
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const bottomY = PAD.top + innerH;
  const maxValue = Math.max(...values.map((v) => v.value), 0);

  if (values.length === 0 || maxValue === 0) {
    return { width: WIDTH, height: HEIGHT, hasData: false, bars: [], xLabels: [], baselineY: bottomY };
  }

  const yMax = niceMax(maxValue);
  const slotW = innerW / values.length;
  const barW = Math.max(Math.round(slotW * 0.6 * 10) / 10, 2);

  const bars = values.map((v, i) => {
    const h = Math.round(((v.value / yMax) * innerH) * 10) / 10;
    return {
      x: Math.round((PAD.left + i * slotW + (slotW - barW) / 2) * 10) / 10,
      y: Math.round((bottomY - h) * 10) / 10,
      w: barW,
      h,
    };
  });

  return {
    width: WIDTH,
    height: HEIGHT,
    hasData: true,
    bars,
    xLabels: [
      { x: PAD.left, text: values[0].label, anchor: 'start' },
      { x: PAD.left + innerW, text: values[values.length - 1].label, anchor: 'end' },
    ],
    baselineY: bottomY,
  };
}
