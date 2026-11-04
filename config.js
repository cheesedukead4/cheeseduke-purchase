/*
 * 採購工作看板｜設定（這個檔案任何人都看得到，不要放密碼）
 *
 * PB_AUTH.clientId：採購工作看板自己的 Google Cloud「OAuth 用戶端 ID」（網頁應用程式類型），是公開資訊。
 *   建立方式見「使用說明.md」第 1 步。雲端後端（雲端後端/Code.gs）的 GOOGLE_CLIENT_ID_ 也要填同一個 ID。
 * PB_CLOUD.url：採購工作看板的 Apps Script 網頁應用程式網址（結尾 /exec），見「使用說明.md」第 2 步。
 */
window.PB_AUTH = {
  clientId: '' // ← 貼上用戶端 ID，例如 '123456-abcdef.apps.googleusercontent.com'
};

window.PB_CLOUD = {
  url: '' // ← 貼上網頁應用程式網址，例如 'https://script.google.com/macros/s/……/exec'
};
