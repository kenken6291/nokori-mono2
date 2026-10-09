/* のこりものレシピ — config.js（環境ごとの設定）
   GASを新しくデプロイしてURLが変わったときは、ここだけを書き換えてください。
   ※ app.js より先に読み込みます（index.html の <script> の順番） */
window.APP_CONFIG = {
  // GASのウェブアプリURL（デプロイ → ウェブアプリ → …/exec）
  GAS_URL: 'https://script.google.com/macros/s/AKfycbxns2T5Ic1C5EGkW33jKfPR4j258w572kTaIFqm_0BTnobtze8Hbnkl_7l1R17kcnWS/exec',

  // サーバーの応答を待つ時間（ミリ秒）。献立づくりなどAIを使う処理があるため長めにしています
  TIMEOUT_MS: 90000,
};
