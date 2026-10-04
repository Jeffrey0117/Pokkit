/* Pokkit i18n — English is the key; this maps to 繁體中文.
   Static UI uses [data-i18n]; dynamic strings go through window.t(). */
(function () {
  'use strict';
  var LANG_KEY = 'pokkit_lang';

  var ZH = {
    'Search filename...': '\u641c\u5c0b\u6a94\u540d...',
    'No match for': '\u627e\u4e0d\u5230',
    'Share': '\u5206\u4eab',
    'Share link copied — anyone with it can view this album': '\u5206\u4eab\u9023\u7d50\u5df2\u8907\u88fd \u2014 \u62ff\u5230\u9023\u7d50\u7684\u4eba\u90fd\u80fd\u770b\u9019\u672c\u76f8\u7c3f',

    // ── Personal-cloud repositioning (2026-10) ──
    'Your files, somewhere you trust.': '\u4f60\u7684\u6a94\u6848\uff0c\u653e\u5728\u4f60\u4fe1\u5f97\u904e\u7684\u5730\u65b9\u3002',
    'Back up photos and videos in original quality. No scanning, no AI training, no selling your data. 2GB free.': '\u539f\u756b\u8cea\u4fdd\u5b58\u7167\u7247\u8207\u5f71\u7247\u3002\u4e0d\u6383\u63cf\u3001\u4e0d\u8a13\u7df4 AI\u3001\u4e0d\u8ce3\u4f60\u7684\u6578\u64da\u3002\u514d\u8cbb 2GB \u8d77\u3002',
    'Start free — 2GB': '\u514d\u8cbb\u958b\u59cb \u2014 2GB',
    'See plans': '\u770b\u65b9\u6848',
    'Instant share, no login — files expire in 7 days. Sign up free to keep them.': '\u514d\u767b\u5165\u5feb\u50b3 \u2014 \u6a94\u6848 7 \u5929\u5f8c\u81ea\u52d5\u904e\u671f\u3002\u514d\u8cbb\u8a3b\u518a\u5373\u53ef\u6c38\u4e45\u4fdd\u5b58\u3002',
    'Original Quality': '\u539f\u756b\u8cea\u4fdd\u5b58',
    'No compression games. What you upload is exactly what you get back.': '\u4e0d\u5077\u58d3\u7e2e\u3002\u4f60\u50b3\u4ec0\u9ebc\uff0c\u62ff\u56de\u4f86\u5c31\u662f\u4ec0\u9ebc\u3002',
    'Albums & Sharing': '\u76f8\u7c3f\u8207\u5206\u4eab',
    'Organize into albums, share with one link. Password and auto-expiry when you want them.': '\u6574\u7406\u6210\u76f8\u7c3f\u3001\u4e00\u689d\u9023\u7d50\u5206\u4eab\u3002\u8981\u5bc6\u78bc\u6709\u5bc6\u78bc\u3001\u8981\u904e\u671f\u6709\u904e\u671f\u3002',
    'Private by Design': '\u96b1\u79c1\u81f3\u4e0a',
    'Your files live on our own server. No scanning, no AI training, no data resale.': '\u6a94\u6848\u653e\u5728\u81ea\u5bb6\u4f3a\u670d\u5668\u3002\u4e0d\u6383\u63cf\u5167\u5bb9\u3001\u4e0d\u8a13\u7df4 AI\u3001\u4e0d\u8f49\u8ce3\u6578\u64da\u3002',
    'Plans': '\u65b9\u6848',
    'Upgrade': '\u5347\u7d1a',
    '100GB storage, 4K video in original quality, large files.': '100GB \u5bb9\u91cf\u30014K \u5f71\u7247\u539f\u756b\u8cea\u3001\u5927\u6a94\u4e0a\u50b3\u3002',
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
    'Permanent links': '\u9023\u7d50\u6c38\u4e45\u6709\u6548',
    'Photo library & albums': '\u76f8\u7247\u5eab\u8207\u76f8\u7c3f',
    'Original-quality backup': '\u539f\u756b\u8cea\u5099\u4efd',
    'Password & expiry controls': '\u5bc6\u78bc\u8207\u904e\u671f\u63a7\u5236',
    'Start free': '\u514d\u8cbb\u958b\u59cb',
    'Everything in Free': 'Free \u7684\u5168\u90e8\u529f\u80fd',
    '4K video, original quality': '4K \u5f71\u7247\u539f\u756b\u8cea',
    'Large files via chunked upload': '\u5927\u6a94\u5206\u584a\u4e0a\u50b3',
    'Priority processing': '\u512a\u5148\u8f49\u6a94',
    'Launching soon — leave your email and get in first.': '\u5373\u5c07\u63a8\u51fa \u2014 \u7559\u4e0b email\uff0c\u7b2c\u4e00\u6279\u901a\u77e5\u4f60\u3002',
    'Notify me': '\u901a\u77e5\u6211',
    'You are in! We will email you when Pro launches.': '\u767b\u8a18\u6210\u529f\uff01Pro \u4e0a\u7dda\u7b2c\u4e00\u6642\u9593\u901a\u77e5\u4f60\u3002',
    'Registered ✓': '\u5df2\u767b\u8a18 \u2713',
    'Enter your email first': '\u5148\u8f38\u5165\u4f60\u7684 email',
    'Sign up free to upload files over 64MB.': '\u8d85\u904e 64MB \u7684\u5927\u6a94\u9700\u8981\u514d\u8cbb\u8a3b\u518a\u5f8c\u4e0a\u50b3\u3002',
    'Copy link': '\u8907\u88fd\u9023\u7d50',
    'Link copied': '\u9023\u7d50\u5df2\u8907\u88fd',
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
    '1 hour': '1 小時',
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
    'Drop photos here or click to upload': '拖曳照片到這裡或點擊上傳',
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
    return localStorage.getItem(LANG_KEY) === 'zh' ? 'zh' : 'en';
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { applyI18n(); wireToggles(); });
  } else {
    applyI18n();
    wireToggles();
  }
})();
