// 九九テンプレート(multiplication_fact / multiplication_missing_factor)の単体テスト。
// DBには接続しない純粋関数のテスト。
import { describe, expect, it } from 'vitest';
import {
  renderMultiplicationFact,
  renderMultiplicationMissingFactor,
  renderProblem,
} from '../src/lib/problem-templates';

describe('renderMultiplicationFact', () => {
  it('正解はparamsから導出される(7×8=56)', () => {
    const rendered = renderMultiplicationFact({ a: 7, b: 8 });
    expect(rendered.correctAnswer).toBe('56');
  });

  it('選択肢は正解を必ず含み、重複がない', () => {
    for (const a of [1, 2, 7, 9, 11, 17]) {
      for (const b of [1, 5, 9, 13, 17]) {
        const rendered = renderMultiplicationFact({ a, b });
        expect(rendered.choices).toContain(rendered.correctAnswer);
        expect(new Set(rendered.choices).size).toBe(rendered.choices.length);
        expect(rendered.choices.length).toBeGreaterThanOrEqual(2);
        expect(rendered.choices.length).toBeLessThanOrEqual(4);
      }
    }
  });

  it('同じparamsからは常に同じ結果になる(決定的)', () => {
    const first = renderMultiplicationFact({ a: 6, b: 7 });
    const second = renderMultiplicationFact({ a: 6, b: 7 });
    expect(second).toEqual(first);
  });

  it('基礎帯(1〜9の段)は4択、拡張帯(11〜17の段)はテンキー入力になる', () => {
    expect(renderMultiplicationFact({ a: 9, b: 9 }).inputMode).toBe('choices');
    expect(renderMultiplicationFact({ a: 11, b: 3 }).inputMode).toBe('keypad');
    expect(renderMultiplicationFact({ a: 17, b: 17 }).inputMode).toBe('keypad');
  });

  it('SVGに式が含まれる', () => {
    const rendered = renderMultiplicationFact({ a: 3, b: 4 });
    expect(rendered.svg).toContain('3 × 4 = ?');
  });

  it('renderProblemのshape_type分岐から呼び出せる', () => {
    const rendered = renderProblem({
      id: 'dummy-id',
      shape_type: 'multiplication_fact',
      params: { a: 13, b: 7 },
    });
    expect(rendered.correctAnswer).toBe('91');
    expect(rendered.inputMode).toBe('keypad');
  });
});

describe('renderMultiplicationMissingFactor', () => {
  it('正解は隠されたかける数(b)になる(9×□=72 → 8)', () => {
    const rendered = renderMultiplicationMissingFactor({ a: 9, b: 8 });
    expect(rendered.correctAnswer).toBe('8');
    expect(rendered.svg).toContain('9 × □ = 72');
  });

  it('選択肢は正解を必ず含み、重複がない', () => {
    for (const a of [1, 2, 7, 9, 11, 17]) {
      for (const b of [1, 5, 9, 13, 17]) {
        const rendered = renderMultiplicationMissingFactor({ a, b });
        expect(rendered.choices).toContain(rendered.correctAnswer);
        expect(new Set(rendered.choices).size).toBe(rendered.choices.length);
      }
    }
  });

  it('基礎帯は4択、拡張帯はテンキー入力になる(順方向と同じ規則)', () => {
    expect(renderMultiplicationMissingFactor({ a: 9, b: 9 }).inputMode).toBe('choices');
    expect(renderMultiplicationMissingFactor({ a: 13, b: 7 }).inputMode).toBe('keypad');
  });

  it('renderProblemのshape_type分岐から呼び出せる', () => {
    const rendered = renderProblem({
      id: 'dummy-id',
      shape_type: 'multiplication_missing_factor',
      params: { a: 13, b: 7 },
    });
    expect(rendered.correctAnswer).toBe('7');
    expect(rendered.svg).toContain('13 × □ = 91');
  });
});
