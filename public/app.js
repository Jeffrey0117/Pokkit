(function () {
  'use strict';

  var MAX_CONCURRENT = 10;

  // ── DOM ─────────────────────────────────────────────────
  var $stats = document.getElementById('stats');
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

  // ── Swipe Mode DOM ──────────────────────────────────────
  var $swipeMode = document.getElementById('swipeMode');
  var $swipeClose = document.getElementById('swipeClose');
  var $swipeProgress = document.getElementById('swipeProgress');
  var $swipeStage = document.getElementById('swipeStage');
  var $swipeCard = document.getElementById('swipeCard');
  var $swipeImg = document.getElementById('swipeImg');
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
  var toastTimer = null;
  var currentTab = 'files';
  var currentAlbumId = null;
  var currentAlbumName = '';
  var galleryPhotos = [];
  var lightboxIndex = -1;
  var processingPolls = {};
  var currentUser = null;

  // ── Auth (LetMeUse) ───────────────────────────────────
  function getToken() {
    if (typeof letmeuse !== 'undefined') {
      return letmeuse.getToken();
    }
    return null;
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
    updateAuthUI();
    toast('Logged out');
  });

  function waitForLetMeUse() {
    return new Promise(function (resolve) {
      if (typeof letmeuse !== 'undefined' && letmeuse.ready) { resolve(); return; }
      var check = setInterval(function () {
        if (typeof letmeuse !== 'undefined' && letmeuse.ready) {
          clearInterval(check); resolve();
        }
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
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
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
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  });

  // ── Upload ──────────────────────────────────────────────
  function handleFiles(fileList) {
    $queueSection.hidden = false;
    for (var i = 0; i < fileList.length; i++) pending.push(fileList[i]);
    processQueue();
  }

  function processQueue() {
    while (uploading < MAX_CONCURRENT && pending.length > 0) {
      uploadFile(pending.shift());
    }
  }

  function uploadFile(file) {
    uploading++;

    var row = document.createElement('div');
    row.className = 'queue-item';

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
                galleryPhotos = albumData.photos || [];
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
        currentUser = null;
        updateAuthUI();
        if (Date.now() - lastAuthToast > 5000) {
          lastAuthToast = Date.now();
          toast('Session expired, please log in again', true);
        }
        bar.classList.add('error');
        bar.style.width = '100%';
        pct.textContent = '';
      } else {
        bar.classList.add('error');
        bar.style.width = '100%';
        pct.textContent = '';
        var err = 'Upload failed';
        try { err = JSON.parse(xhr.responseText).error || err; } catch (_) { /* */ }
        toast(file.name + ': ' + err, true);
      }

      uploading--;
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
      bar.classList.add('error');
      bar.style.width = '100%';
      pct.textContent = '';
      toast(file.name + ': Network error', true);
      uploading--;
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

  // ── Stats ───────────────────────────────────────────────
  function loadStats() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/status');
    setAuthHeader(xhr);

    xhr.addEventListener('load', function () {
      if (xhr.status === 200) {
        try {
          var d = JSON.parse(xhr.responseText);
          $stats.textContent = d.totalFiles + ' files \u00b7 ' + formatBytes(d.totalBytes);
        } catch (_) { /* */ }
      } else {
        $stats.textContent = '';
      }
    });

    xhr.send();
  }

  // ── Tab Switching ──────────────────────────────────────
  $viewTabs.addEventListener('click', function (e) {
    var tab = e.target.closest('.tab');
    if (!tab) return;
    var tabName = tab.dataset.tab;
    switchTab(tabName);
  });

  function switchTab(tabName) {
    currentTab = tabName;
    var tabs = $viewTabs.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].dataset.tab === tabName);
    }
    $filesSection.hidden = tabName !== 'files';
    $albumsSection.hidden = tabName !== 'albums';
    $gallerySection.hidden = true;
    currentAlbumId = null;
    currentAlbumName = '';
    if (tabName === 'albums') loadAlbums();
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
      galleryPhotos = data.photos || [];
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

    if (photo.status === 'ready') {
      var img = document.createElement('img');
      img.src = '/photos/' + photo.id + '/thumb.webp';
      img.alt = photo.filename;
      img.loading = 'lazy';
      cell.appendChild(img);

      // Hover action buttons
      var actions = document.createElement('div');
      actions.className = 'photo-actions';

      var coverBtn = document.createElement('button');
      coverBtn.className = 'photo-action-btn';
      coverBtn.innerHTML = '&#9733;';
      coverBtn.title = 'Set as cover';
      coverBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        setAlbumCover(photo.id);
      });

      var delBtn = document.createElement('button');
      delBtn.className = 'photo-action-btn danger';
      delBtn.innerHTML = '&#10005;';
      delBtn.title = 'Delete';
      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
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
          var cell = $photoGrid.querySelector('[data-id="' + id + '"]');
          if (cell) {
            cell.innerHTML = '';
            var img = document.createElement('img');
            img.src = '/photos/' + id + '/thumb.webp';
            img.loading = 'lazy';
            cell.appendChild(img);
          }
          for (var i = 0; i < galleryPhotos.length; i++) {
            if (galleryPhotos[i].id === id) {
              galleryPhotos[i].status = 'ready';
              break;
            }
          }
        } else if (data.status === 'failed') {
          clearInterval(processingPolls[id]);
          delete processingPolls[id];
          toast('Photo processing failed: ' + id, true);
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
  }

  function showLightboxPhoto() {
    if (lightboxIndex < 0 || lightboxIndex >= galleryPhotos.length) return;
    var photo = galleryPhotos[lightboxIndex];
    $lightboxImg.src = '/photos/' + photo.id + '/photo.webp';
    var photoInfo = photo.filename;
    if (photo.width && photo.height) photoInfo += ' \u00b7 ' + photo.width + '\u00d7' + photo.height;
    if (photo.taken_at) photoInfo += ' \u00b7 ' + formatDate(photo.taken_at);
    $lightboxInfo.textContent = photoInfo;
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
    if (swipeDeletedCount > 0) {
      toast('Deleted ' + swipeDeletedCount + ' photos');
      openAlbum(currentAlbumId, currentAlbumName);
    }
  }

  function showSwipeCard() {
    if (swipeIndex >= swipePhotos.length) { showSwipeSummary(); return; }

    // Kill all transitions instantly
    $swipeCard.classList.remove('animating');
    $swipeCard.style.transition = 'none';
    $swipeCard.style.transform = 'translateX(0) rotate(0deg)';
    $swipeCard.style.opacity = '1';
    $swipeStampKeep.style.opacity = '0';
    $swipeStampDelete.style.opacity = '0';

    var photo = swipePhotos[swipeIndex];
    $swipeImg.src = '/photos/' + photo.id + '/photo.webp';
    $swipeProgress.textContent = (swipeIndex + 1) + ' / ' + swipePhotos.length;

    // Force reflow so 'transition: none' takes effect before we re-enable
    void $swipeCard.offsetHeight;

    // Re-enable transitions for next swipe
    $swipeCard.style.transition = '';
    swipeBusy = false;
  }

  function doSwipeAction(direction) {
    if (swipeBusy || swipeIndex >= swipePhotos.length) return;
    swipeBusy = true;
    var photo = swipePhotos[swipeIndex];
    var tx = direction === 'left' ? -1200 : 1200;
    var rot = direction === 'left' ? -25 : 25;

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
    }, 280);
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
  // Don't show login/logout until SDK resolves — both buttons start hidden in HTML

  waitForLetMeUse().then(function () {
    if (typeof letmeuse === 'undefined' || !letmeuse.ready) {
      // SDK failed to load — show guest mode
      updateAuthUI();
      loadFiles();
      return;
    }

    // SDK is ready — read current user immediately (session restored from localStorage)
    currentUser = letmeuse.user || null;
    updateAuthUI();
    loadFiles();
    loadStats();

    // Listen for future login/logout
    letmeuse.onAuthChange(function (user) {
      currentUser = user || null;
      updateAuthUI();
      loadFiles();
      loadStats();
    });
  });
})();
