// RLS攻撃テスト:「保護者Bのトークンで子Aのデータにアクセスして失敗すること」を確認する。
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

const TEST_PASSWORD = 'rls-test-password-12345';

function uniqueTestEmail(label: string): string {
  return `rls-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
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

describe('RLS: 親の境界を越えて他の親の子データへアクセスできないこと', () => {
  const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let parentA: SignedInParent;
  let parentB: SignedInParent;
  let childOfA: { id: string };
  let someProblemId: string;

  beforeAll(async () => {
    parentA = await createSignedInParent(admin, 'parent-a');
    parentB = await createSignedInParent(admin, 'parent-b');

    const { data: child, error: childError } = await parentA.client
      .from('children')
      .insert({ parent_id: parentA.userId, name: 'テスト子A', grade: 1 })
      .select('id')
      .single();
    if (childError || !child) {
      throw new Error(`前提データ(子A)の作成に失敗しました: ${childError?.message}`);
    }
    childOfA = child;

    const { data: problem, error: problemError } = await admin.from('problems').select('id').limit(1).single();
    if (problemError || !problem) {
      throw new Error('前提データ(問題)の取得に失敗しました。supabase/seed.sqlが投入されているか確認してください');
    }
    someProblemId = problem.id;

    const { error: logError } = await parentA.client.from('answer_logs').insert({
      child_id: childOfA.id,
      problem_id: someProblemId,
      is_correct: true,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      context: 'drill',
    });
    if (logError) {
      throw new Error(`前提データ(回答ログ)の作成に失敗しました: ${logError.message}`);
    }
  });

  afterAll(async () => {
    // parentsをはじめ紐づく行はauth.usersからのon delete cascadeで一緒に消える
    await admin.auth.admin.deleteUser(parentA.userId);
    await admin.auth.admin.deleteUser(parentB.userId);
  });

  it('親Bは親Aの親アカウント情報を読み取れない', async () => {
    const { data, error } = await parentB.client.from('parents').select('id').eq('id', parentA.userId).maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('親Bは親Aの子プロフィールを読み取れない', async () => {
    const { data, error } = await parentB.client.from('children').select('id').eq('id', childOfA.id).maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('親Bは親Aの子の回答ログを読み取れない', async () => {
    const { data, error } = await parentB.client.from('answer_logs').select('id').eq('child_id', childOfA.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('親Bは親Aの子に紐づく回答ログを新規作成できない', async () => {
    const { error } = await parentB.client.from('answer_logs').insert({
      child_id: childOfA.id,
      problem_id: someProblemId,
      is_correct: true,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      context: 'drill',
    });
    expect(error).not.toBeNull();
  });

  it('親Bは親Aの子プロフィールを更新できない', async () => {
    const { data, error } = await parentB.client
      .from('children')
      .update({ name: 'のっとり' })
      .eq('id', childOfA.id)
      .select();
    // RLSは対象行が0件になるだけでエラーにはならない(更新できたことにはならない)
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('(比較対照)親Aは自分の子の回答ログを読み取れる', async () => {
    const { data, error } = await parentA.client.from('answer_logs').select('id').eq('child_id', childOfA.id);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });
});
