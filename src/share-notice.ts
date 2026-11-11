// 分享連結打不開時給瀏覽器看的頁面 (目前只有「連結不存在」)。
// API 用戶端照舊拿 JSON;這是給人看的,所以要有樣式、有中文、有回首頁的路。
// 版面沿用分享頁的 download.css,文字跟分享頁一樣:預設英文,中文瀏覽器換成 data-zh。

interface Notice {
  title: string
  titleZh: string
  detail: string
  detailZh: string
}

const MISSING: Notice = {
  title: 'This link does not exist.',
  titleZh: '這個連結不存在',
  detail: 'It may have been removed, or the address is incomplete.',
  detailZh: '檔案可能已經被刪除,或是網址不完整。',
}

function render(notice: Notice, cssHash: string): string {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Pokkit | 隨手一丟就分享</title>
  <link rel="stylesheet" href="/download.css?v=${cssHash}">
</head>
<body>
  <div class="container">
    <nav class="nav">
      <a href="/" class="nav-logo">Pokkit<span class="brand-zh" data-zh="帕奇縮縮"></span></a>
    </nav>
    <main class="download-card">
      <div class="action-area">
        <div class="expired-msg" data-zh="${notice.titleZh}">${notice.title}</div>
        <p class="notice-detail" data-zh="${notice.detailZh}">${notice.detail}</p>
        <a class="btn btn-primary btn-large" href="/" data-zh="回首頁">Back to Pokkit</a>
      </div>
    </main>
    <footer class="footer">
      <a class="footer-brand" href="/" data-zh="Pokkit 隨手一丟就分享">Pokkit: drop it, share it</a>
    </footer>
  </div>
  <script>
(function(){
  var langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
  for (var i = 0; i < langs.length; i++) {
    if (/^zh\\b/i.test(langs[i])) {
      document.querySelectorAll('[data-zh]').forEach(function (el) { el.textContent = el.getAttribute('data-zh'); });
      return;
    }
  }
})();
</script>
</body>
</html>`
}

export function renderMissingPage(cssHash: string): string {
  return render(MISSING, cssHash)
}
