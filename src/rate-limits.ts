// 流量限制的三種額度。要擋的是濫用,不是正常使用。
//
// 以前所有東西共用同一個「每人每分鐘 600 次」:頁面本身、JS/CSS、每一張縮圖、每個 API。
// 一面照片牆就是幾百張縮圖,滑一下額度就用完,之後連頁面與樣式都被回 429 ——
// 使用者看到的是整個站壞掉 (2026-11-11 的 log:最忙的一分鐘 622 個請求,132 個被擋,
// 被擋的幾乎都是縮圖,還有 /folders 頁面與靜態檔)。
//
//   頁面殼與靜態檔  不計入。便宜、有長快取;而且一旦被擋,連錯誤畫面都載不出來。
//   媒體讀取        縮圖、照片、影片、分享檔案:每條路由各自計算,額度大得多。
//   其他 (API)      維持每分鐘 600 次。

interface RouteLike {
  method: string
  routeOptions?: { url?: string }
}

export const API_LIMIT = { max: 600, timeWindow: '1 minute' } as const

// 每條媒體路由、每位訪客每分鐘 6000 次 (每秒 100 次)。人滑不到這個速度,失控的程式會。
export const MEDIA_ROUTE = { config: { rateLimit: { max: 6000, timeWindow: '1 minute' } } } as const

// '/' 是首頁;'/*' 是靜態檔那條萬用路由,/folders、/photos 這些前端頁面也是從它
// 落到 notFound 再回頁面殼的。
export function isAppShellOrAsset(request: RouteLike): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  const route = request.routeOptions?.url
  return route === '/' || route === '/*'
}
