/* Pokkit i18n — English is the key; this maps to 繁體中文.
   Static UI uses [data-i18n]; dynamic strings go through window.t(). */
(function () {
  'use strict';
  var LANG_KEY = 'pokkit_lang';

  var ZH = {
    'Delete this file?': '\u522a\u9664\u9019\u500b\u6a94\u6848\uff1f',
    'Delete this photo?': '\u522a\u9664\u9019\u5f35\u7167\u7247\uff1f',
    'Delete album': '\u522a\u9664\u76f8\u7c3f',
    'Photos will be kept.': '\u7167\u7247\u6703\u4fdd\u7559\u3002',
    'Delete': '\u522a\u9664',
    'OK': '\u78ba\u5b9a',
    'Reset': '\u91cd\u4f86',

    'Taken · newest': '\u62cd\u651d \u65b0\u2192\u820a',
    'Taken · oldest': '\u62cd\u651d \u820a\u2192\u65b0',
    'Uploaded · newest': '\u4e0a\u50b3 \u65b0\u2192\u820a',
    'Uploaded · oldest': '\u4e0a\u50b3 \u820a\u2192\u65b0',

    'Welcome to Pokkit 👋': '\u6b61\u8fce\u4f86\u5230 Pokkit \ud83d\udc4b',
    '30 seconds to meet your personal cloud.': '\u82b1 30 \u79d2\u8a8d\u8b58\u4f60\u7684\u500b\u4eba\u96f2\u7aef\u3002',
    'Drop anything here': '\u6a94\u6848\u5f80\u9019\u88e1\u4e1f',
    'Photos and videos land in your library; every file gets a share link.': '\u7167\u7247\u548c\u5f71\u7247\u6703\u9032\u5165\u4f60\u7684\u5a92\u9ad4\u5eab\uff1b\u6bcf\u500b\u6a94\u6848\u90fd\u6703\u62ff\u5230\u5206\u4eab\u9023\u7d50\u3002',
    'Your photo library': '\u4f60\u7684\u76f8\u7247\u5eab',
    'Browse everything by month — the timeline reads the photo\u2019s real capture date.': '\u6309\u6708\u4efd\u700f\u89bd\u5168\u90e8\u7167\u7247 \u2014 \u6642\u9593\u8ef8\u8b80\u7684\u662f\u7167\u7247\u771f\u6b63\u7684\u62cd\u651d\u65e5\u671f\u3002',
    'Albums': '\u76f8\u7c3f',
    'Organize into albums, then hit Share — one link anyone can open, no app needed.': '\u6574\u7406\u6210\u76f8\u7c3f\u5f8c\u6309 Share \u2014 \u4e00\u689d\u9023\u7d50\u8ab0\u90fd\u80fd\u958b\uff0c\u4e0d\u7528\u88dd\u4efb\u4f55\u6771\u897f\u3002',
    'Deleted \u2260 gone': '\u522a\u6389 \u2260 \u6d88\u5931',
    'Anything you delete waits in Trash for 30 days before it\u2019s really gone.': '\u522a\u6389\u7684\u6771\u897f\u6703\u5728\u5783\u573e\u6876\u7b49 30 \u5929\uff0c\u53cd\u6094\u96a8\u6642\u6551\u5f97\u56de\u4f86\u3002',
    'Your storage': '\u4f60\u7684\u5bb9\u91cf',
    'Keep an eye on your space here. Free starts you at 2GB.': '\u5bb9\u91cf\u7528\u91cf\u770b\u9019\u88e1\uff0c\u514d\u8cbb\u7248\u5f9e 2GB \u958b\u59cb\u3002',
    'That\u2019s it \ud83c\udf89': '\u5c31\u9019\u6a23 \ud83c\udf89',
    'Drop your first file and see for yourself.': '\u4e1f\u7b2c\u4e00\u500b\u6a94\u6848\u4e0a\u4f86\u8a66\u8a66\u5c31\u77e5\u9053\u3002',
    'Next': '\u4e0b\u4e00\u6b65',
    'Back': '\u4e0a\u4e00\u6b65',
    'Skip': '\u8df3\u904e',
    'Done': '\u5b8c\u6210',
    'New here?': '\u7b2c\u4e00\u6b21\u7528\uff1f',
    'Replay tour': '\u91cd\u770b\u5c0e\u89bd',

    'Rename': '\u6539\u540d',
    'New filename': '\u65b0\u6a94\u540d',
    'Renamed': '\u5df2\u6539\u540d',

    'Trash': '\u5783\u573e\u6876',
    'Empty trash': '\u6e05\u7a7a\u5783\u573e\u6876',
    'Items here are deleted forever after 30 days.': '\u9019\u88e1\u7684\u6771\u897f 30 \u5929\u5f8c\u6c38\u4e45\u522a\u9664\u3002',
    'Trash is empty': '\u5783\u573e\u6876\u662f\u7a7a\u7684',
    'Restore': '\u5fa9\u539f',
    'Restored': '\u5df2\u5fa9\u539f',
    'Delete forever': '\u6c38\u4e45\u522a\u9664',
    'Delete forever? This cannot be undone.': '\u6c38\u4e45\u522a\u9664\uff1f\u9019\u500b\u52d5\u4f5c\u7121\u6cd5\u5fa9\u539f\u3002',
    'Empty trash? Everything in it is deleted forever.': '\u6e05\u7a7a\u5783\u573e\u6876\uff1f\u88e1\u9762\u6240\u6709\u6771\u897f\u90fd\u6703\u6c38\u4e45\u522a\u9664\u3002',
    'Trash emptied': '\u5783\u573e\u6876\u5df2\u6e05\u7a7a',
    'Moved to trash': '\u5df2\u79fb\u5230\u5783\u573e\u6876 \u2014 30 \u5929\u5167\u53ef\u5fa9\u539f',

    'Search filename...': '\u641c\u5c0b\u6a94\u540d...',
    'No match for': '\u627e\u4e0d\u5230',
    'Share': '\u5206\u4eab',
    'Share link copied — anyone with it can view this album': '\u5206\u4eab\u9023\u7d50\u5df2\u8907\u88fd \u2014 \u62ff\u5230\u9023\u7d50\u7684\u4eba\u90fd\u80fd\u770b\u9019\u672c\u76f8\u7c3f',

    // ── Personal-cloud repositioning (2026-10) ──
    'Start free — 2GB': '\u514d\u8cbb\u958b\u59cb \u2014 2GB',
    'See plans': '\u770b\u65b9\u6848',
    'Plans': '\u65b9\u6848',
    'Upgrade': '\u5347\u7d1a',
    // \u5bb9\u91cf\u63db\u6210\u5f35\u6578\u8207\u6642\u6578:\u6578\u5b57\u7531 src/capacity-hint.ts \u7b97,test/capacity-copy.test.mjs \u7d81\u4f4f
    '20GB \u2014 about 100,000 photos, or 10 hours of video.': '20GB\uff0c\u7d04 10 \u842c\u5f35\u7167\u7247\uff0c\u6216 10 \u5c0f\u6642\u5f71\u7247\u3002',
    'About 10,000 photos, or 1 hour of video': '\u7d04 1 \u842c\u5f35\u7167\u7247\uff0c\u6216 1 \u5c0f\u6642\u5f71\u7247',
    'About 100,000 photos, or 10 hours of video': '\u7d04 10 \u842c\u5f35\u7167\u7247\uff0c\u6216 10 \u5c0f\u6642\u5f71\u7247',
    'See Pro': '\u770b Pro \u65b9\u6848',
    'Recent uploads': '\u6700\u8fd1\u4e0a\u50b3',
    'Nothing yet — drop something!': '\u9084\u6c92\u6709\u6771\u897f \u2014 \u4e1f\u9ede\u4ec0\u9ebc\u4e0a\u4f86\u5427\uff01',
    'Start free. Upgrade when your memories outgrow it.': '\u514d\u8cbb\u958b\u59cb\u3002\u56de\u61b6\u88dd\u4e0d\u4e0b\u4e86\u518d\u5347\u7d1a\u3002',
    'Guest': '\u8a2a\u5ba2',
    'Free': '\u514d\u8cbb',
    'Instant share, no login': '\u514d\u767b\u5165\u5373\u50b3\u5373\u5206\u4eab',
    'Links expire in 7 days': '\u9023\u7d50 7 \u5929\u5f8c\u904e\u671f',
    'Password protection': '\u5bc6\u78bc\u4fdd\u8b77',
    'Just drop a file': '\u76f4\u63a5\u4e1f\u6a94\u6848',
    'No sign-up? Just drop a file to share.': '\u4e0d\u60f3\u8a3b\u518a\uff1f\u76f4\u63a5\u4e1f\u6a94\u6848\u5206\u4eab',
    'links expire in 7 days': '\u9023\u7d50 7 \u5929\u5f8c\u904e\u671f',
    'password protection': '\u5bc6\u78bc\u4fdd\u8b77',
    'Drop a file': '\u76f4\u63a5\u4e1f\u6a94',
    'Permanent links': '\u9023\u7d50\u6c38\u4e45\u6709\u6548',
    'Photo library & albums': '\u76f8\u7247\u5eab\u8207\u76f8\u7c3f',
    'Duplicate photos tidied automatically': '\u91cd\u8907\u7684\u7167\u7247\u81ea\u52d5\u6574\u7406',
    'Password & expiry controls': '\u5bc6\u78bc\u8207\u904e\u671f\u63a7\u5236',
    'Start free': '\u514d\u8cbb\u958b\u59cb',
    'Everything in Free': 'Free \u7684\u5168\u90e8\u529f\u80fd',
    '10\u00d7 the space of Free': 'Free \u7684 10 \u500d\u5bb9\u91cf',
    'Large files via chunked upload': '\u5927\u6a94\u5206\u584a\u4e0a\u50b3',
    'Launching soon — leave your email and get in first.': '\u5373\u5c07\u63a8\u51fa \u2014 \u7559\u4e0b email\uff0c\u7b2c\u4e00\u6279\u901a\u77e5\u4f60\u3002',
    'Notify me': '\u901a\u77e5\u6211',
    'You are in! We will email you when Pro launches.': '\u767b\u8a18\u6210\u529f\uff01Pro \u4e0a\u7dda\u7b2c\u4e00\u6642\u9593\u901a\u77e5\u4f60\u3002',
    'Upgrade to Pro': '升級',
    'Redirecting to secure checkout\u2026': '\u6b63\u5728\u524d\u5f80\u5b89\u5168\u7d50\u5e33\u9801\u2026',
    'You are already Pro. Cancel your subscription?': '\u4f60\u5df2\u7d93\u662f Pro\u3002\u8981\u53d6\u6d88\u8a02\u95b1\u55ce\uff1f(\u5df2\u4ed8\u671f\u9593\u4ecd\u53ef\u4f7f\u7528)',
    'Subscription cancelled \u2014 Pro stays until the end of the paid period.': '\u5df2\u53d6\u6d88\u8a02\u95b1 \u2014 Pro \u6703\u6301\u7e8c\u5230\u5df2\u4ed8\u6b3e\u671f\u9593\u7d50\u675f\u3002',
    'Registered ✓': '\u5df2\u767b\u8a18 \u2713',
    'Enter your email first': '\u5148\u8f38\u5165\u4f60\u7684 email',
    'Sign up free to upload files over 64MB.': '\u8d85\u904e 64MB \u7684\u5927\u6a94\u9700\u8981\u514d\u8cbb\u8a3b\u518a\u5f8c\u4e0a\u50b3\u3002',
    'Copy link': '\u8907\u88fd\u9023\u7d50',
    'Link copied': '\u9023\u7d50\u5df2\u8907\u88fd',
    'Password set for this upload': '\u9019\u6279\u4e0a\u50b3\u5df2\u52a0\u4e0a\u5bc6\u78bc',
    'file': '\u55ae\u6a94',
    '/mo': '/\u6708',

    // ── Hero / landing ──
    'Drop. Share. Done.': '拖曳、分享、完成。',
    'Free file sharing with password protection and auto-expiry. No signup, no limits, no tracking.':
      '免費檔案分享,支援密碼保護與自動過期。免註冊、無限制、不追蹤。',
    'Drop files here to upload': '拖曳檔案到這裡上傳',
    'or click to browse · supports folders': '或點擊瀏覽 · 支援資料夾',
    'Password': '密碼',
    'Optional': '選填',
    'Expires': '過期',
    'Never': '永不',
    'File URL': '分享連結',
    'FILE URL': '分享連結',
    'Copy': '複製',
    'COPY': '複製',
    'Open': '開啟',
    "Sending one video should not be this much work.": "傳一支影片,不該這麼麻煩。",
    "Chat apps squash your video": "聊天軟體把影片壓到糊",
    "You filmed it sharp. They get a blurry copy.": "你拍得清清楚楚,對方收到一團馬賽克。",
    "Cloud drives ask for too much": "雲端硬碟一堆步驟",
    "Create a folder, set permissions, send an invite. All that for one clip.": "開資料夾、設權限、寄邀請。只是想傳一支影片而已。",
    "Everyone has to install something": "對方還要裝 App",
    "You just wanted them to watch it. Now they are downloading an app.": "你只是想讓他看一眼,結果他要先去下載。",
    "Three steps. The third one is paste.": "三步驟,第三步是貼上。",
    "Drop it in": "丟進來",
    "Drag your file onto the page. No account, nothing to install.": "把檔案拖進頁面。不用帳號,不用安裝。",
    "Get a short link": "拿短網址",
    "The link appears the moment it finishes. Copy it or open it in a new tab.": "傳完連結馬上出現。一鍵複製,或直接開新分頁看。",
    "Paste it anywhere": "貼給任何人",
    "LINE, IG, email, a group chat. They tap it and it plays.": "LINE、IG、Email、群組都行。對方一點就播。",
    "Once you use it, you find reasons to.": "用過一次,你會一直想到它。",
    "Show a client the cut": "給客戶看樣片",
    "Send the draft as a link, not a giant attachment.": "丟連結就好,不用再塞大附件。",
    "Share with the group": "分享給群組",
    "The trip video, the game highlight, the thing you just filmed.": "出遊影片、比賽精華、剛剛拍到的那一段。",
    "Put it in your post": "放進貼文",
    "A clean short link that fits in a bio or a comment.": "短短一條,放自介、放留言都乾淨。",
    "Send it, then forget it": "傳完就不用管",
    "Pick 1 to 24 hours. When time is up, it deletes itself.": "選 1 到 24 小時,時間到自動消失。",
    "Want to keep your files?": "想留著?註冊就好。",
    "A free account keeps your files for as long as you want, with 2GB of space. Pro gives you 20GB.": "免費帳號可以一直留著,有 2GB 空間。Pro 給你 20GB。",
    "Questions": "常見問題",
    "Do I need an account?": "一定要註冊嗎?",
    "No. Without one you can upload 5 files a day, and each stays up for up to 24 hours.": "不用。不登入一天可以傳 5 部,每部最多留 24 小時。",
    "Does the other person need an app?": "對方要裝什麼嗎?",
    "No. They tap the link and watch in their browser.": "不用。點連結,用瀏覽器就能看。",
    "How big can a file be?": "檔案可以多大?",
    "Up to 64MB without an account. Sign up for larger files.": "不登入單檔 64MB。註冊後可以傳更大的檔案。",
    "Can I add a password?": "可以設密碼嗎?",
    "Yes. Set one before uploading and the page asks for it.": "可以。上傳前設定,打開連結就要輸入密碼。",
    "Can people download the file?": "別人可以下載嗎?",
    "Anyone can watch. Downloading takes a free account.": "大家都能看,下載要先免費登入。",
    "Go on, drop one in.": "現在就丟一個試試。",
    "Upload a file": "開始上傳",
    'Move to folder': '收進資料夾',
    'Album name': '相簿名稱',
    'Rename album': '重新命名相簿',
    'Share link': '分享連結',
    'Create': '建立',
    'Close': '關閉',
    'Please sign in first': '請先登入',
    'Top level': '移到最上層',
    'Moved': '已移動',
    'albums': '個相簿',
    'This album already holds other albums': '這個相簿裡已經有其他相簿,不能再收進資料夾',
    '1 hour': '1 小時',
    '3 hours': '3 小時',
    '6 hours': '6 小時',
    '12 hours': '12 小時',
    'Sign up to choose': '登入後可選',
    'Drop it, share it.': '隨手一丟就分享',
    'Short link. Super fast. Super easy.': '短網址,速度超快,超好用。',
    'No login. 5 a day, kept up to 24 hours.': '不用登入。一天 5 部,最多留 24 小時。',
    "You've used today's 5 uploads. Log in to keep going.": '今天的 5 部用完了,登入就能繼續傳。',
    'Just drop it': '隨手一丟',
    'Drag it in. No login.': '拖進來就好,不用登入。',
    'Short link': '短網址分享',
    'Get a link right away. Paste it anywhere.': '傳完馬上有連結,貼給誰都能看。',
    'Super fast': '速度超快',
    'Drop a video, share it in seconds.': '影片丟上去,馬上就能分享。',
    '1 day': '1 天',
    '7 days': '7 天',
    '30 days': '30 天',
    // ── Features ──
    'Password Protected': '密碼保護',
    'Lock files with a password. Only people you share the password with can download.':
      '用密碼鎖住檔案,只有你分享密碼的人才能下載。',
    'Auto-Expiry': '自動過期',
    'Files self-destruct after your chosen time. 1 hour, 1 day, 7 days, or 30 days.':
      '檔案會在你設定的時間後自動銷毀。1 小時、1 天、7 天或 30 天。',
    'No Signup': '免註冊',
    'Upload instantly. No account, no email, no personal data collected. Just files.':
      '即時上傳。不用帳號、不用 email、不收集個資。只有檔案。',
    // ── Nav / chrome ──
    'Dashboard →': '後台 →',
    'Login': '登入',
    'Logout': '登出',
    '← Home': '← 首頁',
    '↑ Upload': '↑ 上傳',
    'Upgrade': '升級',
    // ── Sidebar / tabs ──
    'Folders': '資料夾',
    'Photos': '照片',
    'Videos': '影片',
    'Files': '檔案',
    'Account': '帳戶',
    'Albums': '相簿',
    // ── Section headers / actions ──
    'Select all': '全選',
    'Select': '選取',
    '+ New Album': '+ 新增相簿',
    'All Photos': '所有照片',
    'Newest first': '最新在前',
    'Oldest first': '最舊在前',
    'Uploads go into': '會傳進',
    'Subscription': '訂閱',
    'Cancel any time. Pro stays until the end of the paid period.': '隨時可以取消，用到當期結束',
    'Or run your own': '也可以自己架',
    'Pokkit is open source. Host it yourself for free, with as much space as your disk has.': 'Pokkit 是開源的。自己架免費，容量看你的硬碟。',
    'View on GitHub': '到 GitHub 看',
    'Do I have to subscribe?': '一定要訂閱嗎？',
    'No. The free plan stays free.': '不用。免費方案一直免費。',
    'Can I cancel?': '可以取消嗎？',
    'Yes, any time. Pro stays until the end of the period you paid for.': '可以，隨時。已經付的那一期會用到結束。',
    'Next to LINE and Google Drive': '跟 LINE、Google 雲端硬碟比一比',
    'Pokkit': 'Pokkit',
    'LINE': 'LINE',
    'Google Drive': 'Google 雲端硬碟',
    'Steps to share': '分享要幾步',
    'Drop it in. The link is there when it finishes.': '拖進來，傳完就有連結',
    'You have to be friends or in the same group first.': '要先是好友，或在同一個群組',
    'Upload, open Share, change the access setting, copy the link.': '上傳、開共用、改存取權限、複製連結',
    'What the other person needs': '對方要準備什麼',
    'Nothing. Photos and videos open in the browser.': '什麼都不用，照片影片點開就看',
    'The LINE app.': '要裝 LINE',
    'If access was left restricted, they have to request it.': '權限沒改的話，對方要先申請存取',
    'How long it stays up': '多久會打不開',
    'Member links stay up.': '會員的連結一直有效',
    'After a while it says the storage period has ended.': '過一段時間就顯示「保存期限已過」',
    'It stays up.': '不會過期',
    'Password on a link': '連結設密碼',
    'Yes, built in': '可以',
    'Not available': '不行',
    'Choose when it expires': '自己決定什麼時候失效',
    'Yes, from 1 hour to 30 days': '可以，1 小時到 30 天',
    'Not on personal accounts': '個人帳號不行',
    'The link itself': '網址長什麼樣',
    'A short link': '短網址',
    'Stays inside the chat': '只能在聊天室裡轉傳',
    'A long string of characters': '很長一串',
    'Log in with your key': '貼上你的金鑰登入',
    'Log in': '登入',
    'That key was not accepted': '這把金鑰不對',
    'Nothing here yet': '裡面還沒有東西',
    '← Albums': '← 相簿',
    'Cleanup': '整理',
    'Rename': '重新命名',
    'Delete Album': '刪除相簿',
    'Delete': '刪除',
    'Download': '下載',
    'Cancel': '取消',
    'Clear': '清除',
    'Move to...': '搬移到…',
    'Move to Album': '搬移到相簿',
    '+ Create New Album': '+ 建立新相簿',
    // ── Account page ──
    'Storage': '儲存空間',
    'Library': '媒體庫',
    'Settings': '設定',
    'Theme': '主題',
    'Toggle': '切換',
    // ── Lightbox ──
    '✎ Note': '✎ 筆記',
    'Note': '筆記',
    'Locate': '定位',
    'Send to 拍吧': '送去拍吧',
    'Pick at least one video': '先選至少一支影片',
    'Max 20 videos at a time': '一次最多 20 支',
    'Cover': '封面',
    'Add notes...': '新增筆記…',
    // ── Swipe cleanup ──
    '← Back': '← 返回',
    'KEEP': '保留',
    'Keep': '保留',
    'DELETE': '刪除',
    '← Delete': '← 刪除',
    'Keep →': '保留 →',
    'Review Complete': '整理完成',
    'Done': '完成',
    // ── Empty states ──
    'No files yet': '還沒有檔案',
    'No albums yet': '還沒有相簿',
    'No photos yet': '還沒有照片',
    'No videos yet': '還沒有影片',
    // ── Toasts / dynamic ──
    'Deleted': '已刪除',
    'Network error': '網路錯誤',
    'Notes saved': '筆記已儲存',
    'Already backed up': '已經備份過了',
    'Copy path failed': '複製路徑失敗',
    'Copied!': '已複製!',
    'Storage full!': '空間已滿!',
    'Upload failed': '上傳失敗',
    'Server error': '伺服器錯誤',
    'Timed out': '逾時',
    'Request failed': '請求失敗',
    'Session expired, please log in again': '登入過期,請重新登入',
    'Too many requests, please wait a moment': '請求太頻繁,請稍候',
    'Please login first': '請先登入',
    'Cover set': '封面已設定',
    'Upgrade plans coming soon!': '升級方案即將推出!',
    'No media files found in folder': '資料夾裡沒有媒體檔案',
    'Not logged in': '尚未登入',
    // ── Projects (multi-tenant admin) ──
    'Projects': '專案',
    '+ New Project': '+ 新增專案',
    '← Projects': '← 專案',
    'API key — shown once': 'API 金鑰 — 只顯示一次',
    "Copy it now. Only its hash is stored; you can't see it again.":
      '現在就複製。系統只儲存雜湊值,之後無法再看到。',
    'No projects yet': '還沒有專案',
    'Rotate key': '更換金鑰',
    'Project name': '專案名稱',
    'Delete project': '刪除專案',
    'files will be permanently deleted.': '個檔案將被永久刪除。',
    'Rotate key — the old key stops working.': '更換金鑰 — 舊金鑰會立即失效。'
  };

  function getLang() {
    var stored = localStorage.getItem(LANG_KEY);
    if (stored === 'zh' || stored === 'en') return stored;
    // 沒自己選過就看瀏覽器:語言清單裡有中文就是中文使用者
    var langs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ''];
    for (var i = 0; i < langs.length; i++) {
      if (/^zh\b/i.test(langs[i])) return 'zh';
    }
    return 'en';
  }

  function t(s) {
    if (s == null) return s;
    return getLang() === 'zh' && ZH[s] ? ZH[s] : s;
  }

  function applyI18n(root) {
    root = root || document;
    var nodes = root.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    }
    var ph = root.querySelectorAll('[data-i18n-ph]');
    for (var j = 0; j < ph.length; j++) {
      ph[j].setAttribute('placeholder', t(ph[j].getAttribute('data-i18n-ph')));
    }
    var op = root.querySelectorAll('option[data-i18n-opt]');
    for (var k = 0; k < op.length; k++) {
      op[k].textContent = t(op[k].getAttribute('data-i18n-opt'));
    }
    document.documentElement.lang = getLang() === 'zh' ? 'zh-TW' : 'en';
    var togs = document.querySelectorAll('.lang-toggle');
    for (var m = 0; m < togs.length; m++) {
      togs[m].textContent = getLang() === 'zh' ? 'EN' : '中';
    }
  }

  function setLang(lang) {
    localStorage.setItem(LANG_KEY, lang === 'zh' ? 'zh' : 'en');
    applyI18n();
    document.dispatchEvent(new CustomEvent('pokkit:langchange'));
  }

  function toggleLang() {
    setLang(getLang() === 'zh' ? 'en' : 'zh');
  }

  window.t = t;
  window.getLang = getLang;
  window.setLang = setLang;
  window.applyI18n = applyI18n;
  window.toggleLang = toggleLang;

  function wireToggles() {
    var togs = document.querySelectorAll('.lang-toggle');
    for (var i = 0; i < togs.length; i++) {
      togs[i].addEventListener('click', toggleLang);
    }
  }

  // 邊解析邊翻譯,中文使用者才不會先看到一閃而過的英文。
  // app.js 接手前要停:它之後會自己改部分文字,不能再被蓋回去。
  if (document.readyState === 'loading') {
    // 翻譯本身也會改 DOM:一定要先停止監聽再翻譯,否則會自己觸發自己,整頁卡死
    var parseObserver = new MutationObserver(function () {
      parseObserver.disconnect();
      applyI18n();
      if (!finished) parseObserver.observe(document.documentElement, { childList: true, subtree: true });
    });
    parseObserver.observe(document.documentElement, { childList: true, subtree: true });
    var finished = false;
    window.__i18nFinish = function () {
      if (finished) return;
      finished = true;
      parseObserver.disconnect();
      applyI18n();
      wireToggles();
    };
    document.addEventListener('DOMContentLoaded', window.__i18nFinish);
  } else {
    applyI18n();
    wireToggles();
  }
})();
