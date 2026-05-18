(function () {
  // Acquire VS Code API — must be called only once
  const vscode = acquireVsCodeApi();

  const fixChatBtn = document.getElementById('fix-chat-btn');
  const stageCommitPushBtn = document.getElementById('stage-commit-push-btn');
  const gitNotice = document.getElementById('git-notice');
  const selectAllCb = document.getElementById('select-all-cb');
  const selectAllText = document.getElementById('select-all-text');
  const pushProgressDiv = document.getElementById('push-progress');
  const pushProgressLabel = document.getElementById('push-progress-label');
  const pushBarFill = document.getElementById('push-bar-fill');

  // ─── Reviewer filter ──────────────────────────────────────────────────────────
  function applyReviewerFilter() {
    var activeReviewers = new Set(
      Array.from(document.querySelectorAll('.reviewer-cb'))
        .filter(function(cb) { return cb.checked; })
        .map(function(cb) { return cb.dataset.reviewer; })
    );
    getAllCards().forEach(function(card) {
      var reviewer = card.dataset.reviewer || '';
      if (activeReviewers.size === 0 || activeReviewers.has(reviewer)) {
        card.classList.remove('reviewer-hidden');
      } else {
        card.classList.add('reviewer-hidden');
      }
    });
    if (currentGroup !== 'none') { renderGrouped(); }
    updateSelectAll();
  }

  document.querySelectorAll('.reviewer-cb').forEach(function(cb) {
    cb.addEventListener('change', function() {
      // Enforce at least one reviewer must remain checked.
      var allCbs = Array.from(document.querySelectorAll('.reviewer-cb'));
      var checkedCount = allCbs.filter(function(c) { return c.checked; }).length;
      if (checkedCount === 0) {
        cb.checked = true;  // revert the uncheck
        return;
      }
      applyReviewerFilter();
    });
  });

  // ─── Push progress ────────────────────────────────────────────────────────────
  function updatePushProgress(label, percent) {
    if (!pushProgressDiv) { return; }
    pushProgressDiv.classList.remove('hidden', 'done');
    if (pushProgressLabel) { pushProgressLabel.textContent = label; }
    if (pushBarFill) { pushBarFill.style.width = percent + '%'; }
  }

  function getCheckboxes() {
    return Array.from(document.querySelectorAll('.comment-checkbox'))
      .filter(function(cb) { return !cb.closest('.card').classList.contains('reviewer-hidden'); });
  }

  function updateSelectAll() {
    if (!selectAllCb || !selectAllText) { return; }
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
    var pillEl = document.getElementById('pill-checked-count');
    if (pillEl) {
      var total = getAllCards().filter(function(c) { return !c.classList.contains('reviewer-hidden'); }).length;
      pillEl.textContent = checkedCount + ' / ' + total + ' selected';
    }
  }

  if (selectAllCb) {
    selectAllCb.addEventListener('change', function() {
      var check = selectAllCb.checked;
      selectAllCb.indeterminate = false;
      getCheckboxes().filter(function(cb) { return !cb.disabled; }).forEach(function(cb) { cb.checked = check; });
      selectAllText.textContent = check ? 'Uncheck all' : 'Select all';
      updateSelectAll();
    });
  }

  document.addEventListener('change', function(e) {
    if (e.target && e.target.classList && e.target.classList.contains('comment-checkbox')) {
      updateSelectAll();
    }
  });

  // Sync select-all state with the pre-checked cards on initial load
  updateSelectAll();

  // ─── Grouping state ──────────────────────────────────────────────────────────
  var currentGroup = 'none';  // 'none' | 'file' | 'complexity'
  var collapsedGroups = new Set();

  var COMPLEXITY_GROUP_ORDER = ['high', 'medium', 'low'];
  var COMPLEXITY_GROUP_LABELS = { high: 'High', medium: 'Medium', low: 'Low' };

  function getAllCards() {
    return Array.from(document.querySelectorAll('.card[data-number]'));
  }

  function escapeHtmlJs(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderGrouped() {
    var list = document.getElementById('comment-list');
    if (!list) { return; }

    var cards = getAllCards();
    cards.forEach(function(c) { list.removeChild(c); });
    Array.from(list.querySelectorAll('.group-header')).forEach(function(el) { list.removeChild(el); });

    if (currentGroup === 'none') {
      cards.forEach(function(c) { c.style.display = ''; list.appendChild(c); });
      return;
    }

    var groups = {};
    var groupOrder = [];

    if (currentGroup === 'file') {
      cards.forEach(function(c) {
        var key = c.dataset.file || '';
        if (!groups[key]) { groups[key] = []; }
        groups[key].push(c);
      });
      groupOrder = Object.keys(groups).sort(function(a, b) {
        return a.toLowerCase().localeCompare(b.toLowerCase());
      });
    } else if (currentGroup === 'complexity') {
      cards.forEach(function(c) {
        var key = c.dataset.complexity || 'low';
        if (!groups[key]) { groups[key] = []; }
        groups[key].push(c);
      });
      groupOrder = COMPLEXITY_GROUP_ORDER.filter(function(k) { return groups[k] && groups[k].length > 0; });
    }

    groupOrder.forEach(function(key) {
      var isCollapsed = collapsedGroups.has(key);
      var header = document.createElement('div');
      header.className = 'group-header' + (isCollapsed ? ' collapsed' : '');
      header.dataset.groupKey = key;
      var label = currentGroup === 'complexity' ? (COMPLEXITY_GROUP_LABELS[key] || key)
        : key;
      var visibleCount = groups[key].filter(function(c) { return !c.classList.contains('reviewer-hidden'); }).length;
      if (visibleCount === 0) { return; } // hide group if all cards are reviewer-filtered out
      header.innerHTML = '<span class="group-header-chevron">&#9660;</span>'
        + '<span class="group-header-label">' + escapeHtmlJs(label) + '</span>'
        + '<span class="group-header-count">' + visibleCount + '</span>';
      header.addEventListener('click', function() {
        var collapsed = header.classList.toggle('collapsed');
        if (collapsed) { collapsedGroups.add(key); } else { collapsedGroups.delete(key); }
        groups[key].forEach(function(c) {
          if (!c.classList.contains('reviewer-hidden')) {
            c.style.display = collapsed ? 'none' : '';
          }
        });
      });
      list.appendChild(header);
      groups[key].forEach(function(c) {
        c.style.display = (isCollapsed || c.classList.contains('reviewer-hidden')) ? 'none' : '';
        list.appendChild(c);
      });
    });
  }

  // ─── Group / sort button wiring ──────────────────────────────────────────────
  var expandCollapseBtn = document.getElementById('expand-collapse-btn');
  var allCollapsed = false;

  function updateExpandCollapseBtn() {
    if (!expandCollapseBtn) { return; }
    if (currentGroup === 'none') {
      expandCollapseBtn.classList.add('hidden');
    } else {
      expandCollapseBtn.classList.remove('hidden');
      expandCollapseBtn.textContent = allCollapsed ? 'Expand All' : 'Collapse All';
    }
  }

  if (expandCollapseBtn) {
    expandCollapseBtn.addEventListener('click', function() {
      allCollapsed = !allCollapsed;
      var list = document.getElementById('comment-list');
      if (!list) { return; }
      Array.from(list.querySelectorAll('.group-header')).forEach(function(header) {
        var key = header.dataset.groupKey;
        if (allCollapsed) {
          header.classList.add('collapsed');
          collapsedGroups.add(key);
        } else {
          header.classList.remove('collapsed');
          collapsedGroups.delete(key);
        }
      });
      getAllCards().forEach(function(c) {
        if (currentGroup !== 'none') {
          c.style.display = allCollapsed ? 'none' : '';
        }
      });
      updateExpandCollapseBtn();
    });
  }

  document.querySelectorAll('.group-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.group-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      currentGroup = btn.dataset.group;
      allCollapsed = false;
      collapsedGroups.clear();
      renderGrouped();
      updateExpandCollapseBtn();
    });
  });

  // ─── Apply Fixes button ────────────────────────────────────────────────────
  if (fixChatBtn) {
    fixChatBtn.addEventListener('click', function () {
      fixChatBtn.disabled = true;
      fixChatBtn.textContent = 'Applying\u2026';
      var selectedIds = getCheckboxes()
        .filter(function(cb) { return cb.checked; })
        .map(function(cb) { return Number(cb.dataset.id); });
      vscode.postMessage({ command: 'fixWithCopilotChat', selectedIds: selectedIds });
      // Block the panel until the user confirms all fixes are done in Copilot Chat.
      // Push & Resolve is enabled only when the overlay is dismissed.
      showApplyingOverlay(function onApplied() {
        fixChatBtn.disabled = false;
        fixChatBtn.textContent = 'Apply Fixes';
        if (stageCommitPushBtn) { stageCommitPushBtn.disabled = false; }
      });
    });
  }

  // ─── Push & Mark Resolved button ─────────────────────────────────────────────
  var pendingResolveIds = [];

  if (stageCommitPushBtn) {
    stageCommitPushBtn.addEventListener('click', function () {
      pendingResolveIds = getCheckboxes()
        .filter(function(cb) { return cb.checked; })
        .map(function(cb) { return Number(cb.dataset.id); });
      stageCommitPushBtn.disabled = true;
      vscode.postMessage({ command: 'stageCommitAndPush', selectedIds: pendingResolveIds });
    });
  }

  // ─── Messages from extension ──────────────────────────────────────────────────
  window.addEventListener('message', function (event) {
    const message = event.data;
    if (message.command === 'gitStatus') {
      updateGitStatus(message.status);
    } else if (message.command === 'pushProgress') {
      updatePushProgress(message.label, message.percent);
    } else if (message.command === 'banner') {
      showBanner(message.message, message.type);
    }
  });

  function showBanner(message, type) {
    var bannerArea = document.getElementById('banner-area');
    if (!bannerArea) { return; }
    var div = document.createElement('div');
    div.className = 'banner banner-' + (type || 'info');
    div.textContent = message;
    bannerArea.appendChild(div);
  }

  function updateGitStatus(status) {
    if (!stageCommitPushBtn) { return; }
    if (status.state === 'pushing') {
      stageCommitPushBtn.disabled = true;
      stageCommitPushBtn.textContent = 'Pushing\u2026';
      if (gitNotice) { gitNotice.classList.add('hidden'); }
    } else if (status.state === 'pushed') {
      // Remove the resolved cards from the DOM
      pendingResolveIds.forEach(function(id) {
        var card = document.querySelector('.card[data-id="' + id + '"]');
        if (card) { card.parentNode.removeChild(card); }
      });
      pendingResolveIds = [];
      // Re-render groups to clean up any now-empty group headers
      if (currentGroup !== 'none') { renderGrouped(); }
      updateSelectAll();
      // Check whether any cards remain
      if (getAllCards().length === 0) {
        showAllResolvedState();
      } else {
        stageCommitPushBtn.textContent = 'Pushed \u2713';
        stageCommitPushBtn.disabled = true;
      }
      if (pushProgressDiv) {
        pushProgressDiv.classList.add('done');
        if (pushProgressLabel) { pushProgressLabel.textContent = 'Complete \u2713'; }
        if (pushBarFill) { pushBarFill.style.width = '100%'; }
      }
    } else if (status.state === 'push-failed') {
      stageCommitPushBtn.disabled = false;
      stageCommitPushBtn.textContent = 'Push & Mark Resolved';
      if (pushProgressDiv) { pushProgressDiv.classList.add('hidden'); }
      showGitNotice(status.reason, 'git-notice-error');
    } else if (status.state === 'no-repo') {
      stageCommitPushBtn.classList.add('hidden');
      if (pushProgressDiv) { pushProgressDiv.classList.add('hidden'); }
      showGitNotice('Git repository not found. Please stage and commit manually.', 'git-notice-error');
    } else if (status.state === 'ready') {
      // User cancelled the confirmation dialog — re-enable button
      stageCommitPushBtn.disabled = false;
      stageCommitPushBtn.textContent = 'Push & Mark Resolved';
    }
  }

  // ─── Applying-fixes overlay ───────────────────────────────────────────────
  function showApplyingOverlay(onComplete) {
    var existing = document.getElementById('fix-overlay');
    if (existing) { existing.parentNode.removeChild(existing); }

    var overlay = document.createElement('div');
    overlay.id = 'fix-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Applying fixes');
    overlay.innerHTML =
      '<div class="fix-overlay-card">' +
        '<div class="fix-overlay-spinner" aria-hidden="true"></div>' +
        '<p class="fix-overlay-msg">Applying Fixes\u2026</p>' +
        '<p class="fix-overlay-sub">Copilot Chat is working on the fixes. Once it finishes, click anywhere in this panel to continue — the overlay will dismiss automatically.</p>' +
        '<button class="fix-overlay-done-btn" id="fix-overlay-done-btn">Continue manually</button>' +
      '</div>';
    document.body.appendChild(overlay);

    var hasLostFocus = false;

    function dismiss() {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      if (overlay.parentNode) { overlay.parentNode.removeChild(overlay); }
      onComplete();
    }

    function onBlur() { hasLostFocus = true; }
    function onFocus() { if (hasLostFocus) { dismiss(); } }

    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);

    document.getElementById('fix-overlay-done-btn').addEventListener('click', function () {
      dismiss();
    });
  }

  function showAllResolvedState() {
    var list = document.getElementById('comment-list');
    if (list) {
      list.innerHTML = '<div class="empty-state resolved-state">'  
        + '<svg class="empty-icon" width="48" height="48" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true">'
        + '<path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm11.354-2.646a.5.5 0 0 0-.708-.708L7 8.293 5.354 6.646a.5.5 0 1 0-.708.708l2 2a.5.5 0 0 0 .708 0l4-4z"/>'
        + '</svg>'
        + '<p>All issues resolved.</p>'  
        + '<p class="empty-sub">Changes were pushed and all selected conversations were marked as resolved.</p>'
        + '</div>';
    }
    // Hide toolbar controls — nothing left to act on
    var toolbar = document.querySelector('.toolbar');
    if (toolbar) { toolbar.classList.add('hidden'); }
  }

  function showGitNotice(message, cls) {
    if (!gitNotice) { return; }
    gitNotice.textContent = message;
    gitNotice.className = 'git-notice ' + (cls || '');
    gitNotice.classList.remove('hidden');
  }

  // ─── Details expand/collapse animation (from improve-algorithm branch) ───────
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
