(function () {
  'use strict';

  var STORAGE_KEY = 'pokkit_api_key';
  var MAX_CONCURRENT = 3;

  // ── DOM ─────────────────────────────────────────────────
  var $apiKey = document.getElementById('apiKeyInput');
  var $stats = document.getElementById('stats');
  var $dropzone = document.getElementById('dropzone');
  var $fileInput = document.getElementById('fileInput');
  var $passwordInput = document.getElementById('passwordInput');
  var $expirySelect = document.getElementById('expirySelect');
  var $queueSection = document.getElementById('queueSection');
  var $queueList = document.getElementById('queueList');
  var $fileList = document.getElementById('fileList');
  var $emptyState = document.getElementById('emptyState');
  var $toast = document.getElementById('toast');

  // ── State ───────────────────────────────────────────────
  var uploading = 0;
  var pending = [];
  var toastTimer = null;

  // ── Init ────────────────────────────────────────────────
  $apiKey.value = localStorage.getItem(STORAGE_KEY) || '';
  $apiKey.addEventListener('input', function () {
    localStorage.setItem(STORAGE_KEY, $apiKey.value);
    loadFiles();
    loadStats();
  });

  loadFiles();
  loadStats();

  // ── Helpers ─────────────────────────────────────────────
  function getKey() {
    return $apiKey.value.trim();
  }

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
  $dropzone.addEventListener('click', function () { $fileInput.click(); });

  $dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
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
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  });

  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) { e.preventDefault(); });

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
    fd.append('file', file);

    // Append optional password and expiry
    var pw = $passwordInput.value.trim();
    if (pw) fd.append('password', pw);
    var exp = $expirySelect.value;
    if (exp && exp !== 'forever') fd.append('expiresIn', exp);

    xhr.upload.addEventListener('progress', function (e) {
      if (e.lengthComputable) {
        var p = Math.round((e.loaded / e.total) * 100);
        bar.style.width = p + '%';
        pct.textContent = p + '%';
      }
    });

    xhr.addEventListener('load', function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        bar.style.width = '100%';
        bar.classList.add('done');
        pct.textContent = '';

        try {
          var data = JSON.parse(xhr.responseText);
          showResult(data);
          addFileRow(data);
          $emptyState.style.display = 'none';
        } catch (_) { /* */ }

        // Clear password after successful upload
        $passwordInput.value = '';
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
    var key = getKey();
    if (key) xhr.setRequestHeader('Authorization', 'Bearer ' + key);
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
    var key = getKey();
    if (!key) {
      // No admin key — don't load file list (upload still works)
      $fileList.innerHTML = '';
      $emptyState.style.display = '';
      $emptyState.querySelector('.empty-state-text').textContent = 'Enter admin key to manage files';
      $fileList.appendChild($emptyState);
      return;
    }

    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/files');
    xhr.setRequestHeader('Authorization', 'Bearer ' + key);

    xhr.addEventListener('load', function () {
      if (xhr.status === 200) {
        try {
          renderFiles(JSON.parse(xhr.responseText));
        } catch (_) { /* */ }
      } else if (xhr.status === 401) {
        $fileList.innerHTML = '';
        $emptyState.style.display = '';
        $emptyState.querySelector('.empty-state-text').textContent = 'Invalid admin key';
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

    var copyBtn = document.createElement('button');
    copyBtn.className = 'btn';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', function () { copyUrl(fullUrl); });

    var delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger';
    delBtn.textContent = 'Del';
    delBtn.addEventListener('click', function () { deleteFile(entry.id, row); });

    actions.appendChild(copyBtn);
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
    var key = getKey();
    if (key) xhr.setRequestHeader('Authorization', 'Bearer ' + key);

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
    var key = getKey();
    if (key) xhr.setRequestHeader('Authorization', 'Bearer ' + key);

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
})();
