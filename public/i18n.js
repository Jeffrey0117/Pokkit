/* Pokkit i18n — English is the key; this maps to 繁體中文.
   Static UI uses [data-i18n]; dynamic strings go through window.t(). */
(function () {
  'use strict';
  var LANG_KEY = 'pokkit_lang';

  var ZH = {
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
