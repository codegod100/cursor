const $ = (sel) => document.querySelector(sel);

function statusClass(status) {
  return `status ${status}`;
}

function renderJobs(jobs) {
  const el = $("#jobs-list");
  if (!jobs.length) {
    el.innerHTML = '<p class="empty">No jobs yet — launch a swarm above.</p>';
    return;
  }
  el.innerHTML = jobs
    .slice()
    .reverse()
    .map((job) => {
      const tasks = (job.subtasks || [])
        .map(
          (t) => `
        <div class="task">
          <span class="task-id">${t.id}</span>
          <span class="task-desc">${t.description}</span>
          <span class="${statusClass(t.status)}">${t.status}</span>
        </div>`
        )
        .join("");
      return `
      <div class="job-card">
        <h3>${job.goal.slice(0, 80)}${job.goal.length > 80 ? "…" : ""}</h3>
        <div class="job-meta">${job.id} · ${job.workspace}</div>
        <span class="${statusClass(job.status)}">${job.status}</span>
        <div class="tasks">${tasks || '<p class="empty">Planning…</p>'}</div>
      </div>`;
    })
    .join("");
}

function renderNodes(nodes) {
  const el = $("#nodes-list");
  if (!nodes.length) {
    el.innerHTML = '<p class="empty">No nodes registered.</p>';
    return;
  }
  el.innerHTML = nodes
    .map(
      (n) => `
    <div class="node-card">
      <div>
        <div class="node-id">${n.id}</div>
        <div class="node-load">${n.url}</div>
      </div>
      <div>
        <span class="${statusClass(n.status)}">${n.status}</span>
        <div class="node-load">${n.active_workers}/${n.max_workers} workers</div>
      </div>
    </div>`
    )
    .join("");
}

function updateStats(snap) {
  $("#stat-jobs").textContent = snap.jobs.length;
  $("#stat-active").textContent = snap.active_jobs;
  $("#stat-nodes").textContent = snap.nodes.length;
  $("#stat-capacity").textContent = snap.parallel_capacity;
  renderJobs(snap.jobs);
  renderNodes(snap.nodes);
}

function connectWs() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/ws`);

  ws.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    if (data.type === "ping") return;
    updateStats(data);
  };

  ws.onclose = () => setTimeout(connectWs, 2000);
}

$("#job-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const goal = $("#goal").value.trim();
  const workspace = $("#workspace").value.trim() || ".";
  const max_workers = parseInt($("#max-workers").value, 10) || 4;

  const btn = e.target.querySelector("button");
  btn.disabled = true;
  btn.textContent = "Launching…";

  try {
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, workspace, max_workers }),
    });
    if (!res.ok) throw new Error(await res.text());
    $("#goal").value = "";
  } catch (err) {
    alert(`Failed to launch: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Launch hive";
  }
});

connectWs();
