// 把一個 multipart 上傳讀進來:一個檔案 + 表單欄位。兩件套件不會替你做的事都在這裡。
//
// 1. 超過大小上限
//    @fastify/multipart 會把串流切斷。它「通常」會從 toBuffer() 丟出
//    FST_REQ_FILE_TOO_LARGE,但只有切斷發生在還沒讀完的時候才丟;落在最後一塊
//    讀完之後,toBuffer() 就靜靜回來一個只有前半段的 buffer,只留下 truncated
//    這個旗標。兩種都要當成「太大」,不然會回成功卻存下一個壞檔
//    (2026-11-11 實案:訪客傳 65MB,18 次中 16 次存成剛好 64MB)。
//
// 2. 欄位排在檔案後面
//    `request.file()` 拿到檔案的當下,只看得到「排在檔案前面」的欄位。
//    `curl -F file=@x -F password=…` 這種順序,密碼和期限會整個不見 —— 檔案
//    存成沒鎖、永久有效 (2026-11-11 實測:2MB 以上 6 次中 6 次)。
//    所以要把所有 part 走完,欄位不管排哪裡都收得到。

export interface UploadPart {
  toBuffer(): Promise<Buffer>
  file: { truncated?: boolean; resume?: () => unknown }
}

const TOO_LARGE = 'FST_REQ_FILE_TOO_LARGE'

const EXTRA_FILE = 'FST_FILES_LIMIT'

const isTooLarge = (err: unknown) => (err as { code?: string } | null)?.code === TOO_LARGE
const isExtraFile = (err: unknown) => (err as { code?: string } | null)?.code === EXTRA_FILE

/** 一次上傳只收一個檔案。交給套件擋,多出來的檔案它連讀都不讀 ——
 *  不設的話,第二個檔案會被一路讀到底再丟掉,等於讓人免費佔住一條連線。 */
export const ONE_FILE = { files: 1 } as const

/** 完整內容;超過大小上限回 null。 */
export async function readWithinLimit(part: UploadPart): Promise<Buffer | null> {
  try {
    const buffer = await part.toBuffer()
    return part.file.truncated ? null : buffer
  } catch (err) {
    if (isTooLarge(err)) return null
    throw err
  }
}

interface FilePart extends UploadPart {
  type: 'file'
  filename: string
  mimetype: string
}
interface FieldPart {
  type: 'field'
  fieldname: string
  value: unknown
}
export type AnyPart = FilePart | FieldPart

export interface UploadRead {
  /** 第一個檔案的名字與型別;整個表單沒有檔案時是 null */
  file: { filename: string; mimetype: string } | null
  /** 檔案內容。太大、或被 skipFile 略過時是 null */
  buffer: Buffer | null
  tooLarge: boolean
  /** 所有表單欄位,不論排在檔案前面還是後面 */
  fields: Record<string, unknown>
}

/**
 * @param skipFile 輪到檔案時,用「目前已經看到的欄位」判斷要不要直接丟掉這個檔案
 *   (例如前面的欄位已經確定不合法,就不必把幾百 MB 讀進記憶體)。
 */
export async function readUpload(
  parts: AsyncIterable<AnyPart>,
  skipFile: (fieldsSoFar: Record<string, unknown>) => boolean = () => false,
): Promise<UploadRead> {
  const fields: Record<string, unknown> = {}
  let file: UploadRead['file'] = null
  let buffer: Buffer | null = null
  let tooLarge = false

  try {
    for await (const part of parts) {
      if (part.type !== 'file') {
        fields[part.fieldname] = part.value
        continue
      }
      // 只收第一個檔案;其餘的(以及被略過的)要讀掉丟棄,後面的 part 才出得來
      if (file || skipFile(fields)) {
        file = file ?? { filename: part.filename, mimetype: part.mimetype }
        part.file.resume?.()
        continue
      }
      file = { filename: part.filename, mimetype: part.mimetype }
      buffer = await readWithinLimit(part)
      if (!buffer) tooLarge = true
    }
  } catch (err) {
    if (isTooLarge(err)) {
      // 檔案被切斷之後,套件會在取下一個 part 時再丟一次同樣的錯
      tooLarge = true
      buffer = null
    } else if (!(isExtraFile(err) && file)) {
      throw err
    }
    // 其餘情況 = 表單裡還有第二個檔案 (呼叫端設了 limits.files: 1):
    // 套件到這裡就不再往下讀,第一個檔案已經完整收到,照常用它。
  }

  return { file, buffer, tooLarge, fields }
}
