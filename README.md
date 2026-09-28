# のこりものレシピ — 設計・セットアップ手順

冷蔵庫の残り物からレシピを提案する会員制Webアプリ。

```
GitHub Pages（index.html / style.css / app.js）
        │  fetch POST（Content-Type: text/plain → プリフライトなし）
        ▼
Google Apps Script ウェブアプリ（gas/Code.gs）
        ├─ Google スプレッドシート（users / recipes）
        ├─ Google Drive（recipes/ に JSON、images/ に料理写真）
        ├─ Gemini API（構造化JSONでレシピ生成）
        └─ MailApp（仮パスワード送信）
```

---

## 1. スプレッドシート設計

`setup()` を実行すると自動で作成されます（列が足りない場合も自動で追加）。全列を書式「書式なしテキスト」にしてあります。

### `users` シート

| 列 | 内容 | 例 |
|---|---|---|
| id | ユーザーID | `u_3f2a…` |
| email | メールアドレス（小文字に正規化） | `ken@example.com` |
| nickname | ニックネーム（20文字まで） | `ケン` |
| passwordHash | `sha256$ストレッチ回数$ハッシュ値` | `sha256$1000$9ab1…` |
| salt | ユーザーごとのソルト（32桁hex） | `c81e…` |
| status | `temp`（仮パスワード中） / `active` / `disabled`（利用停止） | `active` |
| mustChangePassword | 次回ログイン時にパスワード変更が必要か | `TRUE` |
| failCount | 連続ログイン失敗回数 | `0` |
| lockedUntil | ロック解除時刻（ミリ秒）。空欄ならロックなし | `1790000000000` |
| tokenVersion | ログイントークンの世代番号。パスワード変更・再発行で +1 され、古いトークンは無効になる | `2` |
| createdAt / updatedAt / lastLoginAt | ISO形式の日時 | `2026-09-28T03:00:00.000Z` |

> 要件の `tempToken` 列は、`mustChangePassword`（仮パスワード状態の管理）と `tokenVersion`（トークンの一括無効化）の2列に分けて実装しています。

手動で利用停止にしたいときは `status` を `disabled` にしてください。

### `recipes` シート

| 列 | 内容 |
|---|---|
| id | レシピID（`r_…`） |
| userId | 作成したユーザーのID |
| title | レシピ名（一覧表示・検索用） |
| recipeDataJson | レシピ本体と入力条件のJSON `{recipe, input}` |
| driveFileId | Drive `recipes/` フォルダに保存したJSONファイルのID |
| imageFileId | Drive `images/` フォルダの料理写真のID（なければ空欄） |
| favorite | お気に入り（`TRUE` / `FALSE`） |
| createdAt / updatedAt | ISO形式の日時 |

`recipeDataJson.recipe` の形:

```json
{
  "title": "キャベツとちくわの甘辛炒め",
  "summary": "ごはんが進む甘辛味",
  "cookingTimeMinutes": 10,
  "difficulty": "かんたん",
  "servings": 2,
  "genre": "和食",
  "ingredients": [{ "name": "キャベツ", "amount": "1/4個", "fromFridge": true }],
  "seasonings": [{ "name": "醤油", "amount": "大さじ1" }],
  "steps": ["キャベツはざく切りにする。", "…"],
  "tips": "強めの火で手早く炒める",
  "substitutions": [{ "from": "ちくわ", "to": "ハムやかまぼこでも同じように作れます" }]
}
```

---

## 2. GAS の準備

1. [script.google.com](https://script.google.com) で新しいプロジェクトを作成（スプレッドシートの「拡張機能 → Apps Script」から作ってもOK。その場合はそのシートがDBになります）
2. `Code.gs` の中身をすべて `gas/Code.gs` に置き換えて保存
3. 左メニュー「プロジェクトの設定」→ 下部「スクリプト プロパティ」に登録

| プロパティ | 必須 | 内容 |
|---|---|---|
| `GEMINI_API_KEY` | ○ | [Google AI Studio](https://aistudio.google.com/apikey) で発行したAPIキー |
| `APP_URL` | 推奨 | 公開URL（例 `https://kenken6291.github.io/リポジトリ名/`）。仮パスワードのメールに載ります |
| `GEMINI_MODEL` | | 既定は `gemini-3.8-flash`。費用と速さを優先するなら `gemini-3.5-flash-lite` |
| `GEMINI_THINKING_LEVEL` | | AIの考える深さ。`low`（既定・速い） / `medium` / `high`。`none` で指定なし |
| `HOURLY_LIMIT` | | 1ユーザー1時間あたりのレシピ生成回数。既定 `20` |
| `HASH_ITERATIONS` | | パスワードのストレッチ回数。既定 `1000` |
| `SPREADSHEET_ID` / `FOLDER_ID` | | 既存のものを使う場合だけ手動で。空なら `setup()` が自動作成 |
| `TOKEN_SECRET` / `PEPPER` | | `setup()` が自動生成。**後から変更しないこと**（変えると全員ログアウト／パスワード照合不可になります） |

4. 関数選択で `setup` を選んで「実行」→ 権限を承認（スプレッドシート・Drive・メール送信・外部通信）
5. 実行ログにスプレッドシートとDriveフォルダのURLが出れば成功
6. 関数 `testGemini` を実行し、ログにレシピJSONが出ればGemini連携もOK

## 3. ウェブアプリとして公開

1. 右上「デプロイ」→「新しいデプロイ」→ 種類の歯車から「ウェブアプリ」
2. 設定
   - 実行ユーザー: **自分**
   - アクセスできるユーザー: **全員**（「Googleアカウントを持つ全員」ではない方）
3. 「デプロイ」→ 表示された **ウェブアプリURL（…/exec）** をコピー

> ⚠ Code.gs を修正したら、保存だけでは反映されません。
> 「デプロイ」→「デプロイを管理」→ 鉛筆アイコン → バージョン「**新バージョン**」→「デプロイ」。
> この手順ならURLは変わりません。

## 4. GitHub Pages で公開

1. GitHub に新しいリポジトリを作成（例: `nokori-recipe`）
2. ルートに `index.html` / `style.css` / `app.js` を置く（`gas/Code.gs` は参考として置いてもOK。GitHub Pagesでは実行されません）
3. `app.js` 先頭の `CONFIG.GAS_URL` を、3でコピーしたURLに書き換えてコミット
4. リポジトリの Settings → Pages → Source「Deploy from a branch」→ Branch `main` / `(root)` → Save
5. 1〜2分後に `https://kenken6291.github.io/リポジトリ名/` で表示されます

---

## 5. 動作の要点

- **会員登録**: メール＋ニックネーム → 仮パスワード（英数10文字）をメール送信。メール送信に成功した場合だけ登録されます
- **初回ログイン**: 仮パスワードでログインすると、パスワード変更画面以外は使えません（サーバー側でも `MUST_CHANGE` で拒否）
- **パスワード規則**: 英字と数字を両方含む8〜64文字（半角）
- **ロック**: 5回連続で間違えると15分ロック。管理者は `adminUnlock()` のメールを書き換えて実行すれば即解除
- **再発行**: 同じメールには1分に1回まで。未登録のメールでも同じ文言を返します
- **ログイン状態**: HMAC署名付きトークン（有効期限7日）。「ログインしたままにする」ON で `localStorage`、OFF で `sessionStorage`（タブを閉じると消える）
- **ストレッチ回数**: ハッシュ値の中に回数を記録しているので、`HASH_ITERATIONS` を後から変えても既存ユーザーはそのままログインでき、ログイン成功時に新しい回数で自動再ハッシュされます
- **料理写真**: ブラウザ側で長辺1280pxのJPEGに縮小してから送信。Driveの共有リンク（リンクを知っている全員が閲覧可）で表示し、組織の設定などで共有できない場合はGAS経由で画像を取得して表示します

## 6. うまく動かないとき

| 症状 | 確認すること |
|---|---|
| 「サーバーの応答を読み取れませんでした」 | デプロイのアクセスが「全員」か。コード修正後に新バージョンでデプロイしたか |
| 「GAS_URL が未設定です」 | `app.js` の `CONFIG.GAS_URL` |
| ログインが遅い | `HASH_ITERATIONS` を下げる（例 `500`）。既存ユーザーもそのままログインできます |
| メールが届かない | 迷惑メールフォルダ。GASの無料アカウントは1日100通が上限 |
| AIの呼び出しに失敗（400） | `GEMINI_API_KEY` の値、`GEMINI_MODEL` のモデル名 |
| レシピ生成が遅い | `GEMINI_THINKING_LEVEL` が `low` か確認。さらに速くするなら `GEMINI_MODEL` を `gemini-3.5-flash-lite` に |
| 写真が表示されない | Driveの共有設定が制限されていても自動でGAS経由表示に切り替わります。それでもダメなら `images` フォルダの権限を確認 |
