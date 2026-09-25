'use strict';
const $ = id => document.getElementById(id);
let config;
async function getJson(path, options = {}) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || data.error || `HTTP ${response.status}`);
  return data;
}
function showGroups() {
  const term = $('filter').value.trim().toLowerCase();
  const rows = config.groups.filter(group => `${group.group} ${group.note}`.toLowerCase().includes(term));
  const tbody = $('scenario-body'); tbody.replaceChildren();
  for (const group of rows) {
    const tr = document.createElement('tr');
    for (const [index, value] of [group.group, String(group.count), group.group.startsWith('retry-') ? `${group.status} then 200` : group.group === 'timeout' ? `200 after ${config.delayMs} ms` : String(group.status), group.expectation, group.note].entries()) {
      const td = document.createElement('td');
      if (index === 0) {
        const link = document.createElement('a'); link.href = `/crawl/cases/${group.group}`; link.textContent = value; td.append(link);
      } else if (index === 3) {
        const chip = document.createElement('span'); chip.className = `chip ${group.expectation}`; chip.textContent = value; td.append(chip);
      } else td.textContent = value;
      tr.append(td);
    }
    tbody.append(tr);
  }
  if (!rows.length) { const row = tbody.insertRow(); const cell = row.insertCell(); cell.colSpan = 5; cell.textContent = 'No matching scenarios.'; }
}
async function refresh() {
  const stats = await getJson('/api/stats');
  $('observed-count').textContent = stats.uniqueRespondedUrls.toLocaleString();
  $('request-count').textContent = stats.fixtureGetRequests.toLocaleString();
  $('delay-count').textContent = stats.pendingDelays;
  $('run-label').textContent = stats.label;
  $('boot-id').textContent = stats.bootId;
  $('live-status').textContent = `Origin observations refreshed at ${new Date().toLocaleTimeString()}.`;
}
$('refresh').addEventListener('click', () => refresh().catch(error => { $('live-status').textContent = error.message; }));
$('filter').addEventListener('input', () => { if (config) showGroups(); });
$('copy-seed').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('main-seed').textContent); $('copy-seed').textContent = 'Copied'; }
  catch { $('live-status').textContent = 'Clipboard is unavailable. Select and copy the displayed start URL.'; }
});
$('reset-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!window.confirm('Stop the crawler first. Reset origin observations and retry counters now?')) return;
  const token = $('admin-token').value;
  $('admin-token').value = '';
  try {
    const result = await getJson('/admin/reset', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ label: $('reset-label').value }) });
    $('reset-status').textContent = `Reset complete. ${result.warning}`;
    await refresh();
  } catch (error) { $('reset-status').textContent = `Reset failed: ${error.message}`; }
});
(async () => {
  try {
    config = await getJson('/api/config');
    $('valid-count').textContent = config.valid.toLocaleString(); $('case-count').textContent = config.additional.toLocaleString(); $('issue-count').textContent = config.requiredIssues.toLocaleString();
    $('main-seed').textContent = `${config.baseUrl}/crawl`; showGroups(); await refresh();
  } catch (error) { $('live-status').textContent = `Could not load server configuration: ${error.message}`; }
})();
