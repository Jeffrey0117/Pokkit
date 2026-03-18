(function () {
  'use strict';

  var MAX_CONCURRENT = 10;

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
  var $galleryCount = document.getElementById('galleryCount');
  var $galleryRename = document.getElementById('galleryRename');
  var $galleryDelete = document.getElementById('galleryDelete');
  var $galleryCleanup = document.getElementById('galleryCleanup');
  var $gallerySelect = document.getElementById('gallerySelect');

  // ── Photos (All) DOM ──────────────────────────────────
  var $photosSection = document.getElementById('photosSection');
  var $allPhotoGrid = document.getElementById('allPhotoGrid');
  var $allPhotosSelect = document.getElementById('allPhotosSelect');

  // ── Selection DOM ─────────────────────────────────────
  var $selectionBar = document.getElementById('selectionBar');
  var $selectionCount = document.getElementById('selectionCount');
  var $selectionMove = document.getElementById('selectionMove');
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
  var processingPolls = {};
  var currentUser = null;
  var selectMode = false;
  var selectedIds = [];
  var allPhotos = [];
  var allPhotosAlbumMap = {};

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
    if (currentUser) {
      $userName.textContent = currentUser.name || currentUser.email || '';
      $loginBtn.hidden = true;
      $logoutBtn.hidden = false;
      $dropzone.style.display = '';
      document.getElementById('uploadOptions').style.display = '';
    } else {
      $userName.textContent = '';
      $loginBtn.hidden = false;
      $logoutBtn.hidden = true;
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
    $toast.textContent = msg;
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

  function readEntriesRecursive(entry) {
    return new Promise(function (resolve) {
      if (entry.isFile) {
        entry.file(function (f) {
          resolve(MEDIA_EXTS.test(f.name) ? [f] : []);
        }, function () { resolve([]); });
      } else if (entry.isDirectory) {
        var reader = entry.createReader();
        var allEntries = [];
        (function readBatch() {
          reader.readEntries(function (entries) {
            if (entries.length === 0) {
              Promise.all(allEntries.map(readEntriesRecursive)).then(function (results) {
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
    Promise.all(entries.map(readEntriesRecursive)).then(function (results) {
      var files = [].concat.apply([], results);
      if (files.length > 0) handleFiles(files);
      else toast('No media files found in folder');
    });
  }

  // ── Upload ──────────────────────────────────────────────
  function handleFiles(fileList) {
    var files = Array.isArray(fileList) ? fileList : Array.from(fileList);
    if (files.length === 0) return;
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

  function uploadFile(file) {
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
    pct.textContent = '0%';

    row.appendChild(name);
    row.appendChild(size);
    row.appendChild(progWrap);
    row.appendChild(pct);
    $queueList.appendChild(row);

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
      // Retry on rate limit (429)
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
              apiRequest('GET', '/api/albums/' + currentAlbumId, null, function (albumData) {
                var photos = albumData.photos || [];
                var seen = {};
                galleryPhotos = photos.filter(function (p) {
                  if (seen[p.id]) return false;
                  seen[p.id] = true;
                  return true;
                });
                $galleryCount.textContent = galleryPhotos.length + ' photos';
                renderPhotoGrid();
              });
            }
          } else {
            showResult(data);
            addFileRow(data);
            $emptyState.style.display = 'none';
          }
        } catch (_) { /* */ }

        // Clear password after successful upload
        $passwordInput.value = '';
      } else if (xhr.status === 401) {
        batchFailed++;
        currentUser = null;
        saveAuthLocally(null);
        updateAuthUI();
        if (Date.now() - lastAuthToast > 5000) {
          lastAuthToast = Date.now();
          toast('Session expired, please log in again', true);
        }
        bar.classList.add('error');
        bar.style.width = '100%';
        pct.textContent = '';
      } else if (xhr.status === 413) {
        batchFailed++;
        bar.classList.add('error');
        bar.style.width = '100%';
        pct.textContent = '';
        var quotaErr = 'Storage full!';
        try { quotaErr = JSON.parse(xhr.responseText).error || quotaErr; } catch (_) { /* */ }
        toast(quotaErr, true);
      } else {
        batchFailed++;
        bar.classList.add('error');
        bar.style.width = '100%';
        pct.textContent = '';
        var err = 'Upload failed';
        try { err = JSON.parse(xhr.responseText).error || err; } catch (_) { /* */ }
        toast(file.name + ': ' + err, true);
      }

      uploading--;
      updateQueueSummary();
      processQueue();
      loadStats();

      setTimeout(function () {
        row.style.opacity = '0';
        row.style.transition = 'opacity 0.3s';
        setTimeout(function () {
          row.remove();
          if ($queueList.children.length === 0) $queueSection.hidden = true;
        }, 300);
      }, 2000);
    });

    xhr.addEventListener('error', function () {
      batchFailed++;
      bar.classList.add('error');
      bar.style.width = '100%';
      pct.textContent = '';
      toast(file.name + ': Network error', true);
      uploading--;
      updateQueueSummary();
      processQueue();
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
    meta.style.cssText = 'font-size:11px;color:#999;margin-top:8px';
    var metaText = data.filename + ' \u00b7 ' + formatBytes(data.size) + ' \u00b7 ' + (data.mime || 'unknown');
    if (data.has_password) metaText += ' \u00b7 password protected';
    if (data.expires_at) metaText += ' \u00b7 expires ' + formatDate(data.expires_at);
    meta.textContent = metaText;
    block.appendChild(meta);

    $dropzone.parentNode.insertBefore(block, $dropzone.nextSibling);
  }

  // ── File List ───────────────────────────────────────────
  function loadFiles() {
    if (!currentUser) {
      $fileList.innerHTML = '';
      $emptyState.style.display = '';
      $emptyState.querySelector('.empty-state-text').textContent = 'Login to manage files';
      $fileList.appendChild($emptyState);
      return;
    }

    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/files');
    setAuthHeader(xhr);

    xhr.addEventListener('load', function () {
      if (xhr.status === 200) {
        try {
          renderFiles(JSON.parse(xhr.responseText));
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

  function renderFiles(files) {
    $fileList.innerHTML = '';

    if (files.length === 0) {
      $emptyState.style.display = '';
      $emptyState.querySelector('.empty-state-text').textContent = 'No files yet';
      $fileList.appendChild($emptyState);
      return;
    }

    $emptyState.style.display = 'none';

    files.sort(function (a, b) { return b.uploaded_at - a.uploaded_at; });

    for (var i = 0; i < files.length; i++) {
      addFileRow(files[i]);
    }
  }

  function buildUrl(entry) {
    return '/f/' + entry.id;
  }

  function addFileRow(entry) {
    var url = entry.url || buildUrl(entry);
    var fullUrl = url;
    if (fullUrl && !fullUrl.startsWith('http')) {
      fullUrl = window.location.origin + url;
    }
    if (entry.url && entry.url.startsWith('http')) fullUrl = entry.url;

    var row = document.createElement('div');
    row.className = 'file-row';
    row.dataset.id = entry.id;

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
      lockSpan.style.color = '#e65100';
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

    var delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger';
    delBtn.textContent = 'Del';
    delBtn.addEventListener('click', function () { deleteFile(entry.id, row); });

    actions.appendChild(cpBtn);
    actions.appendChild(delBtn);
    row.appendChild(actions);

    if ($fileList.firstChild && $fileList.firstChild !== $emptyState) {
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
    currentTab = tabName;
    var tabs = $viewTabs.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].dataset.tab === tabName);
    }
    $filesSection.hidden = tabName !== 'files';
    $albumsSection.hidden = tabName !== 'albums';
    $photosSection.hidden = tabName !== 'photos';
    $gallerySection.hidden = true;
    currentAlbumId = null;
    currentAlbumName = '';
    if (tabName === 'albums') loadAlbums();
    if (tabName === 'photos') loadAllPhotos();
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

    apiRequest('GET', '/api/albums/' + albumId, null, function (data) {
      var photos = data.photos || [];
      // Deduplicate by ID
      var seen = {};
      galleryPhotos = photos.filter(function (p) {
        if (seen[p.id]) return false;
        seen[p.id] = true;
        return true;
      });
      $galleryCount.textContent = galleryPhotos.length + ' photos';
      renderPhotoGrid();
    });
  }

  $backToAlbums.addEventListener('click', function () {
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

  // ── Processing Poll ───────────────────────────────────
  function pollPhotoStatus(id) {
    if (processingPolls[id]) return;
    processingPolls[id] = setInterval(function () {
      apiRequest('GET', '/api/photos/' + id + '/status', null, function (data) {
        if (data.status === 'ready') {
          clearInterval(processingPolls[id]);
          delete processingPolls[id];

          // Find the entry to check if it's a video
          var entry = null;
          for (var i = 0; i < galleryPhotos.length; i++) {
            if (galleryPhotos[i].id === id) {
              galleryPhotos[i].status = 'ready';
              entry = galleryPhotos[i];
              break;
            }
          }

          var cell = $photoGrid.querySelector('[data-id="' + id + '"]');
          if (!cell) cell = $allPhotoGrid.querySelector('[data-id="' + id + '"]');
          if (cell) {
            cell.innerHTML = '';
            var checkbox = document.createElement('div');
            checkbox.className = 'photo-checkbox';
            cell.appendChild(checkbox);
            var img = document.createElement('img');
            img.src = '/photos/' + id + '/thumb.webp';
            img.loading = 'lazy';
            cell.appendChild(img);
            if (entry && isVideoEntry(entry)) {
              var playIcon = document.createElement('div');
              playIcon.className = 'video-play-icon';
              cell.appendChild(playIcon);
              if (entry.duration) {
                var dur = document.createElement('div');
                dur.className = 'video-duration';
                dur.textContent = formatDuration(entry.duration);
                cell.appendChild(dur);
              }
            }
          }
        } else if (data.status === 'failed') {
          clearInterval(processingPolls[id]);
          delete processingPolls[id];
          toast('Processing failed: ' + id, true);
        }
      });
    }, 2000);
  }

  // ── Lightbox ──────────────────────────────────────────
  function openLightbox(index) {
    lightboxIndex = index;
    showLightboxPhoto();
    $lightbox.classList.add('active');
  }

  function closeLightbox() {
    $lightbox.classList.remove('active');
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

    var photoInfo = photo.filename;
    if (photo.width && photo.height) photoInfo += ' \u00b7 ' + photo.width + '\u00d7' + photo.height;
    if (photo.duration) photoInfo += ' \u00b7 ' + formatDuration(photo.duration);
    if (photo.taken_at) photoInfo += ' \u00b7 ' + formatDate(photo.taken_at);
    $lightboxInfo.textContent = photoInfo;

    if (isVideoEntry(photo)) {
      // Clean up previous video before loading new one
      $lightboxVideo.pause();
      $lightboxVideo.removeAttribute('src');
      $lightboxImg.hidden = true;
      $lightboxVideo.hidden = false;
      $lightboxVideo.src = '/photos/' + photo.id + '/video.mp4';
      $lightboxVideo.load();
    } else {
      $lightboxVideo.pause();
      $lightboxVideo.removeAttribute('src');
      $lightboxVideo.hidden = true;
      $lightboxImg.hidden = false;
      $lightboxImg.src = '/photos/' + photo.id + '/photo.webp';
    }
  }

  $lightboxClose.addEventListener('click', closeLightbox);
  $lightboxPrev.addEventListener('click', function () {
    if (lightboxIndex > 0) { lightboxIndex--; showLightboxPhoto(); }
  });
  $lightboxNext.addEventListener('click', function () {
    if (lightboxIndex < galleryPhotos.length - 1) { lightboxIndex++; showLightboxPhoto(); }
  });

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
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft' && lightboxIndex > 0) { lightboxIndex--; showLightboxPhoto(); }
    if (e.key === 'ArrowRight' && lightboxIndex < galleryPhotos.length - 1) { lightboxIndex++; showLightboxPhoto(); }
  });

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
    apiRequest('GET', '/api/photos?limit=500', null, function (photos) {
      allPhotos = photos || [];
      // Also load album list to show album names as badges
      apiRequest('GET', '/api/albums', null, function (albums) {
        allPhotosAlbumMap = {};
        for (var i = 0; i < albums.length; i++) {
          allPhotosAlbumMap[albums[i].id] = albums[i].name;
        }
        renderAllPhotoGrid();
      });
    });
  }

  function renderAllPhotoGrid() {
    $allPhotoGrid.innerHTML = '';
    if (allPhotos.length === 0) {
      $allPhotoGrid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">~</div><div class="empty-state-text">No photos yet</div></div>';
      return;
    }
    for (var i = 0; i < allPhotos.length; i++) {
      addAllPhotoCell(allPhotos[i], i);
    }
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
      }
    });

    $allPhotoGrid.appendChild(cell);
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

  // Step 2: When SDK loads, only accept LOGIN events (user truthy).
  // NEVER clear cache from onAuthChange(null) — that kills our restore.
  // Cache is only cleared by: explicit logout button + API 401 response.
  waitForLetMeUse().then(function () {
    if (typeof letmeuse === 'undefined') return;

    letmeuse.onAuthChange(function (user) {
      if (user) {
        // Login or session restored — update and save
        applyUser(user);
      }
      // null = SDK init or token issue — DON'T clear cache.
      // Explicit logout and 401 handler take care of that.
    });
  });
})();
