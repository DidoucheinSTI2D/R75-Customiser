// Called by the main process: show(appName, percent, text)
// percent -1 = app not playing; text = playback symbol shown instead of the volume bar.
window.show = (name, pct, text = '') => {
  document.getElementById('name').textContent = name;
  document.getElementById('osd').className = 'osd' + (pct < 0 ? ' none' : '') + (text ? ' text' : '');
  document.getElementById('fill').style.width = Math.max(0, pct) + '%';
  document.getElementById('pct').textContent = text ? (pct < 0 ? '--' : '') : pct < 0 ? '--' : pct + '%';
  document.getElementById('sym').textContent = text;
};
