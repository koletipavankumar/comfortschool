(function () {
  var timerEl = document.getElementById('session-timer');
  var countdownEl = document.getElementById('session-countdown');
  if (!timerEl || !countdownEl) return;

  var maxAge = parseInt(timerEl.getAttribute('data-max-age'), 10) || 1800000;
  var lastActivity = Date.now();
  var warningShown = false;

  function resetActivity() {
    lastActivity = Date.now();
    warningShown = false;
  }

  ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'].forEach(function (eventName) {
    document.addEventListener(eventName, resetActivity, { passive: true });
  });

  function formatTime(ms) {
    var totalSeconds = Math.max(0, Math.floor(ms / 1000));
    var minutes = Math.floor(totalSeconds / 60);
    var seconds = totalSeconds % 60;
    return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
  }

  function tick() {
    var elapsed = Date.now() - lastActivity;
    var remaining = maxAge - elapsed;

    if (remaining <= 0) {
      window.location.href = '/admin/logout';
      return;
    }

    countdownEl.textContent = formatTime(remaining);

    if (remaining <= 60000 && !warningShown) {
      warningShown = true;
      timerEl.classList.add('admin-session-warning');
    }

    if (remaining > 60000) {
      timerEl.classList.remove('admin-session-warning');
    }
  }

  tick();
  setInterval(tick, 1000);
})();


  