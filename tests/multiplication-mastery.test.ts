// multiplication_masteryビューのテスト。
// - RLS攻撃テスト: 「保護者Bのトークンで子Aの習熟データにアクセスして失敗すること」を確認する(必須規約)。
// - 習得ロジック: 「5連続正答・各閾値秒以内(基礎帯3秒/拡張帯5秒)」で習得になることを確認する。
// ローカルのSupabase(npx supabase start)に対して実際にクエリを投げる統合テスト。
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

config();

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error(
    '.env にSupabaseの接続情報がありません。README.mdの手順で `npx supabase start` を実行し、.envを設定してください',
  );
}

const TEST_PASSWORD = 'mastery-test-password-12345';

function uniqueTestEmail(label: string): string {
  return `mastery-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

type SignedInParent = { userId: string; client: SupabaseClient };

async function createSignedInParent(admin: SupabaseClient, label: string): Promise<SignedInParent> {
  const email = uniqueTestEmail(label);
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (createError || !created.user) {
    throw new Error(`テスト用ユーザー(${label})の作成に失敗しました: ${createError?.message}`);
  }

  const client = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (signInError) {
    throw new Error(`テスト用ユーザー(${label})のログインに失敗しました: ${signInError.message}`);
  }

  return { userId: created.user.id, client };
}

describe('multiplication_mastery: 九九の習熟ビュー', () => {
  const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let parentA: SignedInParent;
  let parentB: SignedInParent;
  let childOfA: { id: string };
  // テストで使う九九ファクトのproblem_id
  let fact7x8: string; // 基礎帯(順方向): 習得させる
  let fact3x4: string; // 基礎帯(順方向): 途中に遅い正答を挟み、未習得のままにする
  let fact13x7: string; // 拡張帯(順方向): 4秒回答(基礎帯なら閾値超え)でも習得できることを確認する
  let missing3x4: string; // 基礎帯(穴あき): 順方向(3×4)が未習得でも独立に習得できることを確認する
  let missingProblems: { id: string; params: unknown; base_problem_id: string | null; variation_distance: number }[];

  // 「offsetSec秒後に開始し、durationSec秒かけて回答した」ログを作る
  const baseMs = Date.now() - 60 * 60 * 1000; // 1時間前を起点にする
  function logEntry(problemId: string, offsetSec: number, durationSec: number, isCorrect = true) {
    const started = new Date(baseMs + offsetSec * 1000);
    const completed = new Date(started.getTime() + durationSec * 1000);
    return {
      child_id: childOfA.id,
      problem_id: problemId,
      is_correct: isCorrect,
      started_at: started.toISOString(),
      completed_at: completed.toISOString(),
      context: 'drill' as const,
    };
  }

  beforeAll(async () => {
    parentA = await createSignedInParent(admin, 'parent-a');
    parentB = await createSignedInParent(admin, 'parent-b');

    const { data: child, error: childError } = await parentA.client
      .from('children')
      .insert({ parent_id: parentA.userId, name: 'テスト子A', grade: 2 })
      .select('id')
      .single();
    if (childError || !child) {
      throw new Error(`前提データ(子A)の作成に失敗しました: ${childError?.message}`);
    }
    childOfA = child;

    const { data: mulProblems, error: problemError } = await admin
      .from('problems')
      .select('id, params, base_problem_id, variation_distance, problem_templates!inner(shape_type)')
      .in('problem_templates.shape_type', ['multiplication_fact', 'multiplication_missing_factor']);
    if (problemError || !mulProblems || mulProblems.length === 0) {
      throw new Error('前提データ(九九の問題)の取得に失敗しました。supabase/seed.sqlが投入されているか確認してください');
    }
    const findFact = (shapeType: string, a: number, b: number): string => {
      const row = mulProblems.find((p) => {
        const params = p.params as { a: number; b: number };
        const template = p.problem_templates as unknown as { shape_type: string };
        return template.shape_type === shapeType && params.a === a && params.b === b;
      });
      if (!row) throw new Error(`九九ファクト ${shapeType} ${a}×${b} がシードされていません`);
      return row.id as string;
    };
    fact7x8 = findFact('multiplication_fact', 7, 8);
    fact3x4 = findFact('multiplication_fact', 3, 4);
    fact13x7 = findFact('multiplication_fact', 13, 7);
    missing3x4 = findFact('multiplication_missing_factor', 3, 4);
    missingProblems = mulProblems.filter((p) => {
      const template = p.problem_templates as unknown as { shape_type: string };
      return template.shape_type === 'multiplication_missing_factor';
    }) as typeof missingProblems;

    // 7×8: 5連続正答・各2秒(基礎帯閾値3秒以内)→ 習得
    // 3×4: 3問目だけ4秒かかった正答(閾値超え)→ 連続が途切れて未習得
    // 13×7: 5連続正答・各4秒(拡張帯閾値5秒以内)→ 習得
    // 穴あき3×4: 5連続正答・各2秒 → 習得(順方向の3×4が未習得でも独立に判定される)
    const { error: logError } = await parentA.client.from('answer_logs').insert([
      ...[0, 10, 20, 30, 40].map((offset) => logEntry(fact7x8, offset, 2)),
      ...[0, 10, 30, 40].map((offset) => logEntry(fact3x4, offset, 2)),
      logEntry(fact3x4, 20, 4),
      ...[0, 10, 20, 30, 40].map((offset) => logEntry(fact13x7, offset, 4)),
      ...[0, 10, 20, 30, 40].map((offset) => logEntry(missing3x4, offset, 2)),
    ]);
    if (logError) {
      throw new Error(`前提データ(回答ログ)の作成に失敗しました: ${logError.message}`);
    }
  });

  afterAll(async () => {
    // parentsをはじめ紐づく行はauth.usersからのon delete cascadeで一緒に消える
    await admin.auth.admin.deleteUser(parentA.userId);
    await admin.auth.admin.deleteUser(parentB.userId);
  });

  it('5連続・閾値内の正答で習得済みになり、mastered_atは5問目の完了時刻になる', async () => {
    const { data, error } = await parentA.client
      .from('multiplication_mastery')
      .select('a, b, mode, band, attempts, mastered, mastered_at')
      .eq('child_id', childOfA.id)
      .eq('problem_id', fact7x8)
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ a: 7, b: 8, mode: 'forward', band: 'basic', attempts: 5, mastered: true });
    // 5問目 = offset 40秒 + 回答2秒
    const expectedMasteredAt = baseMs + 40 * 1000 + 2 * 1000;
    expect(new Date(data!.mastered_at as string).getTime()).toBe(expectedMasteredAt);
  });

  it('途中に閾値を超えた回答が挟まると連続が途切れて未習得のまま', async () => {
    const { data, error } = await parentA.client
      .from('multiplication_mastery')
      .select('a, b, band, attempts, mastered, mastered_at')
      .eq('child_id', childOfA.id)
      .eq('problem_id', fact3x4)
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ a: 3, b: 4, band: 'basic', attempts: 5, mastered: false, mastered_at: null });
  });

  it('拡張帯(11〜17の段)は閾値5秒で判定される(4秒回答で習得できる)', async () => {
    const { data, error } = await parentA.client
      .from('multiplication_mastery')
      .select('a, b, band, mastered')
      .eq('child_id', childOfA.id)
      .eq('problem_id', fact13x7)
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ a: 13, b: 7, band: 'extension', mastered: true });
  });

  it('穴あき(missing_factor)は順方向とは独立に習熟が判定される', async () => {
    // 同じ3×4でも、順方向は未習得のまま・穴あきは習得済みになる
    const { data, error } = await parentA.client
      .from('multiplication_mastery')
      .select('a, b, mode, band, mastered')
      .eq('child_id', childOfA.id)
      .eq('problem_id', missing3x4)
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ a: 3, b: 4, mode: 'missing_factor', band: 'basic', mastered: true });
  });

  it('穴あき問題は順方向の同一ファクトに変形距離3で紐づいてシードされている', async () => {
    const missingRow = missingProblems.find((p) => p.id === missing3x4);
    expect(missingRow).toBeDefined();
    expect(missingRow!.variation_distance).toBe(3);
    expect(missingRow!.base_problem_id).toBe(fact3x4);
    // 全193ファクトが穴あき化され、すべて順方向のbaseを持つ
    expect(missingProblems.length).toBe(193);
    expect(missingProblems.every((p) => p.base_problem_id !== null && p.variation_distance === 3)).toBe(true);
  });

  it('親Bは親Aの子の習熟データを読み取れない(RLS攻撃テスト)', async () => {
    const { data, error } = await parentB.client
      .from('multiplication_mastery')
      .select('problem_id')
      .eq('child_id', childOfA.id);
    // SELECTの拒否はエラーではなく0件になる(既存のRLSテストと同じ規約)
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('(比較対照)親Aは自分の子の習熟データを読み取れる', async () => {
    const { data, error } = await parentA.client
      .from('multiplication_mastery')
      .select('problem_id')
      .eq('child_id', childOfA.id);
    expect(error).toBeNull();
    expect(data?.length).toBe(4);
  });
});
