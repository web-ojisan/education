# 算数・図形学習サービス(マイルストーン1)

小学校低学年(小1〜3)向けの算数・図形学習サービス。詳しい方針は [CLAUDE.md](./CLAUDE.md) を参照。

マイルストーン1のスコープ:
1. Astro + Supabase のプロジェクト雛形とローカル開発環境
2. DBスキーマ初版とRLSポリシー
3. Google認証(親)と子プロフィールの作成・切替画面
4. ドリル回答画面(Reactアイランド)
5. RLSの攻撃テスト(別の親のデータが読めないこと)

## 必要なもの

- Node.js 22 系(`.nvmrc` あり。`nvm use` で切り替え)
- Docker(ローカルSupabaseの実行に必要)
- Google Cloud のアカウント(親のGoogleログイン用。ローカル動作確認だけなら後回しでもよい)

## セットアップ

```bash
nvm use            # Node 22系に切り替え(.nvmrc)
npm install
npx supabase start # ローカルSupabaseを起動(初回はDockerイメージの取得で数分かかる)
```

`npx supabase start` の出力に `ANON_KEY` / `SERVICE_ROLE_KEY` が表示されるので、
`.env.example` をコピーして `.env` を作成し、値を埋める。

```bash
cp .env.example .env
```

```
PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
GOOGLE_AUTH_CLIENT_ID=<後述>
GOOGLE_AUTH_CLIENT_SECRET=<後述>
```

DBスキーマとシードデータは `supabase start` 実行時に自動適用される。スキーマを変更した後は
以下でリセット(migrations再適用 + seed再投入)できる。

```bash
npm run db:reset
```

開発サーバーの起動:

```bash
npm run dev
```

## Google OAuth クライアントの作成手順(親のログイン用)

1. [Google Cloud Console](https://console.cloud.google.com/) で新規プロジェクトを作成する
   (既存プロジェクトを使ってもよい)。
2. 左メニューから「APIとサービス」→「OAuth同意画面」を開き、User Type は「外部」を選択して作成。
   アプリ名・サポートメール・デベロッパーの連絡先メールを入力して保存する(テスト段階なので
   公開設定は「テスト」のままでよく、ログインに使う自分のGoogleアカウントをテストユーザーに追加する)。
3. 「APIとサービス」→「認証情報」→「認証情報を作成」→「OAuthクライアントID」を選択。
   - アプリケーションの種類:**ウェブアプリケーション**
   - 承認済みのリダイレクトURI に以下を追加(ローカルSupabaseのコールバックURL):
     ```
     http://127.0.0.1:54321/auth/v1/callback
     ```
4. 作成後に表示される「クライアントID」「クライアントシークレット」を `.env` の
   `GOOGLE_AUTH_CLIENT_ID` / `GOOGLE_AUTH_CLIENT_SECRET` に設定する。
5. `.env` を保存したら、ローカルSupabaseを再起動して設定を反映する。
   ```bash
   npx supabase stop
   npx supabase start
   ```
6. `npm run dev` でアプリを起動し、`/login` から「Googleでログイン」を押して確認する。

本番(Vercel + 本番Supabaseプロジェクト)へのデプロイは次マイルストーン以降の対応。
その際は本番のコールバックURL(`https://<プロジェクト>.supabase.co/auth/v1/callback`)を
Google Cloud Console側に追加で登録する必要がある。

## テスト(RLS攻撃テスト)

「保護者Bのトークンで子Aのデータにアクセスして失敗すること」を確認するテスト。
ローカルSupabaseが起動している状態で実行する。

```bash
npm test
```

新しいテーブル・RLSポリシーを追加したときは、`tests/rls.test.ts` に倣って同様の攻撃テストを
追加すること([CLAUDE.md](./CLAUDE.md) のセキュリティ規約を参照)。

## 動作確認の流れ(手動)

1. `npm run dev` を起動し `/login` にアクセス
2. Googleでログイン → `/children` にリダイレクトされる
3. 子どもを1人追加 → 一覧に表示される
4. 子どもを選択 → `/drill` に遷移し、シード投入済みの問題(3問)に回答できる
5. 回答すると正誤が表示され、`answer_logs` に記録される(Supabase Studio
   `http://127.0.0.1:54323` のTable Editorで確認可能)

## 今回のスコープ外(将来のマイルストーン)

ゴーストレース、スキル別レーティング、帯・レベル制、ランキング、Stripe課金、
AI生成バッチは未実装。詳細は [CLAUDE.md](./CLAUDE.md) を参照。
