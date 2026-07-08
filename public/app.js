(function () {
  'use strict';

  var MAX_CONCURRENT = 10;
  var MAX_UPLOAD_RETRIES = 3; // auto-retry transient failures (network / 5xx) before giving up

  // ── DOM ─────────────────────────────────────────────────
  var $storageQuota = document.getElementById('storageQuota');
  var $quotaText = document.getElementById('quotaText');
  var $quotaTier = document.getElementById('quotaTier');
  var $quotaFill = document.getElementById('quotaFill');
  var $upgradeBtn = document.getElementById('upgradeBtn');
  var $userName = document.getElementById('userName');
  var $loginBtn = document.getElementById('loginBtn');
  var $logoutBtn = document.getElementById('logoutBtn');
  var $dropzone = document.getElementById('dropzone');
  var $fileInput = document.getElementById('fileInput');
  var $passwordInput = document.getElementById('passwordInput');
  var $expirySelect = document.getElementById('expirySelect');
  var $queueSection = document.getElementById('queueSection');
  var $queueList = document.getElementById('queueList');
  var $fileList = document.getElementById('fileList');
  var $emptyState = document.getElementById('emptyState');
  var $toast = document.getElementById('toast');
  var $dlBar = document.getElementById('dlBar');
  var $dlCount = document.getElementById('dlCount');
  var $dlDownload = document.getElementById('dlDownload');
  var $dlClear = document.getElementById('dlClear');
  var $selectAllFiles = document.getElementById('selectAllFiles');

  // ── Albums/Gallery DOM ──────────────────────────────────
  var $viewTabs = document.getElementById('viewTabs');
  var $filesSection = document.getElementById('filesSection');
  var $albumsSection = document.getElementById('albumsSection');
  var $albumGrid = document.getElementById('albumGrid');
  var $newAlbumBtn = document.getElementById('newAlbumBtn');
  var $gallerySection = document.getElementById('gallerySection');
  var $galleryTitle = document.getElementById('galleryTitle');
  var $galleryDropzone = document.getElementById('galleryDropzone');
  var $photoGrid = document.getElementById('photoGrid');
  var $backToAlbums = document.getElementById('backToAlbums');
  var $lightbox = document.getElementById('lightbox');
  var $lightboxImg = document.getElementById('lightboxImg');
  var $lightboxVideo = document.getElementById('lightboxVideo');
  var $lightboxInfo = document.getElementById('lightboxInfo');
  var $lightboxClose = document.getElementById('lightboxClose');
  var $lightboxPrev = document.getElementById('lightboxPrev');
  var $lightboxNext = document.getElementById('lightboxNext');
  var $lightboxDelete = document.getElementById('lightboxDelete');
  var $lightboxCover = document.getElementById('lightboxCover');
  var $lightboxDownload = document.getElementById('lightboxDownload');
  var $lightboxLocate = document.getElementById('lightboxLocate');
  var $lightboxCounter = document.getElementById('lightboxCounter');
  var $lightboxFilename = document.getElementById('lightboxFilename');
  var $lightboxNotes = document.getElementById('lightboxNotes');
  var $lightboxNotesDisplay = document.getElementById('lightboxNotesDisplay');
  var $lightboxNotesEdit = document.getElementById('lightboxNotesEdit');
  var $lightboxNoteToggle = document.getElementById('lightboxNoteToggle');
  var $galleryCount = document.getElementById('galleryCount');
  var $galleryRename = document.getElementById('galleryRename');
  var $galleryDelete = document.getElementById('galleryDelete');
  var $galleryCleanup = document.getElementById('galleryCleanup');
  var $gallerySelect = document.getElementById('gallerySelect');

  // ── Photos (All) DOM ──────────────────────────────────
  var $photosSection = document.getElementById('photosSection');
  var $allPhotoGrid = document.getElementById('allPhotoGrid');
  var $allPhotosSelect = document.getElementById('allPhotosSelect');

  // ── Videos DOM ──────────────────────────────────────
  var $videosSection = document.getElementById('videosSection');
  var $videoGrid = document.getElementById('videoGrid');
  var $videoSelectToggle = document.getElementById('videoSelectToggle');
  var videoSelectMode = false;

  // ── Thumbnail fade-in ───────────────────────────────
  // Drop the skeleton shimmer + fade a thumbnail in once it loads. `load` and
  // `error` don't bubble, so listen in the capture phase on the grid container —
  // this catches every <img.loading=lazy> no matter which function created it.
  function markThumbLoaded(e) {
    var img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    img.classList.add('loaded');
    var cell = img.closest ? img.closest('.photo-cell') : null;
    if (cell) cell.classList.add('loaded');
  }
  [$photoGrid, $allPhotoGrid, $videoGrid].forEach(function (grid) {
    if (!grid) return;
    grid.addEventListener('load', markThumbLoaded, true);
    grid.addEventListener('error', markThumbLoaded, true); // broken thumb: stop shimmering too
  });

  // Placeholder skeleton cells, shown the instant a tab is opened so the grid
  // shimmers while the list request is still in flight (instead of a blank gap).
  // Cleared once the first page of real data arrives.
  var SKELETON_COUNT = 18;
  function fillGridSkeletons(container) {
    if (!container) return;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < SKELETON_COUNT; i++) {
      var c = document.createElement('div');
      c.className = 'photo-cell skeleton-cell';
      frag.appendChild(c);
    }
    container.appendChild(frag);
  }
  function clearGridSkeletons(container) {
    if (!container) return;
    var nodes = container.querySelectorAll('.skeleton-cell');
    for (var i = 0; i < nodes.length; i++) nodes[i].remove();
  }
  var videoLongPressed = false;

  // ── Theme DOM ──────────────────────────────────────
  var $themeToggle = document.getElementById('themeToggle');
  var $themeLight = document.getElementById('themeLight');
  var $themeDark = document.getElementById('themeDark');
  var $metaThemeColor = document.getElementById('metaThemeColor');

  // ── Selection DOM ─────────────────────────────────────
  var $selectionBar = document.getElementById('selectionBar');
  var $selectionCount = document.getElementById('selectionCount');
  var $selectionMove = document.getElementById('selectionMove');
  var $selectionDownload = document.getElementById('selectionDownload');
  var $selectionCancel = document.getElementById('selectionCancel');
  var $albumPicker = document.getElementById('albumPicker');
  var $albumPickerOverlay = document.getElementById('albumPickerOverlay');
  var $albumPickerList = document.getElementById('albumPickerList');
  var $albumPickerNew = document.getElementById('albumPickerNew');

  // ── Swipe Mode DOM ──────────────────────────────────────
  var $swipeMode = document.getElementById('swipeMode');
  var $swipeClose = document.getElementById('swipeClose');
  var $swipeProgress = document.getElementById('swipeProgress');
  var $swipeStage = document.getElementById('swipeStage');
  var $swipeCard = document.getElementById('swipeCard');
  var $swipeImg = document.getElementById('swipeImg');
  var $swipeVideo = document.getElementById('swipeVideo');
  var $swipeNext = document.getElementById('swipeNext');
  var $swipeNextImg = document.getElementById('swipeNextImg');
  var $swipeStampKeep = document.getElementById('swipeStampKeep');
  var $swipeStampDelete = document.getElementById('swipeStampDelete');
  var $swipeHint = document.getElementById('swipeHint');
  var $swipeActions = document.getElementById('swipeActions');
  var $swipeBtnDelete = document.getElementById('swipeBtnDelete');
  var $swipeBtnKeep = document.getElementById('swipeBtnKeep');
  var $swipeSummary = document.getElementById('swipeSummary');
  var $swipeSummaryStats = document.getElementById('swipeSummaryStats');
  var $swipeSummaryDone = document.getElementById('swipeSummaryDone');

  // ── State ───────────────────────────────────────────────
  var uploading = 0;
  var pending = [];
  var batchTotal = 0;
  var batchDone = 0;
  var batchFailed = 0;
  var batchBytes = 0;
  var batchStartTime = 0;
  var SUMMARY_THRESHOLD = 20;
  var toastTimer = null;
  var currentTab = 'files';
  var currentAlbumId = null;
  var currentAlbumName = '';
  var galleryPhotos = [];
  var lightboxIndex = -1;
  var processingIds = {};   // id -> true, set of photos/videos still processing
  var processingTimer = null;
  var currentUser = null;
  var selectMode = false;
  var selectedIds = [];
  var allPhotos = [];
  var allPhotosAlbumMap = {};

  // ── Infinite scroll state ──────────────────────────────
  var filesOffset = 0;
  var filesLoading = false;
  var filesHasMore = true;
  var filesScrollLoader = null;
  var FILES_PAGE_SIZE = 30;

  var allPhotosOffset = 0;
  var allPhotosLoading = false;
  var allPhotosHasMore = true;
  var allPhotosScrollLoader = null;
  var ALL_PHOTOS_PAGE_SIZE = 40;

  var galleryOffset = 0;
  var galleryLoading = false;
  var galleryHasMore = true;
  var galleryScrollLoader = null;
  var GALLERY_PAGE_SIZE = 40;

  // ── Theme ──────────────────────────────────────────────
  var STORAGE_THEME_KEY = 'pokkit_theme';

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    if ($metaThemeColor) {
      $metaThemeColor.setAttribute('content', theme === 'light' ? '#ffffff' : '#030303');
    }
    if ($themeLight && $themeDark) {
      $themeLight.classList.toggle('active', theme === 'light');
      $themeDark.classList.toggle('active', theme === 'dark');
    }
    var lmuScript = document.querySelector('script[data-app-id]');
    if (lmuScript) {
      lmuScript.setAttribute('data-theme', theme);
      lmuScript.setAttribute(
        'data-accent',
        theme === 'light' ? '#18181b' : '#ffffff',
      );
    }
  }

  (function initTheme() {
    var saved = localStorage.getItem(STORAGE_THEME_KEY) || 'light';
    applyTheme(saved);
  })();

  if ($themeToggle) {
    $themeToggle.addEventListener('click', function () {
      var current = document.documentElement.dataset.theme || 'light';
      var next = current === 'light' ? 'dark' : 'light';
      localStorage.setItem(STORAGE_THEME_KEY, next);
      applyTheme(next);
    });
  }

  // ── Videos State ──────────────────────────────────────
  var videosData = [];
  var videosOffset = 0;
  var videosLoading = false;
  var videosHasMore = true;
  var videosScrollLoader = null;
  var VIDEOS_PAGE_SIZE = 40;

  // ── Auth (LetMeUse) ───────────────────────────────────
  var STORAGE_TOKEN_KEY = 'pokkit_token';
  var STORAGE_USER_KEY = 'pokkit_user';

  function getToken() {
    // Prefer SDK token (freshest), fallback to our cached copy
    if (typeof letmeuse !== 'undefined') {
      var sdkToken = letmeuse.getToken();
      if (sdkToken) {
        localStorage.setItem(STORAGE_TOKEN_KEY, sdkToken);
        return sdkToken;
      }
    }
    return localStorage.getItem(STORAGE_TOKEN_KEY);
  }

  function saveAuthLocally(user) {
    if (user) {
      localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_USER_KEY);
      localStorage.removeItem(STORAGE_TOKEN_KEY);
    }
  }

  function loadCachedUser() {
    try {
      var data = localStorage.getItem(STORAGE_USER_KEY);
      return data ? JSON.parse(data) : null;
    } catch (_) { return null; }
  }

  function setAuthHeader(xhr) {
    var token = getToken();
    if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
  }

  function updateAuthUI() {
    var name = currentUser ? (currentUser.name || currentUser.email || '') : '';
    var loggedIn = !!currentUser;
    // Sidebar + landing nav (same state, two places)
    var unLanding = document.getElementById('userNameLanding');
    var loginL = document.getElementById('loginBtnLanding');
    var logoutL = document.getElementById('logoutBtnLanding');
    $userName.textContent = name;
    if (unLanding) unLanding.textContent = name;
    $loginBtn.hidden = loggedIn;
    $logoutBtn.hidden = !loggedIn;
    if (loginL) loginL.hidden = loggedIn;
    if (logoutL) logoutL.hidden = !loggedIn;
    if (loggedIn) {
      $dropzone.style.display = '';
      document.getElementById('uploadOptions').style.display = '';
    } else {
      $dropzone.style.display = 'none';
      document.getElementById('uploadOptions').style.display = 'none';
      $storageQuota.hidden = true;
    }
  }

  $loginBtn.addEventListener('click', function () {
    if (typeof letmeuse !== 'undefined') {
      letmeuse.login();
    } else {
      toast('Login service loading...');
    }
  });

  $logoutBtn.addEventListener('click', function () {
    if (typeof letmeuse !== 'undefined') {
      letmeuse.logout();
    }
    currentUser = null;
    saveAuthLocally(null);
    updateAuthUI();
    toast('Logged out');
  });

  function waitForLetMeUse() {
    return new Promise(function (resolve) {
      if (typeof letmeuse !== 'undefined') { resolve(); return; }
      var check = setInterval(function () {
        if (typeof letmeuse !== 'undefined') { clearInterval(check); resolve(); }
      }, 100);
      setTimeout(function () { clearInterval(check); resolve(); }, 5000);
    });
  }

  // ── Helpers ─────────────────────────────────────────────
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  function formatDate(ts) {
    var d = new Date(typeof ts === 'number' ? ts : ts);
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function getExt(mime) {
    if (!mime) return 'file';
    if (mime.startsWith('image/')) return 'img';
    if (mime.startsWith('video/')) return 'vid';
    if (mime.startsWith('audio/')) return 'aud';
    if (mime.includes('pdf')) return 'pdf';
    if (mime.includes('zip') || mime.includes('tar') || mime.includes('gz') || mime.includes('rar')) return 'zip';
    if (mime.includes('json')) return 'json';
    if (mime.includes('text') || mime.includes('xml')) return 'txt';
    return 'file';
  }

  function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '';
    var m = Math.floor(seconds / 60);
    var s = seconds % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function isVideoEntry(entry) {
    return entry.media_type === 'video' ||
      (entry.mime && entry.mime.startsWith('video/'));
  }

  // ── Toast ───────────────────────────────────────────────
  function toast(msg, isError) {
    $toast.textContent = window.t ? window.t(msg) : msg;
    $toast.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      $toast.className = 'toast';
    }, 2500);
  }

  // ── Clipboard ───────────────────────────────────────────
  function copyUrl(url) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        toast('Copied!');
      }).catch(function () { fallbackCopy(url); });
    } else {
      fallbackCopy(url);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast('Copied!');
    } catch (_) {
      toast('Copy failed', true);
    }
    document.body.removeChild(ta);
  }

  // ── Multi-select download (Files tab) ──────────────────
  var selectedFiles = {}; // id -> filename

  function updateSelectionBar() {
    var ids = Object.keys(selectedFiles);
    if (!$dlBar) return;
    if (ids.length > 0) {
      $dlBar.hidden = false;
      $dlCount.textContent = ids.length + ' selected';
    } else {
      $dlBar.hidden = true;
    }
    // keep the "select all" box in sync with what's visible
    if ($selectAllFiles) {
      var boxes = $fileList ? $fileList.querySelectorAll('.file-checkbox') : [];
      var allChecked = boxes.length > 0;
      for (var i = 0; i < boxes.length; i++) { if (!boxes[i].checked) { allChecked = false; break; } }
      $selectAllFiles.checked = allChecked;
    }
  }

  function clearSelection() {
    selectedFiles = {};
    if ($fileList) {
      var boxes = $fileList.querySelectorAll('.file-checkbox');
      for (var i = 0; i < boxes.length; i++) { boxes[i].checked = false; }
    }
    if ($videoGrid) {
      var vcells = $videoGrid.querySelectorAll('.photo-cell');
      for (var k = 0; k < vcells.length; k++) {
        vcells[k].classList.remove('selected');
        var cb = vcells[k].querySelector('.cell-checkbox');
        if (cb) cb.checked = false;
      }
    }
    if ($selectAllFiles) $selectAllFiles.checked = false;
    updateSelectionBar();
  }

  function setVideoSelectMode(on) {
    videoSelectMode = on;
    if ($videoGrid) $videoGrid.classList.toggle('select-mode', on);
    if ($videoSelectToggle) $videoSelectToggle.textContent = on ? 'Done' : 'Select';
    if (!on) clearSelection();
  }

  function triggerDownload(id, filename) {
    var a = document.createElement('a');
    a.href = '/f/' + id + '?dl=1';
    a.setAttribute('download', filename || '');
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { if (a.parentNode) document.body.removeChild(a); }, 2000);
  }

  function downloadSelected() {
    var ids = Object.keys(selectedFiles);
    if (!ids.length) return;
    toast('Downloading ' + ids.length + ' file' + (ids.length === 1 ? '' : 's') + '…');
    // Stagger so the browser doesn't drop/block rapid-fire downloads
    ids.forEach(function (id, i) {
      var name = selectedFiles[id];
      setTimeout(function () { triggerDownload(id, name); }, i * 600);
    });
  }

  if ($dlDownload) $dlDownload.addEventListener('click', downloadSelected);
  if ($dlClear) $dlClear.addEventListener('click', clearSelection);
  if ($videoSelectToggle) {
    $videoSelectToggle.addEventListener('click', function () {
      setVideoSelectMode(!videoSelectMode);
    });
  }

  // Long-press a video cell to enter select mode (parity with Photos)
  if ($videoGrid) {
    var videoLongPressTimer = null;
    $videoGrid.addEventListener('pointerdown', function (e) {
      var cell = e.target.closest('.photo-cell');
      if (!cell) return;
      videoLongPressed = false;
      videoLongPressTimer = setTimeout(function () {
        videoLongPressed = true;
        if (!videoSelectMode) setVideoSelectMode(true);
        var cb = cell.querySelector('.cell-checkbox');
        if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
      }, 500);
    });
    var cancelVideoLongPress = function () { clearTimeout(videoLongPressTimer); };
    $videoGrid.addEventListener('pointerup', cancelVideoLongPress);
    $videoGrid.addEventListener('pointerleave', cancelVideoLongPress);
    $videoGrid.addEventListener('pointermove', cancelVideoLongPress);
  }
  if ($selectAllFiles) {
    $selectAllFiles.addEventListener('change', function () {
      var boxes = $fileList ? $fileList.querySelectorAll('.file-checkbox') : [];
      for (var i = 0; i < boxes.length; i++) {
        var box = boxes[i];
        box.checked = $selectAllFiles.checked;
        var row = box.closest('.file-row');
        var id = row ? row.dataset.id : null;
        if (!id) continue;
        if (box.checked) { selectedFiles[id] = box.dataset.filename || ''; }
        else { delete selectedFiles[id]; }
      }
      updateSelectionBar();
    });
  }

  // ── Host-local file locating (server machine only) ─────
  function isLocalhost() {
    var h = window.location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '';
  }

  function revealFile(id, btn) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/files/' + id + '/reveal');
    setAuthHeader(xhr);
    if (btn) btn.disabled = true;
    xhr.addEventListener('load', function () {
      if (btn) btn.disabled = false;
      toast(xhr.status === 200 ? 'Opened in file manager' : 'Locate failed (host only)', xhr.status !== 200);
    });
    xhr.addEventListener('error', function () {
      if (btn) btn.disabled = false;
      toast('Locate failed', true);
    });
    xhr.send();
  }

  function copyLocalPath(id) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/files/' + id + '/local-path');
    setAuthHeader(xhr);
    xhr.addEventListener('load', function () {
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          if (data && data.path) { copyUrl(data.path); return; }
        } catch (_) {}
        toast('Copy path failed', true);
      } else {
        toast('Path unavailable (host only)', true);
      }
    });
    xhr.addEventListener('error', function () { toast('Copy path failed', true); });
    xhr.send();
  }

  // ── Drop Zone Events ───────────────────────────────────
  $dropzone.addEventListener('click', function () {
    if (!currentUser) { toast('Please login first', true); return; }
    $fileInput.click();
  });

  $dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!currentUser) { toast('Please login first', true); return; }
      $fileInput.click();
    }
  });

  $fileInput.addEventListener('change', function () {
    if ($fileInput.files.length > 0) {
      handleFiles($fileInput.files);
      $fileInput.value = '';
    }
  });

  $dropzone.addEventListener('dragover', function (e) {
    e.preventDefault();
    $dropzone.classList.add('dragover');
  });

  $dropzone.addEventListener('dragleave', function () {
    $dropzone.classList.remove('dragover');
  });

  $dropzone.addEventListener('drop', function (e) {
    e.preventDefault();
    $dropzone.classList.remove('dragover');
    if (!currentUser) { toast('Please login first', true); return; }
    handleDrop(e.dataTransfer);
  });

  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) { e.preventDefault(); });

  // ── Gallery Dropzone ──────────────────────────────────
  $galleryDropzone.addEventListener('click', function () {
    if (!currentUser) { toast('Please login first', true); return; }
    $fileInput.click();
  });

  $galleryDropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!currentUser) { toast('Please login first', true); return; }
      $fileInput.click();
    }
  });

  $galleryDropzone.addEventListener('dragover', function (e) {
    e.preventDefault();
    $galleryDropzone.classList.add('dragover');
  });

  $galleryDropzone.addEventListener('dragleave', function () {
    $galleryDropzone.classList.remove('dragover');
  });

  $galleryDropzone.addEventListener('drop', function (e) {
    e.preventDefault();
    $galleryDropzone.classList.remove('dragover');
    if (!currentUser) { toast('Please login first', true); return; }
    handleDrop(e.dataTransfer);
  });

  // ── Folder Reading ─────────────────────────────────────
  var MEDIA_EXTS = /\.(jpe?g|png|webp|heic|heif|avif|gif|mp4|mov|avi|webm|mkv|m4v|3gp)$/i;

  function readEntriesRecursive(entry, topLevel) {
    return new Promise(function (resolve) {
      if (entry.isFile) {
        entry.file(function (f) {
          // Directly-dropped files: accept anything (PDFs, docs, zips…).
          // Files found *inside* a dropped folder: media only, so a folder
          // drag doesn't slurp junk (.DS_Store, Thumbs.db, etc.).
          resolve(topLevel || MEDIA_EXTS.test(f.name) ? [f] : []);
        }, function () { resolve([]); });
      } else if (entry.isDirectory) {
        var reader = entry.createReader();
        var allEntries = [];
        (function readBatch() {
          reader.readEntries(function (entries) {
            if (entries.length === 0) {
              Promise.all(allEntries.map(function (e) { return readEntriesRecursive(e, false); }))
                .then(function (results) {
                  resolve([].concat.apply([], results));
                });
            } else {
              allEntries = allEntries.concat(Array.from(entries));
              readBatch();
            }
          }, function () { resolve([]); });
        })();
      } else {
        resolve([]);
      }
    });
  }

  function handleDrop(dataTransfer) {
    var items = dataTransfer.items;
    if (!items || !items.length) {
      if (dataTransfer.files.length > 0) handleFiles(dataTransfer.files);
      return;
    }
    var entries = [];
    for (var i = 0; i < items.length; i++) {
      var entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
    if (entries.length === 0) {
      if (dataTransfer.files.length > 0) handleFiles(dataTransfer.files);
      return;
    }
    Promise.all(entries.map(function (e) { return readEntriesRecursive(e, true); })).then(function (results) {
      var files = [].concat.apply([], results);
      if (files.length > 0) handleFiles(files);
      else toast('No media files found in folder');
    });
  }

  // ── Upload ──────────────────────────────────────────────
  var DEDUP_MAX_BYTES = 2 * 1024 * 1024 * 1024; // above 2GB skip pre-hash, just upload

  function handleFiles(fileList) {
    var files = Array.isArray(fileList) ? fileList : Array.from(fileList);
    if (files.length === 0) return;
    // Skip re-uploading files the user already has (matched by content hash) —
    // saves the whole transfer instead of finding out server-side after upload.
    if (files.length > 20) toast('Checking ' + files.length + ' files for duplicates…');
    dedupePreCheck(files, function (toUpload, skipped) {
      if (skipped > 0) {
        toast(skipped + ' duplicate' + (skipped > 1 ? 's' : '') + ' skipped — already uploaded');
      }
      if (toUpload.length > 0) queueFiles(toUpload);
    });
  }

  function queueFiles(files) {
    $queueSection.hidden = false;
    // Init batch counters if starting fresh
    if (pending.length === 0 && uploading === 0) {
      batchTotal = 0;
      batchDone = 0;
      batchFailed = 0;
      batchBytes = 0;
      batchStartTime = Date.now();
    }
    batchTotal += files.length;
    for (var i = 0; i < files.length; i++) pending.push(files[i]);
    updateQueueSummary();
    processQueue();
  }

  // SHA-256 of a File as hex (matches the server's content hash). Calls cb(null)
  // when hashing isn't possible (no Web Crypto / insecure context / file too big).
  function sha256Hex(file, cb) {
    if (!window.crypto || !window.crypto.subtle || !file.arrayBuffer || file.size > DEDUP_MAX_BYTES) {
      cb(null);
      return;
    }
    file.arrayBuffer()
      .then(function (buf) { return crypto.subtle.digest('SHA-256', buf); })
      .then(function (digest) {
        var b = new Uint8Array(digest), hex = '';
        for (var i = 0; i < b.length; i++) hex += b[i].toString(16).padStart(2, '0');
        cb(hex);
      })
      .catch(function () { cb(null); });
  }

  // Hash all files (limited concurrency), ask the server which already exist,
  // then split into [toUpload, skippedCount]. On any failure, upload everything.
  function dedupePreCheck(files, done) {
    if (!window.crypto || !window.crypto.subtle) { done(files, 0); return; }
    var hashes = new Array(files.length);
    var idx = 0, active = 0, completed = 0;
    function pump() {
      while (active < 4 && idx < files.length) {
        (function (i) {
          active++;
          sha256Hex(files[i], function (h) {
            hashes[i] = h; active--; completed++;
            if (completed === files.length) finish();
            else pump();
          });
        })(idx++);
      }
    }
    function finish() {
      var toQuery = [];
      for (var i = 0; i < files.length; i++) if (hashes[i]) toQuery.push(hashes[i]);
      if (toQuery.length === 0) { done(files, 0); return; }
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/check-hashes');
      setAuthHeader(xhr);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.addEventListener('load', function () {
        var existing = {};
        if (xhr.status >= 200 && xhr.status < 300) {
          try { existing = (JSON.parse(xhr.responseText) || {}).existing || {}; } catch (_) { /* */ }
        }
        var toUpload = [], skipped = 0;
        for (var i = 0; i < files.length; i++) {
          if (hashes[i] && existing[hashes[i]]) skipped++;
          else toUpload.push(files[i]);
        }
        done(toUpload, skipped);
      });
      xhr.addEventListener('error', function () { done(files, 0); });
      xhr.send(JSON.stringify({ hashes: toQuery }));
    }
    pump();
  }

  function updateQueueSummary() {
    var $summary = document.getElementById('queueSummary');
    if (batchTotal <= SUMMARY_THRESHOLD) {
      if ($summary) $summary.hidden = true;
      return;
    }
    if (!$summary) {
      $summary = document.createElement('div');
      $summary.id = 'queueSummary';
      $summary.className = 'queue-summary';
      $queueSection.insertBefore($summary, $queueList);
    }
    $summary.hidden = false;
    // Hide individual items in summary mode
    $queueList.hidden = true;
    var elapsed = (Date.now() - batchStartTime) / 1000 || 1;
    var speed = batchBytes / elapsed;
    var finished = batchDone + batchFailed;
    var pct = batchTotal > 0 ? Math.round((finished / batchTotal) * 100) : 0;
    $summary.innerHTML =
      '<div class="queue-summary-text">' +
        'Uploading ' + finished + ' / ' + batchTotal.toLocaleString() +
        (batchFailed > 0 ? ' <span class="queue-summary-fail">(' + batchFailed + ' failed)</span>' : '') +
        ' &middot; ' + formatBytes(Math.round(speed)) + '/s' +
      '</div>' +
      '<div class="queue-summary-bar"><div class="queue-summary-fill" style="width:' + pct + '%"></div></div>';
    if (finished >= batchTotal) {
      $summary.innerHTML =
        '<div class="queue-summary-text queue-summary-done">' +
          'Done! ' + batchDone + ' uploaded' +
          (batchFailed > 0 ? ', ' + batchFailed + ' failed' : '') +
        '</div>';
      setTimeout(function () {
        $summary.hidden = true;
        $queueList.hidden = false;
        $queueSection.hidden = true;
      }, 3000);
    }
  }

  function processQueue() {
    while (uploading < MAX_CONCURRENT && pending.length > 0) {
      uploadFile(pending.shift());
    }
  }

  function uploadFile(file, attempt) {
    attempt = attempt || 0;
    uploading++;
    var inSummaryMode = batchTotal > SUMMARY_THRESHOLD;

    var row = document.createElement('div');
    row.className = 'queue-item';
    if (inSummaryMode) row.hidden = true;

    var name = document.createElement('span');
    name.className = 'queue-name';
    name.textContent = file.name;

    var size = document.createElement('span');
    size.className = 'queue-size';
    size.textContent = formatBytes(file.size);

    var progWrap = document.createElement('div');
    progWrap.className = 'queue-progress';
    var bar = document.createElement('div');
    bar.className = 'queue-bar';
    progWrap.appendChild(bar);

    var pct = document.createElement('span');
    pct.className = 'queue-pct';
    pct.textContent = attempt > 0 ? 'retry ' + attempt : '0%';

    row.appendChild(name);
    row.appendChild(size);
    row.appendChild(progWrap);
    row.appendChild(pct);
    $queueList.appendChild(row);

    // Schedule an automatic retry with exponential backoff for transient failures.
    // Returns true if a retry was scheduled (caller should NOT count a failure yet).
    function autoRetry() {
      if (attempt >= MAX_UPLOAD_RETRIES) return false;
      var delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      uploading--;
      row.remove();
      setTimeout(function () { uploadFile(file, attempt + 1); }, delay);
      return true;
    }

    // Permanent failure: count it and show a manual Retry button on the row.
    function failPermanently(msg) {
      batchFailed++;
      bar.classList.add('error');
      bar.style.width = '100%';
      if (msg) toast(file.name + ': ' + msg, true);

      pct.textContent = '';
      var retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'queue-retry';
      retryBtn.textContent = '↺ Retry';
      retryBtn.title = 'Retry upload';
      retryBtn.addEventListener('click', function () {
        batchFailed = Math.max(0, batchFailed - 1);
        row.remove();
        $queueSection.hidden = false;
        pending.push(file); // fresh attempt count
        updateQueueSummary();
        processQueue();
      });
      row.replaceChild(retryBtn, pct);

      uploading--;
      updateQueueSummary();
      processQueue();
    }

    var xhr = new XMLHttpRequest();
    var fd = new FormData();

    // Fields MUST come before file — @fastify/multipart stops parsing after file
    var pw = $passwordInput.value.trim();
    if (pw) fd.append('password', pw);
    var exp = $expirySelect.value;
    if (exp && exp !== 'forever') fd.append('expiresIn', exp);
    if (currentAlbumId) fd.append('album_id', currentAlbumId);
    fd.append('file', file);

    xhr.upload.addEventListener('progress', function (e) {
      if (e.lengthComputable) {
        var p = Math.round((e.loaded / e.total) * 100);
        bar.style.width = p + '%';
        pct.textContent = p + '%';
      }
    });

    xhr.addEventListener('load', function () {
      // Rate limited — always retry (separate from the transient-error budget)
      if (xhr.status === 429) {
        uploading--;
        row.remove();
        pending.unshift(file);
        setTimeout(processQueue, 3000);
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        batchDone++;
        batchBytes += file.size;
        bar.style.width = '100%';
        bar.classList.add('done');
        pct.textContent = '';

        try {
          var data = JSON.parse(xhr.responseText);
          if (data.status) {
            // Photo upload response
            if (data.deduplicated) {
              toast('Already backed up');
            } else if (data.status === 'processing') {
              pollPhotoStatus(data.id);
            }
            // Refresh gallery if we're in album view
            if (currentAlbumId && !$gallerySection.hidden) {
              openAlbum(currentAlbumId, currentAlbumName);
            }
          } else {
            showResult(data);
            addFileRow(data);
            filesOffset++;
            $emptyState.style.display = 'none';
          }
        } catch (_) { /* */ }

        // Clear password after successful upload
        $passwordInput.value = '';

        uploading--;
        updateQueueSummary();
        processQueue();
        scheduleStatsRefresh();

        setTimeout(function () {
          row.style.opacity = '0';
          row.style.transition = 'opacity 0.3s';
          setTimeout(function () {
            row.remove();
            if ($queueList.children.length === 0) $queueSection.hidden = true;
          }, 300);
        }, 2000);
        return;
      }

      if (xhr.status === 401) {
        // Auth expired — not transient; needs re-login. Offer manual retry.
        currentUser = null;
        saveAuthLocally(null);
        updateAuthUI();
        if (Date.now() - lastAuthToast > 5000) {
          lastAuthToast = Date.now();
          toast('Session expired, please log in again', true);
        }
        failPermanently(null);
        return;
      }

      if (xhr.status === 413) {
        // Storage full — retrying won't help; manual retry still available.
        var quotaErr = 'Storage full!';
        try { quotaErr = JSON.parse(xhr.responseText).error || quotaErr; } catch (_) { /* */ }
        failPermanently(quotaErr);
        return;
      }

      if (xhr.status >= 500) {
        // Transient server error — auto-retry, then fall back to manual.
        if (autoRetry()) return;
        var serr = 'Server error';
        try { serr = JSON.parse(xhr.responseText).error || serr; } catch (_) { /* */ }
        failPermanently(serr);
        return;
      }

      // Other 4xx — client error, unlikely to succeed on retry; manual only.
      var err = 'Upload failed';
      try { err = JSON.parse(xhr.responseText).error || err; } catch (_) { /* */ }
      failPermanently(err);
    });

    xhr.addEventListener('error', function () {
      // Network error — transient, auto-retry then fall back to manual.
      if (autoRetry()) return;
      failPermanently('Network error');
    });

    xhr.addEventListener('timeout', function () {
      if (autoRetry()) return;
      failPermanently('Timed out');
    });

    xhr.open('POST', '/upload');
    setAuthHeader(xhr);
    xhr.send(fd);
  }

  // ── Result Block ────────────────────────────────────────
  function showResult(data) {
    var old = document.querySelector('.result-row');
    if (old) old.remove();

    var fullUrl = data.url;
    if (fullUrl && !fullUrl.startsWith('http')) {
      fullUrl = window.location.origin + fullUrl;
    }

    var block = document.createElement('div');
    block.className = 'result-row';

    var urlRow = document.createElement('div');
    urlRow.className = 'url-row';

    var label = document.createElement('label');
    label.className = 'url-label';
    label.textContent = 'File URL';

    var urlBox = document.createElement('div');
    urlBox.className = 'url-box';

    var input = document.createElement('input');
    input.className = 'url-input';
    input.type = 'text';
    input.value = fullUrl;
    input.readOnly = true;
    input.addEventListener('click', function () { input.select(); });

    var copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-primary';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', function () { copyUrl(fullUrl); });

    urlBox.appendChild(input);
    urlBox.appendChild(copyBtn);
    urlRow.appendChild(label);
    urlRow.appendChild(urlBox);
    block.appendChild(urlRow);

    var meta = document.createElement('div');
    meta.style.cssText = 'font-size:11px;color:#71717a;margin-top:8px';
    var metaText = data.filename + ' \u00b7 ' + formatBytes(data.size) + ' \u00b7 ' + (data.mime || 'unknown');
    if (data.has_password) metaText += ' \u00b7 password protected';
    if (data.expires_at) metaText += ' \u00b7 expires ' + formatDate(data.expires_at);
    meta.textContent = metaText;
    block.appendChild(meta);

    $dropzone.parentNode.insertBefore(block, $dropzone.nextSibling);
  }

  // ── Infinite Scroll Helper ──────────────────────────────
  function createScrollLoader(container, loadMore) {
    var sentinel = document.createElement('div');
    sentinel.className = 'scroll-sentinel';
    sentinel.style.height = '1px';
    container.appendChild(sentinel);

    var observer = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) loadMore();
    }, { rootMargin: '200px' });

    observer.observe(sentinel);
    return {
      sentinel: sentinel,
      observer: observer,
      destroy: function () {
        observer.disconnect();
        if (sentinel.parentNode) sentinel.remove();
      }
    };
  }

  // ── File List ───────────────────────────────────────────
  function loadFiles() {
    // Reset scroll state
    filesOffset = 0;
    filesHasMore = true;
    filesLoading = false;
    if (filesScrollLoader) { filesScrollLoader.destroy(); filesScrollLoader = null; }

    if (!currentUser) {
      $fileList.innerHTML = '';
      $emptyState.style.display = '';
      $emptyState.querySelector('.empty-state-text').textContent = 'Login to manage files';
      $fileList.appendChild($emptyState);
      return;
    }

    $fileList.innerHTML = '';
    $emptyState.style.display = 'none';
    loadFilesPage();
  }

  function loadFilesPage() {
    if (filesLoading || !filesHasMore) return;
    filesLoading = true;

    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/files?limit=' + FILES_PAGE_SIZE + '&offset=' + filesOffset);
    setAuthHeader(xhr);

    xhr.addEventListener('load', function () {
      filesLoading = false;
      if (xhr.status === 200) {
        try {
          var files = JSON.parse(xhr.responseText);
          if (filesOffset === 0 && files.length === 0) {
            $emptyState.style.display = '';
            $emptyState.querySelector('.empty-state-text').textContent = 'No files yet';
            $fileList.appendChild($emptyState);
            return;
          }
          // Files come pre-sorted from backend (uploaded_at DESC)
          // Deduplicate against already-rendered rows
          for (var i = 0; i < files.length; i++) {
            if (!$fileList.querySelector('[data-id="' + files[i].id + '"]')) {
              addFileRow(files[i], true);
            }
          }
          filesOffset += files.length;
          if (files.length < FILES_PAGE_SIZE) {
            filesHasMore = false;
            if (filesScrollLoader) { filesScrollLoader.destroy(); filesScrollLoader = null; }
          } else if (!filesScrollLoader) {
            filesScrollLoader = createScrollLoader($fileList, loadFilesPage);
          } else {
            // Re-append sentinel to end
            $fileList.appendChild(filesScrollLoader.sentinel);
          }
        } catch (_) { /* */ }
      } else if (xhr.status === 401) {
        $fileList.innerHTML = '';
        $emptyState.style.display = '';
        $emptyState.querySelector('.empty-state-text').textContent = 'Session expired, please login again';
        $fileList.appendChild($emptyState);
      }
    });

    xhr.send();
  }

  function buildUrl(entry) {
    return '/f/' + entry.id;
  }

  function addFileRow(entry, append) {
    var url = entry.url || buildUrl(entry);
    var fullUrl = url;
    if (fullUrl && !fullUrl.startsWith('http')) {
      fullUrl = window.location.origin + url;
    }
    if (entry.url && entry.url.startsWith('http')) fullUrl = entry.url;

    var row = document.createElement('div');
    row.className = 'file-row';
    row.dataset.id = entry.id;

    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'file-checkbox';
    checkbox.checked = !!selectedFiles[entry.id];
    checkbox.dataset.filename = entry.filename;
    checkbox.addEventListener('change', function () {
      if (checkbox.checked) { selectedFiles[entry.id] = entry.filename; }
      else { delete selectedFiles[entry.id]; }
      updateSelectionBar();
    });
    row.appendChild(checkbox);

    if (entry.mime && entry.mime.startsWith('image/')) {
      var img = document.createElement('img');
      img.className = 'file-thumb';
      img.src = '/files/' + entry.id + '/' + encodeURIComponent(entry.filename);
      img.alt = entry.filename;
      img.loading = 'lazy';
      row.appendChild(img);
    } else {
      var icon = document.createElement('div');
      icon.className = 'file-icon';
      icon.textContent = getExt(entry.mime);
      row.appendChild(icon);
    }

    var info = document.createElement('div');
    info.className = 'file-info';

    var nameDiv = document.createElement('div');
    nameDiv.className = 'file-name';
    var link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.textContent = entry.filename;
    nameDiv.appendChild(link);

    var metaDiv = document.createElement('div');
    metaDiv.className = 'file-meta';

    var sizeSpan = document.createElement('span');
    sizeSpan.textContent = formatBytes(entry.size);
    var dateSpan = document.createElement('span');
    dateSpan.textContent = formatDate(entry.uploaded_at);

    metaDiv.appendChild(sizeSpan);
    metaDiv.appendChild(dateSpan);

    if (entry.has_password || entry.password_hash) {
      var lockSpan = document.createElement('span');
      lockSpan.textContent = 'locked';
      lockSpan.style.color = '#f59e0b';
      metaDiv.appendChild(lockSpan);
    }

    info.appendChild(nameDiv);
    info.appendChild(metaDiv);
    row.appendChild(info);

    var actions = document.createElement('div');
    actions.className = 'file-actions';

    var cpBtn = document.createElement('button');
    cpBtn.className = 'btn';
    cpBtn.textContent = 'Copy';
    cpBtn.addEventListener('click', function () { copyUrl(fullUrl); });

    var dlBtn = document.createElement('a');
    dlBtn.className = 'btn';
    dlBtn.textContent = 'Download';
    dlBtn.href = '/f/' + entry.id + '?dl=1';
    dlBtn.setAttribute('download', entry.filename);

    var delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger';
    delBtn.textContent = 'Del';
    delBtn.addEventListener('click', function () { deleteFile(entry.id, row); });

    actions.appendChild(cpBtn);
    actions.appendChild(dlBtn);

    // Host-only: locate the real file on disk (no download, no duplicate)
    if (isLocalhost()) {
      var locBtn = document.createElement('button');
      locBtn.className = 'btn';
      locBtn.textContent = 'Locate';
      locBtn.title = 'Open this file in the file manager on the server';
      locBtn.addEventListener('click', function () { revealFile(entry.id, locBtn); });

      var pathBtn = document.createElement('button');
      pathBtn.className = 'btn';
      pathBtn.textContent = 'Path';
      pathBtn.title = 'Copy the local disk path of this file';
      pathBtn.addEventListener('click', function () { copyLocalPath(entry.id); });

      actions.appendChild(locBtn);
      actions.appendChild(pathBtn);
    }

    actions.appendChild(delBtn);
    row.appendChild(actions);

    if (append) {
      $fileList.appendChild(row);
    } else if ($fileList.firstChild && $fileList.firstChild !== $emptyState) {
      $fileList.insertBefore(row, $fileList.firstChild);
    } else {
      $fileList.appendChild(row);
    }
  }

  function deleteFile(id, rowEl) {
    if (!confirm('Delete this file?')) return;

    var xhr = new XMLHttpRequest();
    xhr.open('DELETE', '/files/' + id);
    setAuthHeader(xhr);

    xhr.addEventListener('load', function () {
      if (xhr.status === 200) {
        rowEl.style.opacity = '0';
        rowEl.style.transition = 'opacity 0.2s';
        setTimeout(function () {
          rowEl.remove();
          loadStats();
          if ($fileList.querySelectorAll('.file-row').length === 0) {
            $emptyState.style.display = '';
            $emptyState.querySelector('.empty-state-text').textContent = 'No files yet';
            if (!$fileList.contains($emptyState)) $fileList.appendChild($emptyState);
          }
        }, 200);
        toast('Deleted');
      } else {
        var err = 'Delete failed';
        try { err = JSON.parse(xhr.responseText).error || err; } catch (_) { /* */ }
        toast(err, true);
      }
    });

    xhr.addEventListener('error', function () { toast('Network error', true); });
    xhr.send();
  }

  // ── Stats / Quota ──────────────────────────────────────
  function loadStats() {
    apiRequest('GET', '/api/user/storage', null, function (data) {
      if (!data) return;
      $storageQuota.hidden = false;
      $quotaText.textContent = data.photoCount.toLocaleString() + ' / ' + data.maxPhotos.toLocaleString() + ' photos';
      $quotaTier.textContent = data.tier;
      $quotaTier.className = 'quota-tier' + (data.isPremium ? ' premium' : '');
      $upgradeBtn.hidden = !!data.isPremium;

      var pct = Math.min(data.usedPercent, 100);
      $quotaFill.style.width = pct + '%';
      $quotaFill.className = 'quota-fill' +
        (pct >= 90 ? ' critical' : pct >= 75 ? ' warning' : '');
    });
  }

  // Debounced quota refresh — during a large batch upload, loadStats() would
  // otherwise fire once per file (hundreds of /api/user/storage requests).
  // Collapse them into a single trailing call.
  var statsRefreshTimer = null;
  function scheduleStatsRefresh() {
    if (statsRefreshTimer) clearTimeout(statsRefreshTimer);
    statsRefreshTimer = setTimeout(function () {
      statsRefreshTimer = null;
      loadStats();
    }, 800);
  }

  $upgradeBtn.addEventListener('click', function () {
    apiRequest('GET', '/api/plans', null, function (data) {
      if (!data || !data.plans || data.plans.length === 0) {
        toast('Upgrade plans coming soon!');
        return;
      }
      // Find the cheapest plan with a checkout URL
      var plan = null;
      for (var i = 0; i < data.plans.length; i++) {
        if (data.plans[i].checkout_url) {
          if (!plan || data.plans[i].price < plan.price) {
            plan = data.plans[i];
          }
        }
      }
      if (plan) {
        window.open(plan.checkout_url, '_blank');
      } else {
        toast('Upgrade plans coming soon!');
      }
    });
  });

  // ── Tab Switching ──────────────────────────────────────
  $viewTabs.addEventListener('click', function (e) {
    var tab = e.target.closest('.tab');
    if (!tab) return;
    var tabName = tab.dataset.tab;
    switchTab(tabName);
  });

  function switchTab(tabName) {
    exitSelectMode();
    setVideoSelectMode(false);
    // Destroy scroll loaders from previous tab
    if (filesScrollLoader) { filesScrollLoader.destroy(); filesScrollLoader = null; }
    if (galleryScrollLoader) { galleryScrollLoader.destroy(); galleryScrollLoader = null; }
    if (allPhotosScrollLoader) { allPhotosScrollLoader.destroy(); allPhotosScrollLoader = null; }
    currentTab = tabName;
    var tabs = $viewTabs.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].dataset.tab === tabName);
    }
    $filesSection.hidden = tabName !== 'files';
    $albumsSection.hidden = tabName !== 'albums';
    $photosSection.hidden = tabName !== 'photos';
    $videosSection.hidden = tabName !== 'videos';
    $gallerySection.hidden = true;
    if ($accountSection) $accountSection.hidden = true;
    if ($projectsSection) $projectsSection.hidden = true;
    currentAlbumId = null;
    currentAlbumName = '';
    if (tabName === 'albums') loadAlbums();
    if (tabName === 'photos') loadAllPhotos();
    if (tabName === 'videos') loadVideos();
  }

  // ── Router: home (landing) + dashboard pages with real URLs ─────
  var $accountSection = document.getElementById('accountSection');
  var $projectsSection = document.getElementById('projectsSection');
  var $appShell = document.querySelector('.app-shell');
  var $sideLinks = document.querySelectorAll('.side-link');
  var DASH_ROUTES = ['folders', 'photos', 'videos', 'files', 'account', 'projects'];

  function routeFromPath() {
    var seg = (location.pathname.split('/')[1] || '').toLowerCase();
    return DASH_ROUTES.indexOf(seg) >= 0 ? seg : 'home';
  }

  function setMode(dashboard) {
    document.body.classList.toggle('mode-dashboard', dashboard);
    document.body.classList.toggle('mode-landing', !dashboard);
  }

  function setActiveSide(route) {
    for (var i = 0; i < $sideLinks.length; i++) {
      $sideLinks[i].classList.toggle('active', $sideLinks[i].dataset.route === route);
    }
  }

  function toggleUploadZone(show) {
    var dz = document.getElementById('dropzone');
    var uo = document.getElementById('uploadOptions');
    if (dz) dz.hidden = !show;
    if (uo) uo.hidden = !show;
  }

  function navigate(route, push) {
    if ($appShell) $appShell.classList.remove('sidebar-open');

    // Home: desktop gets the dashboard (Folders) at "/"; mobile keeps the landing page
    if (route === 'home') {
      if (push !== false && location.pathname !== '/') history.pushState({}, '', '/');
      if (window.matchMedia('(min-width: 761px)').matches) {
        setMode(true);
        setActiveSide('folders');
        toggleUploadZone(true);
        switchTab('albums');
        return;
      }
      setMode(false);
      setActiveSide(null);
      toggleUploadZone(true);
      switchTab(currentTab && currentTab !== 'account' ? currentTab : 'files');
      return;
    }

    // Dashboard pages
    if (DASH_ROUTES.indexOf(route) < 0) route = 'folders';
    setMode(true);
    if (push !== false && location.pathname !== '/' + route) {
      history.pushState({ route: route }, '', '/' + route);
    }
    setActiveSide(route);
    toggleUploadZone(route !== 'account');
    if (route === 'account') {
      $filesSection.hidden = true;
      $albumsSection.hidden = true;
      $photosSection.hidden = true;
      $videosSection.hidden = true;
      $gallerySection.hidden = true;
      if ($projectsSection) $projectsSection.hidden = true;
      $accountSection.hidden = false;
      loadAccount();
    } else if (route === 'projects') {
      $filesSection.hidden = true;
      $albumsSection.hidden = true;
      $photosSection.hidden = true;
      $videosSection.hidden = true;
      $gallerySection.hidden = true;
      $accountSection.hidden = true;
      if ($projectsSection) $projectsSection.hidden = false;
      loadProjects();
    } else {
      switchTab(route === 'folders' ? 'albums' : route);
    }
  }

  // Intercept all [data-route] links (side nav, logos, Home) for client-side routing
  var $routeEls = document.querySelectorAll('[data-route]');
  for (var _ri = 0; _ri < $routeEls.length; _ri++) {
    $routeEls[_ri].addEventListener('click', function (e) {
      e.preventDefault();
      navigate(this.dataset.route, true);
    });
  }
  var $enterDash = document.getElementById('enterDashboardBtn');
  if ($enterDash) $enterDash.addEventListener('click', function () { navigate('folders', true); });

  window.addEventListener('popstate', function () { navigate(routeFromPath(), false); });

  var $sidebarToggle = document.getElementById('sidebarToggle');
  var $sidebarBackdrop = document.getElementById('sidebarBackdrop');
  if ($sidebarToggle && $appShell) {
    $sidebarToggle.addEventListener('click', function () { $appShell.classList.toggle('sidebar-open'); });
  }
  if ($sidebarBackdrop && $appShell) {
    $sidebarBackdrop.addEventListener('click', function () { $appShell.classList.remove('sidebar-open'); });
  }
  var $uploadFab = document.getElementById('uploadFab');
  if ($uploadFab) {
    $uploadFab.addEventListener('click', function () {
      var fi = document.getElementById('fileInput');
      if (fi) fi.click();
    });
  }

  // Landing nav login/logout proxies (delegate to the canonical sidebar buttons)
  var $loginBtnLanding = document.getElementById('loginBtnLanding');
  var $logoutBtnLanding = document.getElementById('logoutBtnLanding');
  if ($loginBtnLanding) $loginBtnLanding.addEventListener('click', function () { $loginBtn.click(); });
  if ($logoutBtnLanding) $logoutBtnLanding.addEventListener('click', function () { $logoutBtn.click(); });

  // ── Account page ───────────────────────────────────────
  function loadAccount() {
    var fmt = function (n) { return (n || 0).toLocaleString(); };
    apiRequest('GET', '/api/user/storage', null, function (data) {
      if (!data) return;
      var t = document.getElementById('acctStorageText');
      if (t) t.textContent = fmt(data.photoCount) + ' / ' + fmt(data.maxPhotos) + ' items';
      var pct = Math.min(data.usedPercent || 0, 100);
      var fill = document.getElementById('acctQuotaFill');
      if (fill) {
        fill.style.width = pct + '%';
        fill.className = 'quota-fill' + (pct >= 90 ? ' critical' : pct >= 75 ? ' warning' : '');
      }
      var tier = document.getElementById('acctTier');
      if (tier) { tier.textContent = data.tier; tier.className = 'quota-tier' + (data.isPremium ? ' premium' : ''); }
      var up = document.getElementById('acctUpgrade');
      if (up) up.hidden = !!data.isPremium;
    });
    apiRequest('GET', '/api/user/stats', null, function (s) {
      if (!s) return;
      var set = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = fmt(v); };
      set('acctPhotos', s.photos);
      set('acctVideos', s.videos);
      set('acctFiles', s.files);
    });
    var em = document.getElementById('acctEmail');
    if (em) em.textContent = (currentUser && (currentUser.email || currentUser.name)) || 'Not logged in';
  }

  var $acctThemeToggle = document.getElementById('acctThemeToggle');
  if ($acctThemeToggle && $themeToggle) {
    $acctThemeToggle.addEventListener('click', function () { $themeToggle.click(); });
  }
  var $acctLogout = document.getElementById('acctLogout');
  if ($acctLogout) $acctLogout.addEventListener('click', function () { $logoutBtn.click(); });
  var $acctUpgrade = document.getElementById('acctUpgrade');
  if ($acctUpgrade) $acctUpgrade.addEventListener('click', function () { $upgradeBtn.click(); });

  // ── Projects (multi-tenant admin) ──────────────────────
  var $projectsList = document.getElementById('projectsList');
  var $projectsAccountsView = document.getElementById('projectsAccountsView');
  var $projectsFilesView = document.getElementById('projectsFilesView');
  var $projectsGrid = document.getElementById('projectsGrid');
  var $projectsFilesTitle = document.getElementById('projectsFilesTitle');

  function fmtBytes(n) {
    n = n || 0;
    if (n < 1024) return n + ' B';
    var u = ['KB', 'MB', 'GB', 'TB'], i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return n.toFixed(1) + ' ' + u[i];
  }

  function showProjectsView(filesMode) {
    if ($projectsAccountsView) $projectsAccountsView.hidden = !!filesMode;
    if ($projectsFilesView) $projectsFilesView.hidden = !filesMode;
  }

  function loadProjects() {
    showProjectsView(false);
    apiRequest('GET', '/api/admin/accounts', null, function (data) {
      if (!data) return;
      renderAccounts(data.accounts || []);
    });
  }

  function renderAccounts(accounts) {
    if (!$projectsList) return;
    $projectsList.innerHTML = '';
    if (!accounts.length) {
      var empty = document.createElement('div');
      empty.className = 'projects-empty';
      empty.textContent = window.t ? window.t('No projects yet') : 'No projects yet';
      $projectsList.appendChild(empty);
      return;
    }
    accounts.forEach(function (a) {
      var card = document.createElement('div');
      card.className = 'project-card';

      var main = document.createElement('div');
      main.className = 'project-main';
      var nm = document.createElement('div');
      nm.className = 'project-name';
      nm.textContent = a.name;
      var meta = document.createElement('div');
      meta.className = 'project-meta';
      meta.textContent = a.key_prefix + '… · ' + (a.file_count || 0) + ' · ' + fmtBytes(a.total_bytes);
      main.appendChild(nm); main.appendChild(meta);

      var actions = document.createElement('div');
      actions.className = 'project-actions';
      var viewBtn = document.createElement('button');
      viewBtn.className = 'btn'; viewBtn.textContent = window.t ? window.t('Files') : 'Files';
      viewBtn.addEventListener('click', function () { viewProjectFiles(a.id, a.name); });
      var rotBtn = document.createElement('button');
      rotBtn.className = 'btn'; rotBtn.textContent = window.t ? window.t('Rotate key') : 'Rotate key';
      rotBtn.addEventListener('click', function () { rotateKey(a.id, a.name); });
      var delBtn = document.createElement('button');
      delBtn.className = 'btn lightbox-action-danger'; delBtn.textContent = window.t ? window.t('Delete') : 'Delete';
      delBtn.addEventListener('click', function () { deleteProject(a.id, a.name, a.file_count || 0); });
      actions.appendChild(viewBtn); actions.appendChild(rotBtn); actions.appendChild(delBtn);

      card.appendChild(main); card.appendChild(actions);
      $projectsList.appendChild(card);
    });
  }

  function newProject() {
    var name = window.prompt(window.t ? window.t('Project name') : 'Project name');
    if (!name || !name.trim()) return;
    apiRequest('POST', '/api/admin/accounts', { name: name.trim() }, function (data) {
      if (!data || !data.key) return;
      showKeyModal(data.account ? data.account.name : name.trim(), data.key);
      loadProjects();
    });
  }

  function rotateKey(id, name) {
    if (!window.confirm((window.t ? window.t('Rotate key — the old key stops working.') : 'Rotate key — the old key stops working.') + '\n' + name)) return;
    apiRequest('POST', '/api/admin/accounts/' + encodeURIComponent(id) + '/rotate', {}, function (data) {
      if (!data || !data.key) return;
      showKeyModal(name, data.key);
    });
  }

  function deleteProject(id, name, fileCount) {
    var msg = (window.t ? window.t('Delete project') : 'Delete project') + ' "' + name + '"?';
    if (fileCount > 0) msg += '\n' + fileCount + ' ' + (window.t ? window.t('files will be permanently deleted.') : 'files will be permanently deleted.');
    if (!window.confirm(msg)) return;
    var url = '/api/admin/accounts/' + encodeURIComponent(id) + (fileCount > 0 ? '?force=1' : '');
    apiRequest('DELETE', url, null, function () { loadProjects(); });
  }

  function viewProjectFiles(id, name) {
    showProjectsView(true);
    if ($projectsFilesTitle) $projectsFilesTitle.textContent = name;
    if ($projectsGrid) $projectsGrid.innerHTML = '';
    apiRequest('GET', '/api/admin/files?account=' + encodeURIComponent(id) + '&limit=500', null, function (files) {
      if (!Array.isArray(files) || !$projectsGrid) return;
      if (!files.length) {
        var e = document.createElement('div'); e.className = 'projects-empty';
        e.textContent = window.t ? window.t('No files yet') : 'No files yet';
        $projectsGrid.appendChild(e); return;
      }
      files.forEach(function (f) {
        var a = document.createElement('a');
        a.className = 'project-file';
        a.href = '/f/' + f.id; a.target = '_blank'; a.rel = 'noopener';
        a.title = f.filename || '';
        var isMedia = f.media_type === 'photo' || f.media_type === 'video';
        if (isMedia && f.status === 'ready') {
          var img = document.createElement('img');
          img.loading = 'lazy'; img.src = '/photos/' + f.id + '/thumb.webp'; img.alt = f.filename || '';
          a.appendChild(img);
        } else {
          var box = document.createElement('div'); box.className = 'project-file-doc';
          box.textContent = f.filename || 'file';
          a.appendChild(box);
        }
        $projectsGrid.appendChild(a);
      });
    });
  }

  function showKeyModal(name, key) {
    var modal = document.getElementById('keyModal');
    var keyEl = document.getElementById('keyModalKey');
    var snip = document.getElementById('keyModalSnippet');
    var title = document.getElementById('keyModalTitle');
    if (!modal) return;
    if (title) title.textContent = (name || '') + ' — ' + (window.t ? window.t('API key — shown once') : 'API key — shown once');
    if (keyEl) keyEl.textContent = key;
    if (snip) snip.textContent = 'POKKIT_URL=' + window.location.origin + '\nPOKKIT_KEY=' + key;
    modal.hidden = false;
  }

  var $newProjectBtn = document.getElementById('newProjectBtn');
  if ($newProjectBtn) $newProjectBtn.addEventListener('click', newProject);
  var $projectsBack = document.getElementById('projectsBack');
  if ($projectsBack) $projectsBack.addEventListener('click', function () { showProjectsView(false); });
  var $keyModalClose = document.getElementById('keyModalClose');
  if ($keyModalClose) $keyModalClose.addEventListener('click', function () {
    var m = document.getElementById('keyModal'); if (m) m.hidden = true;
  });
  var $keyModalCopy = document.getElementById('keyModalCopy');
  if ($keyModalCopy) $keyModalCopy.addEventListener('click', function () {
    var k = document.getElementById('keyModalKey');
    if (k && navigator.clipboard) navigator.clipboard.writeText(k.textContent).then(function () {
      toast(window.t ? window.t('Copied!') : 'Copied!');
    });
  });

  // Reveal the admin-only Projects nav when the signed-in caller is an admin.
  function checkAdmin() {
    apiRequest('GET', '/api/me', null, function (me) {
      var nav = document.getElementById('projectsNav');
      if (nav) nav.hidden = !(me && me.isAdmin);
    });
  }

  // ── Grid sort + size controls ──────────────────────────
  var GRID_SIZE_KEY = 'pokkit_grid_size';
  var GRID_SORT_KEY = 'pokkit_grid_sort';
  var gridSort = localStorage.getItem(GRID_SORT_KEY) === 'asc' ? 'asc' : 'desc';

  function applyGridSize(px) {
    document.documentElement.style.setProperty('--grid-min', px + 'px');
    localStorage.setItem(GRID_SIZE_KEY, px);
    var btns = document.querySelectorAll('.grid-size-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].dataset.size === String(px));
    }
  }

  function reloadCurrentGrid() {
    if (currentAlbumId && !$gallerySection.hidden) { openAlbum(currentAlbumId, currentAlbumName); return; }
    if (currentTab === 'photos') loadAllPhotos();
    else if (currentTab === 'videos') loadVideos();
  }

  function applyGridSort(order, reload) {
    gridSort = order === 'asc' ? 'asc' : 'desc';
    localStorage.setItem(GRID_SORT_KEY, gridSort);
    var sels = document.querySelectorAll('.grid-sort');
    for (var i = 0; i < sels.length; i++) sels[i].value = gridSort;
    if (reload) reloadCurrentGrid();
  }

  applyGridSize(parseInt(localStorage.getItem(GRID_SIZE_KEY), 10) || 150);
  applyGridSort(gridSort, false);

  var _sizeBtns = document.querySelectorAll('.grid-size-btn');
  for (var _gz = 0; _gz < _sizeBtns.length; _gz++) {
    _sizeBtns[_gz].addEventListener('click', function () { applyGridSize(parseInt(this.dataset.size, 10)); });
  }
  var _sortSels = document.querySelectorAll('.grid-sort');
  for (var _gs = 0; _gs < _sortSels.length; _gs++) {
    _sortSels[_gs].addEventListener('change', function () { applyGridSort(this.value, true); });
  }

  // ── Albums ─────────────────────────────────────────────
  $newAlbumBtn.addEventListener('click', function () {
    var albumName = prompt('Album name:');
    if (!albumName || !albumName.trim()) return;
    apiRequest('POST', '/api/albums', { name: albumName.trim() }, function () {
      loadAlbums();
    });
  });

  function loadAlbums() {
    apiRequest('GET', '/api/albums', null, function (albums) {
      renderAlbums(albums);
    });
  }

  function renderAlbums(albums) {
    $albumGrid.innerHTML = '';
    if (!albums || albums.length === 0) {
      $albumGrid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">~</div><div class="empty-state-text">No albums yet</div></div>';
      return;
    }
    for (var i = 0; i < albums.length; i++) {
      addAlbumCard(albums[i]);
    }
  }

  function addAlbumCard(album) {
    var card = document.createElement('div');
    card.className = 'album-card';

    var cover = document.createElement('div');
    cover.className = 'album-cover';
    if (album.cover_file_id) {
      var img = document.createElement('img');
      img.src = '/photos/' + album.cover_file_id + '/thumb.webp';
      img.alt = album.name;
      img.loading = 'lazy';
      cover.appendChild(img);
    } else {
      var empty = document.createElement('div');
      empty.className = 'album-cover-empty';
      empty.textContent = album.name.charAt(0).toUpperCase();
      cover.appendChild(empty);
    }

    // ⋮ menu button
    var menuBtn = document.createElement('button');
    menuBtn.className = 'album-card-menu-btn';
    menuBtn.textContent = '\u22EE';
    menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closeAllDropdowns();
      dropdown.classList.toggle('open');
    });

    // Dropdown menu
    var dropdown = document.createElement('div');
    dropdown.className = 'dropdown-menu';

    var renameItem = document.createElement('button');
    renameItem.className = 'dropdown-item';
    renameItem.textContent = 'Rename';
    renameItem.addEventListener('click', function (e) {
      e.stopPropagation();
      closeAllDropdowns();
      renameAlbum(album.id, album.name);
    });

    var deleteItem = document.createElement('button');
    deleteItem.className = 'dropdown-item dropdown-item-danger';
    deleteItem.textContent = 'Delete';
    deleteItem.addEventListener('click', function (e) {
      e.stopPropagation();
      closeAllDropdowns();
      deleteAlbum(album.id, album.name);
    });

    dropdown.appendChild(renameItem);
    dropdown.appendChild(deleteItem);

    var info = document.createElement('div');
    info.className = 'album-info';
    var nameDiv = document.createElement('div');
    nameDiv.className = 'album-name';
    nameDiv.textContent = album.name;
    var meta = document.createElement('div');
    meta.className = 'album-meta';
    meta.textContent = (album.photo_count || 0) + ' photos';
    info.appendChild(nameDiv);
    info.appendChild(meta);

    card.appendChild(cover);
    card.appendChild(menuBtn);
    card.appendChild(dropdown);
    card.appendChild(info);

    card.addEventListener('click', function () {
      openAlbum(album.id, album.name);
    });

    $albumGrid.appendChild(card);
  }

  // ── Album Actions ──────────────────────────────────────

  function closeAllDropdowns() {
    var menus = document.querySelectorAll('.dropdown-menu.open');
    for (var i = 0; i < menus.length; i++) menus[i].classList.remove('open');
  }

  document.addEventListener('click', closeAllDropdowns);

  function renameAlbum(id, currentName) {
    var newName = prompt('Rename album:', currentName);
    if (!newName || !newName.trim() || newName.trim() === currentName) return;
    apiRequest('PUT', '/api/albums/' + id, { name: newName.trim() }, function () {
      toast('Renamed');
      if (currentAlbumId === id) {
        currentAlbumName = newName.trim();
        $galleryTitle.textContent = currentAlbumName;
      }
      loadAlbums();
    });
  }

  function deleteAlbum(id, name) {
    if (!confirm('Delete album "' + name + '"? Photos will be kept.')) return;
    apiRequest('DELETE', '/api/albums/' + id, null, function () {
      toast('Album deleted');
      if (currentAlbumId === id) {
        currentAlbumId = null;
        currentAlbumName = '';
        $gallerySection.hidden = true;
        $albumsSection.hidden = false;
      }
      loadAlbums();
    });
  }

  // ── Gallery (photos inside album) ─────────────────────
  function openAlbum(albumId, albumName) {
    currentAlbumId = albumId;
    currentAlbumName = albumName;
    $albumsSection.hidden = true;
    $gallerySection.hidden = false;
    $galleryTitle.textContent = albumName;
    $galleryCount.textContent = '';
    $photoGrid.innerHTML = '';
    fillGridSkeletons($photoGrid);

    // Reset scroll state
    galleryOffset = 0;
    galleryHasMore = true;
    galleryLoading = false;
    galleryPhotos = [];
    if (galleryScrollLoader) { galleryScrollLoader.destroy(); galleryScrollLoader = null; }

    loadGalleryPage();
  }

  function loadGalleryPage() {
    if (galleryLoading || !galleryHasMore) return;
    galleryLoading = true;

    var url = '/api/albums/' + currentAlbumId + '?limit=' + GALLERY_PAGE_SIZE + '&offset=' + galleryOffset + '&order=' + gridSort;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    setAuthHeader(xhr);
    xhr.addEventListener('load', function () {
      galleryLoading = false;
      if (galleryOffset === 0) clearGridSkeletons($photoGrid);
      if (xhr.status < 200 || xhr.status >= 300) return;
      var data;
      try { data = JSON.parse(xhr.responseText); } catch (_) { return; }
      if (!data) return;

      var photos = data.photos || [];
      // Deduplicate by ID
      var seen = {};
      for (var j = 0; j < galleryPhotos.length; j++) {
        seen[galleryPhotos[j].id] = true;
      }
      var newPhotos = photos.filter(function (p) {
        if (seen[p.id]) return false;
        seen[p.id] = true;
        return true;
      });

      for (var i = 0; i < newPhotos.length; i++) {
        galleryPhotos.push(newPhotos[i]);
        addPhotoCell(newPhotos[i], galleryPhotos.length - 1);
      }

      $galleryCount.textContent = galleryPhotos.length + ' photos';
      galleryOffset += photos.length;

      // Empty state check before scroll loader logic
      if (galleryOffset === 0 && galleryPhotos.length === 0) {
        $photoGrid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">~</div><div class="empty-state-text">No photos yet \u2014 drop images to upload</div></div>';
        return;
      }

      if (photos.length < GALLERY_PAGE_SIZE) {
        galleryHasMore = false;
        if (galleryScrollLoader) { galleryScrollLoader.destroy(); galleryScrollLoader = null; }
      } else if (!galleryScrollLoader) {
        galleryScrollLoader = createScrollLoader($photoGrid, loadGalleryPage);
      } else {
        $photoGrid.appendChild(galleryScrollLoader.sentinel);
      }
    });
    xhr.addEventListener('error', function () {
      galleryLoading = false;
      if (galleryOffset === 0) clearGridSkeletons($photoGrid);
    });
    xhr.send();
  }

  $backToAlbums.addEventListener('click', function () {
    if (galleryScrollLoader) { galleryScrollLoader.destroy(); galleryScrollLoader = null; }
    $gallerySection.hidden = true;
    $albumsSection.hidden = false;
    currentAlbumId = null;
    currentAlbumName = '';
    loadAlbums();
  });

  $galleryRename.addEventListener('click', function () {
    if (currentAlbumId) renameAlbum(currentAlbumId, currentAlbumName);
  });

  $galleryDelete.addEventListener('click', function () {
    if (currentAlbumId) deleteAlbum(currentAlbumId, currentAlbumName);
  });

  function renderPhotoGrid() {
    $photoGrid.innerHTML = '';
    if (galleryPhotos.length === 0) {
      $photoGrid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">~</div><div class="empty-state-text">No photos yet \u2014 drop images to upload</div></div>';
      return;
    }
    for (var i = 0; i < galleryPhotos.length; i++) {
      addPhotoCell(galleryPhotos[i], i);
    }
    // Re-attach scroll sentinel if more pages remain
    if (galleryHasMore && galleryScrollLoader) {
      $photoGrid.appendChild(galleryScrollLoader.sentinel);
    }
  }

  function addPhotoCell(photo, index) {
    var cell = document.createElement('div');
    cell.className = 'photo-cell';
    cell.dataset.id = photo.id;

    // Checkbox for multi-select
    var checkbox = document.createElement('div');
    checkbox.className = 'photo-checkbox';
    cell.appendChild(checkbox);

    if (photo.status === 'ready') {
      var img = document.createElement('img');
      img.src = '/photos/' + photo.id + '/thumb.webp';
      img.alt = photo.filename;
      img.loading = 'lazy';
      cell.appendChild(img);

      // Video overlay: play icon + duration badge
      if (isVideoEntry(photo)) {
        var playIcon = document.createElement('div');
        playIcon.className = 'video-play-icon';
        cell.appendChild(playIcon);
        if (photo.duration) {
          var dur = document.createElement('div');
          dur.className = 'video-duration';
          dur.textContent = formatDuration(photo.duration);
          cell.appendChild(dur);
        }
      }

      // Hover action buttons
      var actions = document.createElement('div');
      actions.className = 'photo-actions';

      var coverBtn = document.createElement('button');
      coverBtn.className = 'photo-action-btn';
      coverBtn.innerHTML = '&#9733;';
      coverBtn.title = 'Set as cover';
      coverBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (selectMode) return;
        setAlbumCover(photo.id);
      });

      var delBtn = document.createElement('button');
      delBtn.className = 'photo-action-btn danger';
      delBtn.innerHTML = '&#10005;';
      delBtn.title = 'Delete';
      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (selectMode) return;
        deletePhoto(photo.id);
      });

      actions.appendChild(coverBtn);
      actions.appendChild(delBtn);
      cell.appendChild(actions);
    } else {
      var overlay = document.createElement('div');
      overlay.className = 'processing-overlay';
      var spinner = document.createElement('div');
      spinner.className = 'processing-spinner';
      overlay.appendChild(spinner);
      cell.appendChild(overlay);
      pollPhotoStatus(photo.id);
    }

    cell.addEventListener('click', function () {
      if (selectMode) {
        togglePhotoSelection(photo.id, cell);
        return;
      }
      if (photo.status === 'ready') {
        openLightbox(index);
      }
    });

    $photoGrid.appendChild(cell);
  }

  // ── Photo Actions ──────────────────────────────────────

  function deletePhoto(id) {
    if (!confirm('Delete this photo?')) return;
    apiRequest('DELETE', '/files/' + id, null, function () {
      toast('Deleted');
      galleryPhotos = galleryPhotos.filter(function (p) { return p.id !== id; });
      $galleryCount.textContent = galleryPhotos.length + ' photos';
      renderPhotoGrid();
    });
  }

  function setAlbumCover(photoId) {
    if (!currentAlbumId) return;
    apiRequest('PUT', '/api/albums/' + currentAlbumId, { cover_file_id: photoId }, function () {
      toast('Cover set');
    });
  }

  // ── Processing Poll (shared, batched) ─────────────────
  // One timer for the whole page: each tick asks the server for the status of
  // every still-processing item in a single request, instead of spinning up a
  // separate 2s interval per upload (which floods the server on big batches).
  function pollPhotoStatus(id) {
    processingIds[id] = true;
    if (!processingTimer) {
      processingTimer = setInterval(pollProcessingBatch, 2000);
    }
  }

  function pollProcessingBatch() {
    var ids = Object.keys(processingIds);
    if (ids.length === 0) {
      clearInterval(processingTimer);
      processingTimer = null;
      return;
    }
    var batch = ids.slice(0, 200); // remaining ids are picked up on the next tick
    apiRequest('GET', '/api/photos/status?ids=' + encodeURIComponent(batch.join(',')), null, function (data) {
      if (!data || !data.statuses) return;
      for (var i = 0; i < batch.length; i++) {
        var pid = batch[i];
        var info = data.statuses[pid]; // { status, duration, media_type } or undefined
        if (!info) {
          // Unknown id (deleted, or never existed) — stop polling it.
          delete processingIds[pid];
        } else if (info.status === 'ready') {
          delete processingIds[pid];
          markPhotoReady(pid, info);
        } else if (info.status === 'failed') {
          delete processingIds[pid];
          toast('Processing failed: ' + pid, true);
        }
      }
    });
  }

  // info (optional) carries fresh { duration, media_type } from the status poll,
  // so a just-finished video shows its duration without needing a reload.
  function markPhotoReady(id, info) {
    var entry = null;
    for (var i = 0; i < galleryPhotos.length; i++) {
      if (galleryPhotos[i].id === id) {
        galleryPhotos[i].status = 'ready';
        if (info && info.duration != null) galleryPhotos[i].duration = info.duration;
        entry = galleryPhotos[i];
        break;
      }
    }

    var cell = $photoGrid.querySelector('[data-id="' + id + '"]');
    if (!cell) cell = $allPhotoGrid.querySelector('[data-id="' + id + '"]');
    if (!cell) return;

    // Prefer fresh server info; fall back to the (possibly stale) gallery entry.
    var isVideo = info ? info.media_type === 'video' : (entry && isVideoEntry(entry));
    var duration = info && info.duration != null ? info.duration : (entry && entry.duration);

    cell.innerHTML = '';
    var checkbox = document.createElement('div');
    checkbox.className = 'photo-checkbox';
    cell.appendChild(checkbox);
    var img = document.createElement('img');
    img.src = '/photos/' + id + '/thumb.webp';
    img.loading = 'lazy';
    cell.appendChild(img);
    if (isVideo) {
      var playIcon = document.createElement('div');
      playIcon.className = 'video-play-icon';
      cell.appendChild(playIcon);
      if (duration) {
        var dur = document.createElement('div');
        dur.className = 'video-duration';
        dur.textContent = formatDuration(duration);
        cell.appendChild(dur);
      }
    }
  }

  // ── Lightbox ──────────────────────────────────────────
  function openLightbox(index) {
    lightboxIndex = index;
    showLightboxPhoto();
    $lightbox.classList.add('active');
  }

  function closeLightbox() {
    $lightbox.classList.remove('active');
    $lightbox.classList.remove('notes-open');
    lightboxIndex = -1;
    // Pause and reset video when closing
    $lightboxVideo.pause();
    $lightboxVideo.removeAttribute('src');
    $lightboxVideo.hidden = true;
    $lightboxImg.hidden = false;
  }

  function showLightboxPhoto() {
    if (lightboxIndex < 0 || lightboxIndex >= galleryPhotos.length) return;
    var photo = galleryPhotos[lightboxIndex];

    // Header: filename + counter
    $lightboxFilename.textContent = photo.filename;
    $lightboxCounter.textContent = (lightboxIndex + 1) + ' / ' + galleryPhotos.length;

    // Bottom info line
    var infoParts = [];
    if (photo.width && photo.height) infoParts.push(photo.width + '\u00d7' + photo.height);
    if (photo.duration) infoParts.push(formatDuration(photo.duration));
    if (photo.taken_at) infoParts.push(formatDate(photo.taken_at));
    $lightboxInfo.textContent = infoParts.join(' \u00b7 ');

    // Download (force-download original) + host-only Locate
    if ($lightboxDownload) {
      $lightboxDownload.href = '/f/' + photo.id + '?dl=1';
      $lightboxDownload.setAttribute('download', photo.filename || '');
    }
    if ($lightboxLocate) {
      $lightboxLocate.hidden = !isLocalhost();
    }

    // Notes — collapsed by default (toggled via the Note button) so they never
    // cover the video controls. Just prime the content + flag whether any exist.
    $lightbox.classList.remove('notes-open');
    $lightboxNotesEdit.hidden = true;
    $lightboxNotesDisplay.hidden = false;
    if (photo.notes) {
      $lightboxNotesDisplay.textContent = photo.notes;
      $lightboxNotesDisplay.classList.remove('placeholder');
    } else {
      $lightboxNotesDisplay.textContent = 'Add notes...';
      $lightboxNotesDisplay.classList.add('placeholder');
    }
    if ($lightboxNoteToggle) $lightboxNoteToggle.classList.toggle('has-notes', !!photo.notes);

    // Reset skeleton: media fades in once loaded, so the fixed window never pops.
    var $media = $lightboxImg.parentNode;
    if ($media) $media.classList.remove('loaded');
    var markLoaded = function () { if ($media) $media.classList.add('loaded'); };

    if (isVideoEntry(photo)) {
      // Clean up previous video before loading new one
      $lightboxVideo.pause();
      $lightboxVideo.removeAttribute('src');
      $lightboxImg.hidden = true;
      $lightboxVideo.hidden = false;
      // Show the thumbnail instantly as a poster instead of a black frame while buffering
      $lightboxVideo.poster = '/photos/' + photo.id + '/thumb.webp';
      $lightboxVideo.onloadedmetadata = markLoaded;
      $lightboxVideo.src = '/photos/' + photo.id + '/video.mp4';
      $lightboxVideo.load();
    } else {
      $lightboxVideo.pause();
      $lightboxVideo.removeAttribute('src');
      $lightboxVideo.hidden = true;
      $lightboxImg.hidden = false;
      $lightboxImg.onload = markLoaded;
      $lightboxImg.src = '/photos/' + photo.id + '/photo.webp';
      if ($lightboxImg.complete) markLoaded();
    }
  }

  $lightboxClose.addEventListener('click', closeLightbox);
  $lightboxPrev.addEventListener('click', function () {
    if (lightboxIndex > 0) { lightboxIndex--; showLightboxPhoto(); }
  });
  $lightboxNext.addEventListener('click', function () {
    if (lightboxIndex < galleryPhotos.length - 1) { lightboxIndex++; showLightboxPhoto(); }
  });

  if ($lightboxLocate) {
    $lightboxLocate.addEventListener('click', function () {
      if (lightboxIndex < 0 || lightboxIndex >= galleryPhotos.length) return;
      revealFile(galleryPhotos[lightboxIndex].id, $lightboxLocate);
    });
  }

  $lightboxDelete.addEventListener('click', function () {
    if (lightboxIndex < 0 || lightboxIndex >= galleryPhotos.length) return;
    var photo = galleryPhotos[lightboxIndex];
    if (!confirm('Delete this photo?')) return;
    apiRequest('DELETE', '/files/' + photo.id, null, function () {
      toast('Deleted');
      galleryPhotos.splice(lightboxIndex, 1);
      $galleryCount.textContent = galleryPhotos.length + ' photos';
      if (galleryPhotos.length === 0) {
        closeLightbox();
      } else if (lightboxIndex >= galleryPhotos.length) {
        lightboxIndex = galleryPhotos.length - 1;
        showLightboxPhoto();
      } else {
        showLightboxPhoto();
      }
      renderPhotoGrid();
    });
  });

  $lightboxCover.addEventListener('click', function () {
    if (lightboxIndex < 0 || lightboxIndex >= galleryPhotos.length) return;
    var photo = galleryPhotos[lightboxIndex];
    setAlbumCover(photo.id);
  });

  $lightbox.addEventListener('click', function (e) {
    if (e.target === $lightbox) closeLightbox();
  });

  document.addEventListener('keydown', function (e) {
    if (!$lightbox.classList.contains('active')) return;
    if (e.key === 'Escape') {
      if (!$lightboxNotesEdit.hidden) {
        cancelNotesEdit();
        return;
      }
      closeLightbox();
    }
    // Don't navigate when editing notes
    if (!$lightboxNotesEdit.hidden) return;
    if (e.key === 'ArrowLeft' && lightboxIndex > 0) { lightboxIndex--; showLightboxPhoto(); }
    if (e.key === 'ArrowRight' && lightboxIndex < galleryPhotos.length - 1) { lightboxIndex++; showLightboxPhoto(); }
  });

  // ── Notes Click-to-Edit ───────────────────────────────
  var notesOriginalValue = '';

  $lightboxNotesDisplay.addEventListener('click', function (e) {
    e.stopPropagation();
    if (lightboxIndex < 0 || lightboxIndex >= galleryPhotos.length) return;
    var photo = galleryPhotos[lightboxIndex];
    notesOriginalValue = photo.notes || '';
    $lightboxNotesEdit.value = notesOriginalValue;
    $lightboxNotesDisplay.hidden = true;
    $lightboxNotesEdit.hidden = false;
    $lightboxNotesEdit.focus();
  });

  // "Note" button toggles the collapsed notes panel; opening an empty note
  // jumps straight to editing.
  if ($lightboxNoteToggle) {
    $lightboxNoteToggle.addEventListener('click', function (e) {
      e.stopPropagation();
      var opening = !$lightbox.classList.contains('notes-open');
      $lightbox.classList.toggle('notes-open', opening);
      if (opening) {
        var photo = galleryPhotos[lightboxIndex];
        if (photo && !photo.notes) {
          notesOriginalValue = '';
          $lightboxNotesEdit.value = '';
          $lightboxNotesDisplay.hidden = true;
          $lightboxNotesEdit.hidden = false;
          $lightboxNotesEdit.focus();
        }
      } else {
        cancelNotesEdit();
      }
    });
  }

  $lightboxNotesEdit.addEventListener('keydown', function (e) {
    e.stopPropagation();
    if (e.key === 'Escape') {
      cancelNotesEdit();
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveNotes();
    }
  });

  $lightboxNotesEdit.addEventListener('blur', function () {
    saveNotes();
  });

  $lightboxNotesEdit.addEventListener('click', function (e) {
    e.stopPropagation();
  });

  function cancelNotesEdit() {
    $lightboxNotesEdit.hidden = true;
    $lightboxNotesDisplay.hidden = false;
  }

  function saveNotes() {
    if ($lightboxNotesEdit.hidden) return;
    if (lightboxIndex < 0 || lightboxIndex >= galleryPhotos.length) return;
    var photo = galleryPhotos[lightboxIndex];
    var newValue = $lightboxNotesEdit.value.trim();
    var oldValue = (photo.notes || '').trim();

    $lightboxNotesEdit.hidden = true;
    $lightboxNotesDisplay.hidden = false;

    if (newValue === oldValue) return;

    photo.notes = newValue || null;
    if (photo.notes) {
      $lightboxNotesDisplay.textContent = photo.notes;
      $lightboxNotesDisplay.classList.remove('placeholder');
    } else {
      $lightboxNotesDisplay.textContent = 'Add notes...';
      $lightboxNotesDisplay.classList.add('placeholder');
    }

    apiRequest('PUT', '/api/photos/' + photo.id, { notes: newValue || '' }, function () {
      toast('Notes saved');
    });
  }

  // ── Multi-Select Mode ─────────────────────────────────

  function enterSelectMode() {
    selectMode = true;
    selectedIds = [];
    updateSelectionUI();
    var grid = currentTab === 'photos' ? $allPhotoGrid : $photoGrid;
    grid.classList.add('select-mode');
    $selectionBar.classList.add('active');
    if ($gallerySelect) $gallerySelect.textContent = 'Cancel';
    if ($allPhotosSelect) $allPhotosSelect.textContent = 'Cancel';
  }

  function exitSelectMode() {
    selectMode = false;
    selectedIds = [];
    $selectionBar.classList.remove('active');
    $photoGrid.classList.remove('select-mode');
    $allPhotoGrid.classList.remove('select-mode');
    if ($gallerySelect) $gallerySelect.textContent = 'Select';
    if ($allPhotosSelect) $allPhotosSelect.textContent = 'Select';
    // Remove selected class from all cells
    var cells = document.querySelectorAll('.photo-cell.selected');
    for (var i = 0; i < cells.length; i++) cells[i].classList.remove('selected');
  }

  function togglePhotoSelection(id, cell) {
    var idx = selectedIds.indexOf(id);
    if (idx === -1) {
      selectedIds.push(id);
      cell.classList.add('selected');
    } else {
      selectedIds.splice(idx, 1);
      cell.classList.remove('selected');
    }
    updateSelectionUI();
  }

  function updateSelectionUI() {
    $selectionCount.textContent = selectedIds.length + ' selected';
  }

  $gallerySelect.addEventListener('click', function () {
    if (selectMode) { exitSelectMode(); } else { enterSelectMode(); }
  });

  $allPhotosSelect.addEventListener('click', function () {
    if (selectMode) { exitSelectMode(); } else { enterSelectMode(); }
  });

  $selectionCancel.addEventListener('click', exitSelectMode);

  if ($selectionDownload) {
    $selectionDownload.addEventListener('click', function () {
      if (!selectedIds.length) return;
      toast('Downloading ' + selectedIds.length + ' file' + (selectedIds.length === 1 ? '' : 's') + '…');
      // Server sets the real filename via Content-Disposition, so id alone is enough
      selectedIds.slice().forEach(function (id, i) {
        setTimeout(function () { triggerDownload(id, ''); }, i * 600);
      });
    });
  }

  // Long press to enter select mode
  var longPressTimer = null;
  function setupLongPress(grid) {
    grid.addEventListener('pointerdown', function (e) {
      var cell = e.target.closest('.photo-cell');
      if (!cell || selectMode) return;
      longPressTimer = setTimeout(function () {
        enterSelectMode();
        togglePhotoSelection(cell.dataset.id, cell);
      }, 600);
    });
    grid.addEventListener('pointerup', function () { clearTimeout(longPressTimer); });
    grid.addEventListener('pointerleave', function () { clearTimeout(longPressTimer); });
    grid.addEventListener('pointermove', function () { clearTimeout(longPressTimer); });
  }
  setupLongPress($photoGrid);
  setupLongPress($allPhotoGrid);

  // ── Album Picker ─────────────────────────────────────

  $selectionMove.addEventListener('click', openAlbumPicker);
  $albumPickerOverlay.addEventListener('click', closeAlbumPicker);
  $albumPickerNew.addEventListener('click', function () {
    var name = prompt('New album name:');
    if (!name || !name.trim()) return;
    apiRequest('POST', '/api/albums', { name: name.trim() }, function (album) {
      bulkMovePhotos(album.id);
    });
  });

  function openAlbumPicker() {
    if (selectedIds.length === 0) return;
    apiRequest('GET', '/api/albums', null, function (albums) {
      $albumPickerList.innerHTML = '';
      for (var i = 0; i < albums.length; i++) {
        (function (album) {
          var item = document.createElement('div');
          item.className = 'album-picker-item';
          item.innerHTML = '<span>' + album.name + '</span><span class="album-picker-item-count">' + (album.photo_count || 0) + '</span>';
          item.addEventListener('click', function () {
            bulkMovePhotos(album.id);
          });
          $albumPickerList.appendChild(item);
        })(albums[i]);
      }
      $albumPicker.classList.add('active');
    });
  }

  function closeAlbumPicker() {
    $albumPicker.classList.remove('active');
  }

  function bulkMovePhotos(albumId) {
    closeAlbumPicker();
    apiRequest('PUT', '/api/photos/bulk-move', { photo_ids: selectedIds, album_id: albumId }, function (data) {
      toast('Moved ' + (data.moved || selectedIds.length) + ' photos');
      exitSelectMode();
      // Refresh current view
      if (currentTab === 'photos') {
        loadAllPhotos();
      } else if (currentAlbumId) {
        openAlbum(currentAlbumId, currentAlbumName);
      }
    });
  }

  // ── All Photos Tab ───────────────────────────────────

  function loadAllPhotos() {
    // Reset scroll state
    allPhotosOffset = 0;
    allPhotosHasMore = true;
    allPhotosLoading = false;
    allPhotos = [];
    if (allPhotosScrollLoader) { allPhotosScrollLoader.destroy(); allPhotosScrollLoader = null; }

    $allPhotoGrid.innerHTML = '';
    fillGridSkeletons($allPhotoGrid);
    // Load album map first, then start paginated photo loading
    apiRequest('GET', '/api/albums', null, function (albums) {
      allPhotosAlbumMap = {};
      for (var i = 0; i < albums.length; i++) {
        allPhotosAlbumMap[albums[i].id] = albums[i].name;
      }
      loadAllPhotosPage();
    });
  }

  function loadAllPhotosPage() {
    if (allPhotosLoading || !allPhotosHasMore) return;
    allPhotosLoading = true;

    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/photos?type=photo&limit=' + ALL_PHOTOS_PAGE_SIZE + '&offset=' + allPhotosOffset + '&order=' + gridSort);
    setAuthHeader(xhr);
    xhr.addEventListener('load', function () {
      allPhotosLoading = false;
      if (allPhotosOffset === 0) clearGridSkeletons($allPhotoGrid);
      if (xhr.status < 200 || xhr.status >= 300) return;
      var photos;
      try { photos = JSON.parse(xhr.responseText); } catch (_) { return; }
      if (!photos) return;

      if (allPhotosOffset === 0 && photos.length === 0) {
        $allPhotoGrid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">~</div><div class="empty-state-text">No photos yet</div></div>';
        return;
      }

      // Deduplicate by ID
      var seen = {};
      for (var j = 0; j < allPhotos.length; j++) {
        seen[allPhotos[j].id] = true;
      }
      var newPhotos = photos.filter(function (p) {
        if (seen[p.id]) return false;
        seen[p.id] = true;
        return true;
      });

      for (var i = 0; i < newPhotos.length; i++) {
        allPhotos.push(newPhotos[i]);
        addAllPhotoCell(newPhotos[i], allPhotos.length - 1);
      }

      allPhotosOffset += photos.length;
      if (photos.length < ALL_PHOTOS_PAGE_SIZE) {
        allPhotosHasMore = false;
        if (allPhotosScrollLoader) { allPhotosScrollLoader.destroy(); allPhotosScrollLoader = null; }
      } else if (!allPhotosScrollLoader) {
        allPhotosScrollLoader = createScrollLoader($allPhotoGrid, loadAllPhotosPage);
      } else {
        $allPhotoGrid.appendChild(allPhotosScrollLoader.sentinel);
      }
    });
    xhr.addEventListener('error', function () {
      allPhotosLoading = false;
      if (allPhotosOffset === 0) clearGridSkeletons($allPhotoGrid);
    });
    xhr.send();
  }

  function addAllPhotoCell(photo, index) {
    var cell = document.createElement('div');
    cell.className = 'photo-cell';
    cell.dataset.id = photo.id;

    var checkbox = document.createElement('div');
    checkbox.className = 'photo-checkbox';
    cell.appendChild(checkbox);

    if (photo.status === 'ready') {
      var img = document.createElement('img');
      img.src = '/photos/' + photo.id + '/thumb.webp';
      img.loading = 'lazy';
      cell.appendChild(img);

      // Video overlay: play icon + duration badge
      if (isVideoEntry(photo)) {
        var playIcon = document.createElement('div');
        playIcon.className = 'video-play-icon';
        cell.appendChild(playIcon);
        if (photo.duration) {
          var dur = document.createElement('div');
          dur.className = 'video-duration';
          dur.textContent = formatDuration(photo.duration);
          cell.appendChild(dur);
        }
      }

      // Album badge
      if (photo.album_id && allPhotosAlbumMap[photo.album_id]) {
        var badge = document.createElement('div');
        badge.className = 'album-badge';
        badge.textContent = allPhotosAlbumMap[photo.album_id];
        cell.appendChild(badge);
      }
    } else {
      var overlay = document.createElement('div');
      overlay.className = 'processing-overlay';
      var spinner = document.createElement('div');
      spinner.className = 'processing-spinner';
      overlay.appendChild(spinner);
      cell.appendChild(overlay);
    }

    cell.addEventListener('click', function () {
      if (selectMode) {
        togglePhotoSelection(photo.id, cell);
        return;
      }
      if (photo.status === 'ready') {
        lightboxIndex = index;
        galleryPhotos = allPhotos;
        showLightboxPhoto();
        $lightbox.classList.add('active');
      }
    });

    $allPhotoGrid.appendChild(cell);
  }

  // ── Videos Tab ─────────────────────────────────────────

  function loadVideos() {
    videosOffset = 0;
    videosHasMore = true;
    videosLoading = false;
    videosData = [];
    if (videosScrollLoader) { videosScrollLoader.destroy(); videosScrollLoader = null; }

    $videoGrid.innerHTML = '';
    fillGridSkeletons($videoGrid);
    loadVideosPage();
  }

  function loadVideosPage() {
    if (videosLoading || !videosHasMore) return;
    videosLoading = true;

    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/photos?type=video&limit=' + VIDEOS_PAGE_SIZE + '&offset=' + videosOffset + '&order=' + gridSort);
    setAuthHeader(xhr);
    xhr.addEventListener('load', function () {
      videosLoading = false;
      if (videosOffset === 0) clearGridSkeletons($videoGrid);
      if (xhr.status < 200 || xhr.status >= 300) return;
      var videos;
      try { videos = JSON.parse(xhr.responseText); } catch (_) { return; }
      if (!videos) return;

      if (videosOffset === 0 && videos.length === 0) {
        $videoGrid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">~</div><div class="empty-state-text">No videos yet</div></div>';
        return;
      }

      var seen = {};
      for (var j = 0; j < videosData.length; j++) {
        seen[videosData[j].id] = true;
      }
      var newVideos = videos.filter(function (v) {
        if (seen[v.id]) return false;
        seen[v.id] = true;
        return true;
      });

      for (var i = 0; i < newVideos.length; i++) {
        videosData.push(newVideos[i]);
        addVideoCell(newVideos[i], videosData.length - 1);
      }

      videosOffset += videos.length;
      if (videos.length < VIDEOS_PAGE_SIZE) {
        videosHasMore = false;
        if (videosScrollLoader) { videosScrollLoader.destroy(); videosScrollLoader = null; }
      } else if (!videosScrollLoader) {
        videosScrollLoader = createScrollLoader($videoGrid, loadVideosPage);
      } else {
        $videoGrid.appendChild(videosScrollLoader.sentinel);
      }
    });
    xhr.addEventListener('error', function () {
      videosLoading = false;
      if (videosOffset === 0) clearGridSkeletons($videoGrid);
    });
    xhr.send();
  }

  function addVideoCell(video, index) {
    var cell = document.createElement('div');
    cell.className = 'photo-cell';
    cell.dataset.id = video.id;

    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'cell-checkbox';
    checkbox.checked = !!selectedFiles[video.id];
    if (checkbox.checked) cell.classList.add('selected');
    checkbox.addEventListener('click', function (e) { e.stopPropagation(); });
    checkbox.addEventListener('change', function () {
      if (checkbox.checked) { selectedFiles[video.id] = video.filename; cell.classList.add('selected'); }
      else { delete selectedFiles[video.id]; cell.classList.remove('selected'); }
      updateSelectionBar();
    });
    cell.appendChild(checkbox);

    if (video.status === 'ready') {
      var img = document.createElement('img');
      img.src = '/photos/' + video.id + '/thumb.webp';
      img.loading = 'lazy';
      cell.appendChild(img);

      var playIcon = document.createElement('div');
      playIcon.className = 'video-play-icon';
      cell.appendChild(playIcon);

      if (video.duration) {
        var dur = document.createElement('div');
        dur.className = 'video-duration';
        dur.textContent = formatDuration(video.duration);
        cell.appendChild(dur);
      }
    } else {
      var overlay = document.createElement('div');
      overlay.className = 'processing-overlay';
      var spinner = document.createElement('div');
      spinner.className = 'processing-spinner';
      overlay.appendChild(spinner);
      cell.appendChild(overlay);
    }

    cell.addEventListener('click', function () {
      if (videoLongPressed) { videoLongPressed = false; return; }
      if (videoSelectMode) {
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
        return;
      }
      if (video.status === 'ready') {
        lightboxIndex = index;
        galleryPhotos = videosData;
        showLightboxPhoto();
        $lightbox.classList.add('active');
      }
    });

    $videoGrid.appendChild(cell);
  }

  // ── API Helper ────────────────────────────────────────
  var lastAuthToast = 0;
  function apiRequest(method, url, body, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url);
    setAuthHeader(xhr);
    if (body) xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.addEventListener('load', function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var data = JSON.parse(xhr.responseText);
          if (callback) callback(data);
        } catch (_) {
          if (callback) callback(null);
        }
      } else if (xhr.status === 401) {
        // Token expired — update UI, show toast once (not per-request spam)
        currentUser = null;
        saveAuthLocally(null);
        updateAuthUI();
        if (Date.now() - lastAuthToast > 5000) {
          lastAuthToast = Date.now();
          toast('Session expired, please log in again', true);
        }
      } else if (xhr.status === 429) {
        toast('Too many requests, please wait a moment', true);
      } else {
        var err = 'Request failed';
        try { err = JSON.parse(xhr.responseText).error || err; } catch (_) { /* */ }
        toast(err, true);
      }
    });

    xhr.addEventListener('error', function () { toast('Network error', true); });
    xhr.send(body ? JSON.stringify(body) : null);
  }

  // ── Swipe Cleanup Mode ────────────────────────────────
  var swipePhotos = [];
  var swipeIndex = 0;
  var swipeDeletedCount = 0;
  var swipeDragging = false;
  var swipeDragStartX = 0;
  var swipeDragX = 0;
  var swipeBusy = false;

  // Track reviewed photos per album in localStorage
  function getReviewedIds(albumId) {
    try {
      return JSON.parse(localStorage.getItem('pokkit_reviewed_' + albumId) || '[]');
    } catch (_) { return []; }
  }

  function markReviewed(albumId, photoId) {
    var ids = getReviewedIds(albumId);
    if (ids.indexOf(photoId) === -1) ids.push(photoId);
    localStorage.setItem('pokkit_reviewed_' + albumId, JSON.stringify(ids));
  }

  function resetReviewed(albumId) {
    localStorage.removeItem('pokkit_reviewed_' + albumId);
  }

  function enterSwipeMode() {
    var readyPhotos = galleryPhotos.filter(function (p) { return p.status === 'ready'; });
    // Deduplicate by ID (safety net)
    var seen = {};
    readyPhotos = readyPhotos.filter(function (p) {
      if (seen[p.id]) return false;
      seen[p.id] = true;
      return true;
    });
    var reviewed = getReviewedIds(currentAlbumId);
    swipePhotos = readyPhotos.filter(function (p) { return reviewed.indexOf(p.id) === -1; });

    if (swipePhotos.length === 0 && readyPhotos.length > 0) {
      if (confirm('All ' + readyPhotos.length + ' photos already reviewed.\nReset and review all again?')) {
        resetReviewed(currentAlbumId);
        swipePhotos = readyPhotos;
      } else {
        return;
      }
    }
    if (swipePhotos.length === 0) { toast('No photos to review'); return; }

    swipeIndex = 0;
    swipeDeletedCount = 0;
    swipeBusy = false;
    $swipeSummary.classList.remove('visible');
    $swipeStage.style.display = '';
    $swipeHint.style.display = '';
    $swipeActions.style.display = '';
    $swipeMode.classList.add('active');
    document.body.style.overflow = 'hidden';
    showSwipeCard();
  }

  function exitSwipeMode() {
    $swipeMode.classList.remove('active');
    document.body.style.overflow = '';
    // Clean up video
    $swipeVideo.pause();
    $swipeVideo.removeAttribute('src');
    if (swipeDeletedCount > 0) {
      toast('Deleted ' + swipeDeletedCount + ' items');
      openAlbum(currentAlbumId, currentAlbumName);
    }
  }

  function showSwipeCard() {
    if (swipeIndex >= swipePhotos.length) { showSwipeSummary(); return; }

    // Reset card position, keep HIDDEN until new content loads
    $swipeCard.classList.remove('animating');
    $swipeCard.style.transition = 'none';
    $swipeCard.style.transform = 'translateX(0) rotate(0deg)';
    $swipeCard.style.opacity = '0';
    $swipeStampKeep.style.opacity = '0';
    $swipeStampDelete.style.opacity = '0';
    void $swipeCard.offsetHeight;

    // Stop any playing video
    $swipeVideo.pause();
    $swipeVideo.removeAttribute('src');

    var photo = swipePhotos[swipeIndex];
    $swipeProgress.textContent = (swipeIndex + 1) + ' / ' + swipePhotos.length;

    var revealed = false;
    function reveal() {
      if (revealed) return;
      revealed = true;
      $swipeImg.onload = null;
      $swipeImg.onerror = null;
      $swipeCard.style.opacity = '1';
      void $swipeCard.offsetHeight;
      $swipeCard.style.transition = '';
      swipeBusy = false;
    }

    if (isVideoEntry(photo)) {
      $swipeImg.hidden = true;
      $swipeVideo.hidden = false;
      $swipeVideo.src = '/photos/' + photo.id + '/video.mp4';
      $swipeVideo.load();
      $swipeVideo.onloadeddata = function () {
        reveal();
        $swipeVideo.play().catch(function () {});
      };
      // Fallback reveal after timeout
      setTimeout(reveal, 3000);
    } else {
      $swipeVideo.hidden = true;
      $swipeImg.hidden = false;

      // Preload next image so transition feels instant
      if (swipeIndex + 1 < swipePhotos.length && !isVideoEntry(swipePhotos[swipeIndex + 1])) {
        (new Image()).src = '/photos/' + swipePhotos[swipeIndex + 1].id + '/photo.webp';
      }

      var newSrc = '/photos/' + photo.id + '/photo.webp';
      $swipeImg.onload = reveal;
      $swipeImg.onerror = reveal;
      $swipeImg.src = newSrc;
      if ($swipeImg.complete) reveal();
    }
  }

  function doSwipeAction(direction) {
    if (swipeBusy || swipeIndex >= swipePhotos.length) return;
    swipeBusy = true;
    var photo = swipePhotos[swipeIndex];
    var tx = direction === 'left' ? -1200 : 1200;
    var rot = direction === 'left' ? -25 : 25;

    // Pause video before swiping away
    if (isVideoEntry(photo)) $swipeVideo.pause();

    // Show stamp at full opacity
    if (direction === 'left') {
      $swipeStampDelete.style.opacity = '1';
    } else {
      $swipeStampKeep.style.opacity = '1';
    }

    $swipeCard.style.transition = '';
    $swipeCard.classList.add('animating');
    $swipeCard.style.transform = 'translateX(' + tx + 'px) rotate(' + rot + 'deg)';
    $swipeCard.style.opacity = '0';

    if (direction === 'left') {
      swipeDeletedCount++;
      apiRequest('DELETE', '/files/' + photo.id, null, null);
    } else {
      // Right swipe = keep — mark as reviewed
      markReviewed(currentAlbumId, photo.id);
    }

    setTimeout(function () {
      swipeIndex++;
      showSwipeCard();
    }, 350);
  }

  function showSwipeSummary() {
    $swipeStage.style.display = 'none';
    $swipeHint.style.display = 'none';
    $swipeActions.style.display = 'none';
    $swipeSummary.classList.add('visible');
    var kept = swipePhotos.length - swipeDeletedCount;
    $swipeSummaryStats.innerHTML = 'Deleted: ' + swipeDeletedCount + '<br>Kept: ' + kept;
    $swipeProgress.textContent = 'Done!';
  }

  // Drag/touch handlers
  function swipeDragStart(e) {
    if (swipeBusy || swipeIndex >= swipePhotos.length) return;
    swipeDragging = true;
    swipeDragStartX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    swipeDragX = 0;
    $swipeCard.classList.remove('animating');
    $swipeCard.style.transition = 'none';
  }

  function swipeDragMove(e) {
    if (!swipeDragging) return;
    e.preventDefault();
    var cx = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
    swipeDragX = cx - swipeDragStartX;
    var rot = swipeDragX * 0.06;
    $swipeCard.style.transform = 'translateX(' + swipeDragX + 'px) rotate(' + rot + 'deg)';

    var pct = Math.min(Math.abs(swipeDragX) / 120, 1);
    if (swipeDragX < 0) {
      $swipeStampDelete.style.opacity = pct;
      $swipeStampKeep.style.opacity = '0';
    } else {
      $swipeStampKeep.style.opacity = pct;
      $swipeStampDelete.style.opacity = '0';
    }
  }

  function swipeDragEnd() {
    if (!swipeDragging) return;
    swipeDragging = false;
    $swipeCard.style.transition = '';
    if (Math.abs(swipeDragX) > 100) {
      doSwipeAction(swipeDragX < 0 ? 'left' : 'right');
    } else {
      // Snap back with animation
      $swipeCard.classList.add('animating');
      $swipeCard.style.transform = 'translateX(0) rotate(0deg)';
      $swipeStampKeep.style.opacity = '0';
      $swipeStampDelete.style.opacity = '0';
    }
  }

  $swipeCard.addEventListener('mousedown', swipeDragStart);
  document.addEventListener('mousemove', swipeDragMove);
  document.addEventListener('mouseup', swipeDragEnd);
  $swipeCard.addEventListener('touchstart', swipeDragStart, { passive: true });
  document.addEventListener('touchmove', swipeDragMove, { passive: false });
  document.addEventListener('touchend', swipeDragEnd);

  $swipeBtnDelete.addEventListener('click', function () { doSwipeAction('left'); });
  $swipeBtnKeep.addEventListener('click', function () { doSwipeAction('right'); });
  $swipeClose.addEventListener('click', exitSwipeMode);
  $swipeSummaryDone.addEventListener('click', exitSwipeMode);
  $galleryCleanup.addEventListener('click', enterSwipeMode);

  document.addEventListener('keydown', function (e) {
    if (!$swipeMode.classList.contains('active')) return;
    if (e.key === 'ArrowLeft') doSwipeAction('left');
    if (e.key === 'ArrowRight') doSwipeAction('right');
    if (e.key === 'Escape') exitSwipeMode();
  });

  // ── Init ──────────────────────────────────────────────

  function applyUser(user) {
    currentUser = user || null;
    saveAuthLocally(currentUser);
    updateAuthUI();
    loadFiles();
    if (currentUser) loadStats();
  }

  // Step 1: Instantly restore from our own localStorage cache
  // This gives ZERO-delay login state on Ctrl+R
  var cached = loadCachedUser();
  if (cached) {
    currentUser = cached;
    updateAuthUI();
    loadFiles();
    loadStats();
  } else {
    updateAuthUI();
    loadFiles();
  }

  // Show the page matching the current URL (default: folders)
  navigate(routeFromPath(), false);

  // Reveal the admin-only Projects nav (uses cached token if present).
  if (cached) checkAdmin();

  // Step 2: When SDK loads, only accept LOGIN events (user truthy).
  // NEVER clear cache from onAuthChange(null) — that kills our restore.
  // Cache is only cleared by: explicit logout button + API 401 response.
  waitForLetMeUse().then(function () {
    if (typeof letmeuse === 'undefined') return;

    letmeuse.onAuthChange(function (user) {
      if (user) {
        // Login or session restored — update and save
        applyUser(user);
        checkAdmin();
      }
      // null = SDK init or token issue — DON'T clear cache.
      // Explicit logout and 401 handler take care of that.
    });
  });
})();
