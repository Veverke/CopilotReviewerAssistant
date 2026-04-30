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

  // ─── Grouping state ─────────────────────────────────────────────────────────────
  var currentGroup = 'none';  // 'none' | 'file' | 'complexity'
  var collapsedGroups = new Set();

  var COMPLEXITY_GROUP_ORDER = ['high', 'medium', 'low'];
  var COMPLEXITY_GROUP_LABELS = { high: 'High', medium: 'Medium', low: 'Low' };

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
    Array.from(list.querySelectorAll('.group-header')).forEach(function(el) { list.removeChild(el); });

    if (currentGroup === 'none') {
      cards.forEach(function(c) { c.style.display = ''; list.appendChild(c); });
      return;
    }

    // Build groups
    var groups = {};
    var groupOrder = [];

    if (currentGroup === 'file') {
      // Group by file path, sort groups alphabetically
      cards.forEach(function(c) {
        var key = c.dataset.file || '';
        if (!groups[key]) { groups[key] = []; }
        groups[key].push(c);
      });
      groupOrder = Object.keys(groups).sort(function(a, b) {
        return a.toLowerCase().localeCompare(b.toLowerCase());
      });
    } else if (currentGroup === 'complexity') {
      // Group by complexity, fixed order High → Medium → Low
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
      var label = currentGroup === 'complexity' ? (COMPLEXITY_GROUP_LABELS[key] || key) : key;
      var count = groups[key].length;
      header.innerHTML = '<span class="group-header-chevron">&#9660;</span>'
        + '<span class="group-header-label">' + escapeHtmlJs(label) + '</span>'
        + '<span class="group-header-count">' + count + '</span>';
      header.addEventListener('click', function() {
        var collapsed = header.classList.toggle('collapsed');
        if (collapsed) { collapsedGroups.add(key); } else { collapsedGroups.delete(key); }
        groups[key].forEach(function(c) { c.style.display = collapsed ? 'none' : ''; });
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

  // ─── Copy buttons ────────────────────────────────────────────────────────────
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.copy-btn');
    if (!btn) { return; }
    e.stopPropagation();

    var type = btn.dataset.copyType;
    var plainText = '';
    var htmlText = '';

    if (type === 'comment') {
      var commentEl = btn.closest('.discuss-comment');
      var bodyEl = commentEl ? commentEl.querySelector('.comment-body') : null;
      plainText = bodyEl ? (bodyEl.textContent || '') : '';
      htmlText = bodyEl ? ('<div>' + bodyEl.innerHTML + '</div>') : plainText;
    } else if (type === 'workplan') {
      var workplanEl = btn.closest('.discuss-workplan');
      plainText = workplanEl ? (workplanEl.dataset.rawWorkplan || '') : '';
      var workPlanContent = workplanEl ? workplanEl.querySelector('.work-plan') : null;
      htmlText = workPlanContent ? workPlanContent.outerHTML : ('<p>' + escapeHtmlJs(plainText) + '</p>');
    }

    var orig = btn.textContent;
    function confirmCopy() {
      btn.textContent = '\u2713';
      btn.classList.add('copy-btn-done');
      setTimeout(function() { btn.textContent = orig; btn.classList.remove('copy-btn-done'); }, 1200);
    }

    try {
      navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([plainText], { type: 'text/plain' }),
          'text/html': new Blob([htmlText], { type: 'text/html' }),
        })
      ]).then(confirmCopy).catch(function() {
        navigator.clipboard.writeText(plainText).then(confirmCopy).catch(function() {});
      });
    } catch (_) {
      navigator.clipboard.writeText(plainText).then(confirmCopy).catch(function() {});
    }
  });

  // ─── Discuss in Copilot Chat ─────────────────────────────────────────────────
  document.addEventListener('click', function(e) {
    var target = e.target;
    // Ignore copy button and regen button clicks
    if (target.closest && (target.closest('.copy-btn') || target.closest('.regen-btn'))) { return; }

    // Walk up to find .discuss-comment or .discuss-workplan
    var el = target;
    while (el && el !== document.body) {
      if (el.classList && (el.classList.contains('discuss-comment') || el.classList.contains('discuss-workplan'))) {
        break;
      }
      el = el.parentElement;
    }
    if (!el || el === document.body) { return; }

    var card = el.closest('.card');
    var number = card ? Number(card.dataset.number || 0) : 0;

    // Visual feedback: briefly highlight the clicked element
    el.classList.add('discuss-active');
    setTimeout(function() { el.classList.remove('discuss-active'); }, 700);

    if (el.classList.contains('discuss-comment')) {
      // Text lives in the inner .comment-body child
      var commentBody = el.querySelector('.comment-body');
      var text = (commentBody ? commentBody.textContent : el.textContent) || '';
      vscode.postMessage({ command: 'openChat', chatType: 'comment', number: number, text: text.trim() });
    } else if (el.classList.contains('discuss-workplan')) {
      // Raw work plan stored on the container via data-raw-workplan
      var rawText = el.dataset.rawWorkplan || (el.querySelector('.work-plan') || el).textContent || '';
      vscode.postMessage({ command: 'openChat', chatType: 'workplan', number: number, text: rawText.trim() });
    }
  });

  // ─── Export button ───────────────────────────────────────────────────────────
  var exportBtn = document.getElementById('export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', function() {
      var cards = getAllCards();
      var sections = [];
      cards.forEach(function(card) {
        var commentBodyEl = card.querySelector('.comment-body');
        var issueText = commentBodyEl ? (commentBodyEl.textContent || '').trim() : '';
        var workplanEl = card.querySelector('.discuss-workplan');
        var workplanText = workplanEl ? (workplanEl.dataset.rawWorkplan || '').trim() : '';
        var num = card.dataset.number || (sections.length + 1);
        sections.push('Issue ' + num + ': ' + issueText + '\n\nWork-plan: ' + workplanText);
      });
      var separator = '\n\n=========================================\n\n';
      var content = sections.join(separator);
      vscode.postMessage({ command: 'exportReviews', content: content });
    });
  }

  // ─── Regenerate work plan buttons ────────────────────────────────────────────
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.regen-btn');
    if (!btn) { return; }
    e.stopPropagation();
    if (btn.disabled) { return; }

    var id = Number(btn.dataset.id);
    var card = btn.closest('.card');
    var workplanEl = card ? card.querySelector('.discuss-workplan') : null;
    var workPlanContent = workplanEl ? workplanEl.querySelector('.work-plan') : null;

    btn.disabled = true;
    btn.classList.add('regen-btn-spinning');
    if (workPlanContent) {
      workPlanContent.innerHTML = '<em class="work-plan-regenerating">Regenerating\u2026</em>';
    }

    vscode.postMessage({ command: 'regenerateWorkPlan', id: id });
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
    } else if (message.command === 'workPlanUpdated') {
      updateWorkPlan(message.id, message.workPlan, message.workPlanHtml, message.complexity);
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
      stageCommitPushBtn.textContent = status.command
        ? 'Running \u0060' + status.command + '\u0060\u2026'
        : 'Building\u2026';
      gitNotice.classList.add('hidden');
      gitNotice.textContent = '';
    } else if (status.state === 'build-failed') {
      stageCommitPushBtn.disabled = false;
      stageCommitPushBtn.textContent = 'Stage, Commit \u0026 Push';
      showBuildFailedNotice(status.reason, status.details);
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

  function showBuildFailedNotice(reason, details) {
    gitNotice.innerHTML = '';
    gitNotice.className = 'git-notice git-notice-error';

    var header = document.createElement('div');
    header.className = 'git-notice-header';
    header.textContent = '\u26a0\ufe0f ' + reason;
    gitNotice.appendChild(header);

    if (details) {
      var pre = document.createElement('pre');
      pre.className = 'git-notice-pre';
      pre.textContent = details;
      gitNotice.appendChild(pre);
    }

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

  function updateWorkPlan(id, workPlan, workPlanHtml, complexity) {
    var card = document.querySelector('.card[data-id="' + id + '"]');
    if (!card) { return; }

    // Update work plan content
    var workplanEl = card.querySelector('.discuss-workplan');
    if (workplanEl) {
      workplanEl.dataset.rawWorkplan = workPlan;
      var workPlanContent = workplanEl.querySelector('.work-plan');
      if (workPlanContent) {
        workPlanContent.innerHTML = workPlanHtml;
      }
    }

    // Update complexity badge and card data attribute
    var COMPLEXITY_LABELS = { low: 'LOW', medium: 'MED', high: 'HIGH' };
    card.dataset.complexity = complexity;
    var badge = card.querySelector('.complexity-badge');
    if (badge) {
      badge.className = 'complexity-badge complexity-' + complexity;
      badge.title = 'Complexity: ' + complexity;
      badge.textContent = COMPLEXITY_LABELS[complexity] || complexity.toUpperCase();
    }

    // Re-enable the regen button
    var regenBtn = card.querySelector('.regen-btn');
    if (regenBtn) {
      regenBtn.disabled = false;
      regenBtn.classList.remove('regen-btn-spinning');
    }

    // Re-apply grouping so the card lands in the right group if complexity changed
    if (currentGroup !== 'none') {
      renderGrouped();
    }
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

  // Initialise section structure and button state on load
  renderGrouped();
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
