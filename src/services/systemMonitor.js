// System Monitor - Monitoreo en tiempo real del sistema
const os = require("os");
const { exec } = require("child_process");

let monitorInterval = null;
let callbacks = [];

function runCmd(cmd, timeout = 10000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout, encoding: "utf8" }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || "", stderr: stderr || "" });
    });
  });
}

async function getSnapshot() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const loadAvg = os.loadavg();

  let cpuUsage = Math.round(loadAvg[0] * (100 / os.cpus().length));
  cpuUsage = Math.min(100, Math.max(0, cpuUsage));

  let diskUsage = 0;
  try {
    const r = await runCmd('powershell -command "(Get-Counter \\"\\PhysicalDisk(_Total)\\% Disk Time\\").CounterSamples.CookedValue"');
    if (r.ok && r.stdout) diskUsage = Math.min(100, Math.max(0, Math.round(parseFloat(r.stdout.trim()) || 0)));
  } catch (e) { /* skip */ }

  let networkLatency = null;
  try {
    const r = await runCmd('powershell -command "(Test-Connection -ComputerName 8.8.8.8 -Count 1 -Quiet) | Out-Null; $t = (Measure-Command { ping -n 1 8.8.8.8 | Out-Null }).TotalMilliseconds; [math]::Round($t)"');
    if (r.ok && r.stdout) networkLatency = parseInt(r.stdout.trim()) || null;
  } catch (e) { /* skip */ }

  return {
    timestamp: Date.now(),
    cpu: cpuUsage,
    ram: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      percent: Math.round((usedMem / totalMem) * 100)
    },
    disk: diskUsage,
    network: { latency: networkLatency },
    uptime: os.uptime()
  };
}

function startMonitoring(intervalMs = 2000, callback) {
  if (callback) callbacks.push(callback);
  if (monitorInterval) return;

  const emit = async () => {
    const snapshot = await getSnapshot();
    for (const cb of callbacks) {
      try { cb(snapshot); } catch (e) { /* skip */ }
    }
  };

  monitorInterval = setInterval(emit, intervalMs);
  emit();
}

function stopMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  callbacks = [];
}

function removeCallback(callback) {
  callbacks = callbacks.filter(cb => cb !== callback);
}

function isMonitoring() {
  return monitorInterval !== null;
}

module.exports = { getSnapshot, startMonitoring, stopMonitoring, removeCallback, isMonitoring };
