// 自架模式:沒設會員系統 (LETMEUSE_APP_ID) 的那台。
// 這種站沒有會員、沒有付費方案,頁面上也不該載入代管版才用得到的外部服務
// (登入元件、流量統計) —— 別人架的站不該連回作者的主機。
// 登入改成輸入金鑰:管理金鑰或專案金鑰,伺服器本來就認得。

/** 代管版才有的外部 script:會員登入元件 (data-app-id)、流量統計 (data-website-id) */
const HOSTED_SCRIPT = /<script\b[^>]*\bdata-(?:app-id|website-id)=[^>]*>\s*<\/script>[ \t]*\r?\n?/g

const FLAG = "<script>window.POKKIT_SELFHOST=true;document.documentElement.classList.add('self-hosted')</script>\n"

export function isSelfHosted(config: { letmeuseAppId?: string }): boolean {
  return !config.letmeuseAppId
}

/** 拿掉代管版的外部 script;第一段的位置換成自架旗標,好讓它排在頁面自己的 script 之前。 */
export function toSelfHostedHtml(html: string): string {
  let flagged = false
  const out = html.replace(HOSTED_SCRIPT, () => {
    if (flagged) return ''
    flagged = true
    return FLAG
  })
  return flagged ? out : out.replace('</head>', `${FLAG}</head>`)
}

/** 分享頁:沒有會員系統就沒有「登入才能下載」,下載鈕不該是鎖住的樣子。 */
export function toSelfHostedSharePage(html: string): string {
  return toSelfHostedHtml(html).replace('btn-large is-locked', 'btn-large')
}
