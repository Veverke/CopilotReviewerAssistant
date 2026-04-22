(function () {
  // Acquire VS Code API — must be called only once
  const vscode = acquireVsCodeApi();

  const applyBtn = document.getElementById('apply-btn');
  const selectAllCb = document.getElementById('select-all-cb');
  const selectAllText = document.getElementById('select-all-text');
  const stageCommitPushBtn = document.getElementById('stage-commit-push-btn');
  const gitNotice = document.getElementById('git-notice');
  const progressFill = document.getElementById('progress-fill');
  var doneCount = 0;
  var totalApplying = 0;

  function getCheckboxes() {
    return Array.from(document.querySelectorAll('.comment-checkbox'));
  }

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
    doneCount = 0;
    if (progressFill) { progressFill.style.width = '0%'; }
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
    } else if (message.command === 'gitStatus') {
      updateGitStatus(message.status);
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
    if (status.state === 'pushing') {
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

    statusEl.className = 'fix-status';
    card.classList.remove('state-applying', 'state-done', 'state-failed');
    if (status.state === 'applying') {
      card.classList.add('state-applying');
      statusEl.classList.add('fix-applying');
      statusEl.textContent = '';
    } else if (status.state === 'done') {
      card.classList.add('state-done');
      statusEl.classList.add('fix-done');
      statusEl.textContent = '\u2713 Done';
      stageCommitPushBtn.classList.remove('hidden');
      checkbox.checked = false;
      checkbox.disabled = true;
      updateApplyButton();
      doneCount++;
      if (progressFill && totalApplying > 0) {
        progressFill.style.width = (doneCount / totalApplying * 100) + '%';
      }
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
    }
  }

  // Initialise button state on load
  updateApplyButton();

  // Details expand/collapse animation
  document.querySelectorAll('details').forEach(function(det) {
    var summary = det.querySelector('summary');
    var body = det.querySelector('.details-body');
    if (!summary || !body) { return; }
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
