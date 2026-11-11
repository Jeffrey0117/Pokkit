// 把 multipart 的檔案讀進記憶體,超過大小上限就回 null。
//
// 超過上限時 @fastify/multipart 會把串流切斷。它「通常」會從 toBuffer() 丟出
// FST_REQ_FILE_TOO_LARGE,但只有切斷發生在還沒讀完的時候才丟;落在最後一塊
// 讀完之後,toBuffer() 就靜靜回來一個只有前半段的 buffer,只留下 truncated
// 這個旗標。兩種都要當成「太大」,不然會回成功卻存下一個壞檔
// (2026-11-11 實案:訪客傳 65MB,18 次中 16 次存成剛好 64MB)。

export interface UploadPart {
  toBuffer(): Promise<Buffer>
  file: { truncated?: boolean }
}

const TOO_LARGE = 'FST_REQ_FILE_TOO_LARGE'

export async function readWithinLimit(part: UploadPart): Promise<Buffer | null> {
  try {
    const buffer = await part.toBuffer()
    return part.file.truncated ? null : buffer
  } catch (err) {
    if ((err as { code?: string }).code === TOO_LARGE) return null
    throw err
  }
}
