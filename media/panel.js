(function () {
  // Acquire VS Code API — must be called only once
  const vscode = acquireVsCodeApi();

  const applyBtn = document.getElementById('apply-btn');
  const selectAllCb = document.getElementById('select-all-cb');
  const selectAllText = document.getElementById('select-all-text');
  const stageCommitPushBtn = document.getElementById('stage-commit-push-btn');
  const gitNotice = document.getElementById('git-notice');
  const applyProgress = document.getElementById('apply-progress');
  const applyProgressText = document.getElementById('apply-progress-text');
  const applyProgressFill = document.getElementById('apply-progress-fill');
  var settledCount = 0;  // done + failed
  var totalApplying = 0;

  // ─── Grouping / sorting state ────────────────────────────────────────────────
  var currentGroup = 'none';  // 'none' | 'file' | 'type'
  var currentSort = 'default'; // 'default' | 'file' | 'complexity'
  var collapsedGroups = new Set(); // tracks which group keys are collapsed

  var COMPLEXITY_ORDER = { low: 0, medium: 1, high: 2 };
  var TYPE_LABELS = { 'fix-with-copilot': 'Fix With Copilot', 'commit-suggestion': 'Commit Suggestion' };

  function getAllCards() {
    return Array.from(document.querySelectorAll('.card[data-number]'));
  }

  function getCheckboxes() {
    return Array.from(document.querySelectorAll('.comment-checkbox'));
  }

  function renderGrouped() {
    var list = document.getElementById('comment-list');
    if (!list) { return; }

    var cards = getAllCards();

    // Detach all cards and remove existing group headers
    cards.forEach(function(c) { list.removeChild(c); });
    Array.from(list.querySelectorAll('.group-header')).forEach(function(h) { list.removeChild(h); });

    // Sort
    cards.sort(function(a, b) {
      if (currentSort === 'file') {
        var fa = (a.dataset.file || '').toLowerCase();
        var fb = (b.dataset.file || '').toLowerCase();
        if (fa < fb) { return -1; }
        if (fa > fb) { return 1; }
        return Number(a.dataset.number || 0) - Number(b.dataset.number || 0);
      }
      if (currentSort === 'complexity') {
        var ca = COMPLEXITY_ORDER[a.dataset.complexity] ?? 0;
        var cb = COMPLEXITY_ORDER[b.dataset.complexity] ?? 0;
        if (ca !== cb) { return cb - ca; }
        return Number(a.dataset.number || 0) - Number(b.dataset.number || 0);
      }
      // default: original order
      return Number(a.dataset.number || 0) - Number(b.dataset.number || 0);
    });

    if (currentGroup === 'none') {
      cards.forEach(function(c) { list.appendChild(c); });
      return;
    }

    // Group cards
    var groups = {};
    var groupOrder = [];
    cards.forEach(function(c) {
      var key = currentGroup === 'file' ? (c.dataset.file || '') : (c.dataset.type || '');
      if (!groups[key]) {
        groups[key] = [];
        groupOrder.push(key);
      }
      groups[key].push(c);
    });

    groupOrder.forEach(function(key) {
      var isCollapsed = collapsedGroups.has(key);
      var header = document.createElement('div');
      header.className = 'group-header' + (isCollapsed ? ' collapsed' : '');
      header.dataset.groupKey = key;
      var label = currentGroup === 'type' ? (TYPE_LABELS[key] || key) : key;
      var count = groups[key].length;
      header.innerHTML = '<span class="group-header-chevron">&#9660;</span>'
        + '<span class="group-header-label">' + escapeHtmlJs(label) + '</span>'
        + '<span class="group-header-count">' + count + '</span>';
      header.addEventListener('click', function() {
        var collapsed = header.classList.toggle('collapsed');
        if (collapsed) {
          collapsedGroups.add(key);
        } else {
          collapsedGroups.delete(key);
        }
        groups[key].forEach(function(c) {
          c.style.display = collapsed ? 'none' : '';
        });
      });
      list.appendChild(header);
      groups[key].forEach(function(c) {
        c.style.display = isCollapsed ? 'none' : '';
        list.appendChild(c);
      });
    });
  }

  function escapeHtmlJs(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ─── Group / sort button wiring ───────────────────────────────────────────────
  document.querySelectorAll('.group-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.group-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      currentGroup = btn.dataset.group;
      renderGrouped();
    });
  });

  document.querySelectorAll('.sort-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.sort-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      currentSort = btn.dataset.sort;
      renderGrouped();
    });
  });

  // ─── Checkbox / apply wiring ─────────────────────────────────────────────────
  function updateApplyButton() {
    const checked = getCheckboxes().filter(function(cb) { return cb.checked && !cb.disabled; });
    const n = checked.length;
    applyBtn.disabled = n === 0;
    applyBtn.textContent = n > 0 ? 'Apply (' + n + ' selected)' : 'Apply Selected Fixes';
    updateSelectAll();
  }

  function updateSelectAll() {
    var cbs = getCheckboxes().filter(function(cb) { return !cb.disabled; });
    var checkedCount = cbs.filter(function(cb) { return cb.checked; }).length;
    if (cbs.length > 0 && checkedCount === cbs.length) {
      selectAllCb.checked = true;
      selectAllCb.indeterminate = false;
      selectAllText.textContent = 'Uncheck all';
    } else if (checkedCount === 0) {
      selectAllCb.checked = false;
      selectAllCb.indeterminate = false;
      selectAllText.textContent = 'Select all';
    } else {
      selectAllCb.indeterminate = true;
      selectAllCb.checked = false;
      selectAllText.textContent = 'Select all';
    }
  }

  selectAllCb.addEventListener('change', function () {
    var check = selectAllCb.checked;
    selectAllCb.indeterminate = false;
    getCheckboxes().filter(function(cb) { return !cb.disabled; }).forEach(function(cb) { cb.checked = check; });
    selectAllText.textContent = check ? 'Uncheck all' : 'Select all';
    updateApplyButton();
  });

  document.addEventListener('change', function (e) {
    if (e.target && e.target.classList.contains('comment-checkbox')) {
      updateApplyButton();
    }
  });

  applyBtn.addEventListener('click', function () {
    const selectedIds = getCheckboxes()
      .filter((cb) => cb.checked)
      .map((cb) => Number(cb.dataset.id));
    totalApplying = selectedIds.length;
    settledCount = 0;
    updateApplyProgress(0, totalApplying);
    if (applyProgress) { applyProgress.classList.remove('hidden', 'done'); }
    vscode.postMessage({ command: 'applyFixes', selectedIds: selectedIds });
  });

  stageCommitPushBtn.addEventListener('click', function () {
    vscode.postMessage({ command: 'stageCommitAndPush' });
    stageCommitPushBtn.disabled = true;
    stageCommitPushBtn.textContent = 'Pushing\u2026';
  });

  window.addEventListener('message', function (event) {
    const message = event.data;
    if (message.command === 'fixStatus') {
      updateCardStatus(message.status);
    } else if (message.command === 'applyProgress') {
      updateApplyProgress(message.current, message.total);
    } else if (message.command === 'gitStatus') {
      updateGitStatus(message.status);
    } else if (message.command === 'banner') {
      showBanner(message.message, message.type);
    }
  });

  function updateApplyProgress(current, total) {
    if (!applyProgress || !applyProgressText || !applyProgressFill) { return; }
    if (total === 0) { return; }
    var pct = Math.round(current / total * 100);
    applyProgressFill.style.width = pct + '%';
    var spinner = document.getElementById('apply-progress-spinner');
    if (current >= total) {
      applyProgress.classList.add('done');
      // Update text node, leaving the spinner span in place
      var textNode = applyProgressText.lastChild;
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        textNode.textContent = 'All ' + total + ' fixes applied';
      } else {
        applyProgressText.appendChild(document.createTextNode('All ' + total + ' fixes applied'));
      }
      // brief pause so user sees 100%, then hide
      setTimeout(function() { applyProgress.classList.add('hidden'); }, 1400);
    } else {
      applyProgress.classList.remove('done');
      var label = 'Applying fixes: ' + current + ' / ' + total + ' done';
      var textNode2 = applyProgressText.lastChild;
      if (textNode2 && textNode2.nodeType === Node.TEXT_NODE) {
        textNode2.textContent = label;
      } else {
        applyProgressText.appendChild(document.createTextNode(label));
      }
    }
  }

  function showBanner(message, type) {
    var bannerArea = document.getElementById('banner-area');
    if (!bannerArea) { return; }
    var div = document.createElement('div');
    div.className = 'banner banner-' + (type || 'info');
    div.textContent = message;
    bannerArea.appendChild(div);
  }

  function updateGitStatus(status) {
    if (status.state === 'building') {
      stageCommitPushBtn.disabled = true;
      stageCommitPushBtn.textContent = 'Building\u2026';
      gitNotice.classList.add('hidden');
      gitNotice.textContent = '';
    } else if (status.state === 'build-failed') {
      stageCommitPushBtn.disabled = false;
      stageCommitPushBtn.textContent = 'Stage, Commit \u0026 Push';
      showBuildFailedNotice(status.reason);
    } else if (status.state === 'build-succeeded') {
      stageCommitPushBtn.disabled = true;
      stageCommitPushBtn.textContent = 'Build succeeded \u2713';
      gitNotice.classList.add('hidden');
      gitNotice.textContent = '';
    } else if (status.state === 'pushing') {
      stageCommitPushBtn.disabled = true;
      stageCommitPushBtn.textContent = 'Pushing\u2026';
      gitNotice.classList.add('hidden');
    } else if (status.state === 'pushed') {
      stageCommitPushBtn.textContent = 'Pushed \u2713';
      stageCommitPushBtn.disabled = true;
    } else if (status.state === 'push-failed') {
      stageCommitPushBtn.disabled = false;
      stageCommitPushBtn.textContent = 'Stage, Commit & Push';
      showGitNotice(status.reason, 'git-notice-error');
    } else if (status.state === 'no-repo') {
      stageCommitPushBtn.classList.add('hidden');
      showGitNotice('Git repository not found. Please stage and commit manually.', 'git-notice-error');
    }
  }

  function showBuildFailedNotice(reason) {
    gitNotice.innerHTML = '';
    gitNotice.className = 'git-notice git-notice-error';

    var header = document.createElement('div');
    header.className = 'git-notice-header';
    header.textContent = '\u26a0\ufe0f Build failed \u2014 fix the errors below, then click Retry Build.';
    gitNotice.appendChild(header);

    var pre = document.createElement('pre');
    pre.className = 'git-notice-pre';
    pre.textContent = reason;
    gitNotice.appendChild(pre);

    var retryBtn = document.createElement('button');
    retryBtn.className = 'secondary';
    retryBtn.textContent = 'Retry Build';
    retryBtn.addEventListener('click', function () {
      retryBtn.disabled = true;
      retryBtn.textContent = 'Building\u2026';
      vscode.postMessage({ command: 'retryBuild' });
    });
    gitNotice.appendChild(retryBtn);
    gitNotice.classList.remove('hidden');
  }

  function showGitNotice(message, cls) {
    gitNotice.textContent = message;
    gitNotice.className = 'git-notice ' + (cls || '');
  }

  function updateCardStatus(status) {
    const checkbox = document.querySelector('.comment-checkbox[data-id="' + status.id + '"]');
    if (!checkbox) { return; }
    const card = checkbox.closest('.card');
    if (!card) { return; }

    let statusEl = card.querySelector('.fix-status');
    if (!statusEl) {
      statusEl = document.createElement('div');
      statusEl.className = 'fix-status';
      card.querySelector('.card-body').appendChild(statusEl);
    }

    if (status.state === 'thinking') {
      var streamEl = card.querySelector('.fix-stream');
      if (!streamEl) {
        streamEl = document.createElement('pre');
        streamEl.className = 'fix-stream';
        card.appendChild(streamEl);
      }
      streamEl.textContent += status.text;
      streamEl.scrollTop = streamEl.scrollHeight;
      return;
    }

    // Keep stream visible but dim it once settled
    var existingStream = card.querySelector('.fix-stream');
    if (existingStream) { existingStream.classList.add('fix-stream-settled'); }

    statusEl.className = 'fix-status';
    card.classList.remove('state-applying', 'state-done', 'state-failed');
    if (status.state === 'applying') {
      card.classList.add('state-applying');
      statusEl.classList.add('fix-applying');
      statusEl.textContent = '';
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      // Adjust for sticky header so the card isn't hidden behind it
      var stickyTop = document.querySelector('.sticky-top');
      var headerHeight = stickyTop ? stickyTop.offsetHeight : 0;
      var cardTop = card.getBoundingClientRect().top + window.scrollY;
      var viewportTop = window.scrollY + headerHeight;
      if (cardTop < viewportTop + 8) {
        window.scrollTo({ top: cardTop - headerHeight - 8, behavior: 'smooth' });
      }
    } else if (status.state === 'done') {
      card.classList.add('state-done');
      statusEl.classList.add('fix-done');
      statusEl.textContent = '\u2713 Done';
      stageCommitPushBtn.classList.remove('hidden');
      checkbox.checked = false;
      checkbox.disabled = true;
      updateApplyButton();
      settledCount++;
      updateApplyProgress(settledCount, totalApplying);
    } else if (status.state === 'failed') {
      card.classList.add('state-failed');
      statusEl.className = 'fix-status fix-failed';
      statusEl.innerHTML = '';
      var msgSpan = document.createElement('span');
      msgSpan.textContent = '\u2717 Failed: ' + status.reason;
      statusEl.appendChild(msgSpan);
      var retryBtn = document.createElement('button');
      retryBtn.className = 'secondary retry-btn';
      retryBtn.textContent = 'Retry';
      retryBtn.dataset.id = String(status.id);
      retryBtn.addEventListener('click', function () {
        retryBtn.disabled = true;
        vscode.postMessage({ command: 'retryFix', id: status.id });
      });
      statusEl.appendChild(retryBtn);
      settledCount++;
      updateApplyProgress(settledCount, totalApplying);
    }
  }

  // Initialise button state on load
  updateApplyButton();

  // Details expand/collapse animation
  document.querySelectorAll('details').forEach(function(det) {
    var summary = det.querySelector('summary');
    var body = det.querySelector('.details-body');
    if (!summary || !body) { return; }
    // Initialise open state — details rendered with [open] must have maxHeight set
    if (det.open) {
      body.style.maxHeight = 'none';
    }
    summary.addEventListener('click', function(e) {
      e.preventDefault();
      if (det.open) {
        body.style.maxHeight = body.scrollHeight + 'px';
        requestAnimationFrame(function() {
          requestAnimationFrame(function() {
            body.style.maxHeight = '0';
          });
        });
        body.addEventListener('transitionend', function handler() {
          det.open = false;
          body.removeEventListener('transitionend', handler);
        }, { once: true });
      } else {
        det.open = true;
        body.style.maxHeight = '0';
        requestAnimationFrame(function() {
          requestAnimationFrame(function() {
            body.style.maxHeight = body.scrollHeight + 'px';
          });
        });
        body.addEventListener('transitionend', function handler() {
          body.style.maxHeight = 'none';
          body.removeEventListener('transitionend', handler);
        }, { once: true });
      }
    });
  });
}());
