/**
 * password-intent — only a password the user actually entered counts.
 *
 * The upload page has an optional "Password" field. Browsers and password
 * managers autofill saved login passwords into any type=password input —
 * Chrome ignores autocomplete="off" there on purpose — so a file could be
 * locked with a password the uploader never chose and never saw
 * (2026-11-11: a zip came out "locked" this way).
 *
 * Autofill only sets .value and fires input/change. A person types (keydown /
 * beforeinput) or pastes / drops. So: a value with no such interaction behind
 * it is discarded and wiped from the field.
 *
 * Usage:
 *   var intent = window.PokkitPasswordIntent.attach(inputEl);
 *   intent.value();  // '' unless the user entered it
 *   intent.reset();  // clear the field, require fresh input next time
 *
 *   // when files are added: one password for the whole batch
 *   window.PokkitPasswordIntent.stampBatch(files, intent);
 *   // when a file is actually uploaded
 *   window.PokkitPasswordIntent.passwordFor(file);
 */
(function (root) {
  'use strict';

  // Keys that edit the field. Tab / arrows / modifiers pass through a field
  // without expressing any intent to set a password.
  function isEditingKey(key) {
    if (typeof key !== 'string') return false;
    if (key.length === 1) return true; // a printable character
    return key === 'Backspace' || key === 'Delete' || key === 'Unidentified' || key === 'Process' || key === 'Dead';
  }

  function attach(input) {
    var touched = false;

    // First real interaction: whatever is already in the field was put there
    // by something else — drop it before the user's own input lands.
    function markTouched() {
      if (touched) return;
      if (input.value) input.value = '';
      touched = true;
    }

    function discardIfUntouched() {
      if (!touched && input.value) input.value = '';
    }

    input.addEventListener('keydown', function (e) {
      if (e && isEditingKey(e.key)) markTouched();
    });
    input.addEventListener('paste', markTouched);
    input.addEventListener('drop', markTouched);
    // Virtual keyboards and IMEs may not produce a usable keydown, but they do
    // fire beforeinput; autofill does not.
    input.addEventListener('beforeinput', function (e) {
      if (e && e.isTrusted !== false && typeof e.inputType === 'string') markTouched();
    });
    input.addEventListener('input', discardIfUntouched);
    input.addEventListener('change', discardIfUntouched);

    return {
      value: function () {
        if (!touched) {
          discardIfUntouched();
          return '';
        }
        return String(input.value || '').trim();
      },
      reset: function () {
        input.value = '';
        touched = false;
      },
      touched: function () {
        return touched;
      },
    };
  }

  /**
   * Bind the password to a whole batch at the moment its files are added.
   *
   * Uploads used to read the field when each one STARTED, and the field was
   * cleared when the first one finished. With 10 uploads in flight at a time,
   * a 25-file batch with a password ended up with 10 locked files and 15 open
   * links — while the uploader believed all 25 were protected.
   *
   * A file that already carries a stamp keeps it: retries and re-queues pass
   * the same File object through again, long after the field has moved on.
   *
   * @returns {{password: string, stamped: number}}
   */
  function stampBatch(files, intent) {
    var password = intent.value();
    var stamped = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (f && f.__password === undefined) {
        f.__password = password;
        stamped++;
      }
    }
    intent.reset(); // the batch has taken it; the next batch starts clean
    return { password: password, stamped: stamped };
  }

  function passwordFor(file) {
    return file && typeof file.__password === 'string' ? file.__password : '';
  }

  root.PokkitPasswordIntent = { attach: attach, stampBatch: stampBatch, passwordFor: passwordFor };
})(typeof window !== 'undefined' ? window : this);
