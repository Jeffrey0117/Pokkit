// 把容量換成一般人聽得懂的話:「約幾張照片,或幾小時影片」。
//
// 20GB 是多少沒人有概念,10 萬張照片就有。真正的限制還是容量 (硬碟才是成本,
// 而且一支影片抵得過兩百張照片),這裡只負責把那個容量「講出來」。
//
// 換算的依據是線上實際存的東西,不是猜的 (2026-11-11 量的):
//   照片 3,771 張,平均 0.17 MB (存的是最長邊 2048 的 WebP,不是原檔)
//   影片 930 支,平均每分鐘 31.6 MB (1080p 轉檔)
// 兩個假設都比實測略大、結果一律往下取整 —— 寧可少講,不要多講。
// 方案頁的文案由 test/capacity-copy.test.mjs 綁在這裡:方案大小或這兩個數字
// 一改,測試會紅,文案就得跟著看一次。

const MB = 1024 * 1024

export const PHOTO_BYTES = Math.round(0.2 * MB)
export const VIDEO_BYTES_PER_MINUTE = 34 * MB

export interface CapacityEstimate {
  photos: number
  videoMinutes: number
}

// 往下取到兩位有效數字:102,400 → 100,000;25,600 → 25,000
function floorToTwoFigures(n: number): number {
  if (n < 100) return Math.floor(n)
  const unit = 10 ** (Math.floor(Math.log10(n)) - 1)
  return Math.floor(n / unit) * unit
}

// 一小時以上講整數小時,不到一小時講整十分鐘
function floorToFriendlyMinutes(minutes: number): number {
  if (minutes >= 60) return Math.floor(minutes / 60) * 60
  if (minutes >= 10) return Math.floor(minutes / 10) * 10
  return Math.floor(minutes)
}

export function estimateCapacity(bytes: number): CapacityEstimate {
  return {
    photos: floorToTwoFigures(bytes / PHOTO_BYTES),
    videoMinutes: floorToFriendlyMinutes(bytes / VIDEO_BYTES_PER_MINUTE),
  }
}

const grouped = (n: number) => n.toLocaleString('en-US')

function english({ photos, videoMinutes }: CapacityEstimate): string {
  const hours = videoMinutes / 60
  const video = videoMinutes >= 60
    ? `${hours} hour${hours === 1 ? '' : 's'}`
    : `${videoMinutes} minute${videoMinutes === 1 ? '' : 's'}`
  return `About ${grouped(photos)} photos, or ${video} of video`
}

function chinese({ photos, videoMinutes }: CapacityEstimate): string {
  const count = photos >= 10_000 ? `${photos / 10_000} 萬張` : `${grouped(photos)} 張`
  const video = videoMinutes >= 60 ? `${videoMinutes / 60} 小時` : `${videoMinutes} 分鐘`
  return `約 ${count}照片，或 ${video}影片`
}

export function describeCapacity(bytes: number, lang: 'en' | 'zh'): string {
  const estimate = estimateCapacity(bytes)
  return lang === 'zh' ? chinese(estimate) : english(estimate)
}
