// 分享頁給聊天軟體 / 社群看的預覽卡標籤 (Open Graph + Twitter card)。
//
// 圖片用自己當預覽圖;影片用轉檔時產生的縮圖 (規格 2026-10-04 第 8 節)——
// 沒有 og:image 的影片連結貼到 LINE / FB 只有一行字。
// 有密碼或已過期的檔案什麼媒體都不宣告:那些網址本來就拿不到東西。

export interface PreviewEntry {
  id: string
  mime: string
  password_hash?: string | null
  expires_at?: number | null
  thumb_stored_name?: string | null
}

const meta = (attr: 'property' | 'name', key: string, content: string) =>
  `<meta ${attr}="${key}" content="${content}">`

const escapeAttr = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function sharePreviewTags(entry: PreviewEntry, baseUrl: string, now: number = Date.now()): string {
  const isImage = entry.mime.startsWith('image/')
  const isVideo = entry.mime.startsWith('video/')
  const expired = entry.expires_at ? now > entry.expires_at : false
  const open = !entry.password_hash && !expired

  // baseUrl 可能來自請求的 Host 標頭,id 來自網址 —— 進到屬性之前都要跳脫
  const origin = escapeAttr(baseUrl)
  const id = escapeAttr(encodeURIComponent(entry.id))
  const preview = `${origin}/files/${id}/preview`
  const poster = isVideo && entry.thumb_stored_name ? `${origin}/photos/${id}/thumb.webp` : null
  const image = !open ? null : isImage ? preview : poster

  const tags = [
    meta('property', 'og:type', isImage ? 'image' : isVideo ? 'video.other' : 'website'),
    ...(image ? [meta('property', 'og:image', image)] : []),
    ...(open && isVideo
      ? [meta('property', 'og:video', preview), meta('property', 'og:video:type', escapeAttr(entry.mime))]
      : []),
    meta('name', 'twitter:card', image ? 'summary_large_image' : 'summary'),
  ]
  return tags.join('\n  ')
}
