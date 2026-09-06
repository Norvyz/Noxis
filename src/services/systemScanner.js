// System Scanner - Escaneo completo de hardware y software
const { exec } = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");

function runCmd(cmd, timeout = 30000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout, encoding: "utf8" }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || "", stderr: stderr || "" });
    });
  });
}

function parseWmicOutput(stdout) {
  const lines = stdout.trim().split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, ""));
  return lines.slice(1).map(line => {
    const vals = line.split(",").map(v => v.trim().replace(/"/g, ""));
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ""; });
    return obj;
  });
}

async function scanCPU() {
  const cpus = os.cpus();
  const loadAvg = os.loadavg();
  let temp = null;
  try {
    const r = await runCmd('powershell -command "Get-WmiObject MSAcpi_ThermalZoneTemperature -Namespace \\"root/wmi\\" | Select CurrentTemperature | Select -First 1"');
    if (r.ok && r.stdout) {
      const match = r.stdout.match(/(\d+)/);
      if (match) temp = Math.round((parseInt(match[1]) / 10) - 273.15);
    }
  } catch (e) { /* skip */ }

  let usage = 0;
  try {
    const r = await runCmd('powershell -command "(Get-Counter \\"\\Processor(_Total)\\% Processor Time\\").CounterSamples.CookedValue"');
    if (r.ok && r.stdout) usage = Math.round(parseFloat(r.stdout.trim()) || 0);
  } catch (e) { /* skip */ }

  return {
    model: cpus[0] ? cpus[0].model.trim() : "Desconocido",
    cores: cpus.length,
    speed: cpus[0] ? cpus[0].speed : 0,
    usage,
    temperature: temp,
    loadAvg: loadAvg.map(l => Math.round(l * 100) / 100)
  };
}

async function scanMemory() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  let processes = [];
  try {
    const r = await runCmd('powershell -command "Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 10 Name,@{N=\\"MB\\";E={[math]::Round($_.WorkingSet64/1MB,1)}} | ConvertTo-Json"');
    if (r.ok && r.stdout) {
      try { processes = JSON.parse(r.stdout.trim()); } catch (e) { /* skip */ }
    }
  } catch (e) { /* skip */ }

  return {
    totalGB: (total / (1024 ** 3)).toFixed(1),
    usedGB: (used / (1024 ** 3)).toFixed(1),
    freeGB: (free / (1024 ** 3)).toFixed(1),
    percent: Math.round((used / total) * 100),
    topProcesses: Array.isArray(processes) ? processes : []
  };
}

async function scanGPU() {
  let gpu = { name: "No detectada", driver: "N/A", usage: 0, temperature: null, vram: null };
  try {
    const r = await runCmd('wmic path win32_videocontroller get Name,DriverVersion,AdapterRAM /format:csv');
    if (r.ok && r.stdout) {
      const data = parseWmicOutput(r.stdout);
      if (data.length > 0) {
        const d = data[0];
        gpu.name = d.Name || "Desconocida";
        gpu.driver = d.DriverVersion || "N/A";
        const vram = parseInt(d.AdapterRAM) || 0;
        gpu.vram = vram > 0 ? (vram / (1024 ** 2)).toFixed(0) + " MB" : "N/A";
      }
    }
  } catch (e) { /* skip */ }

  try {
    const r = await runCmd('powershell -command "Get-Counter \\"\\GPU Engine(*)\\Utilization Percentage\\" -ErrorAction SilentlyContinue | Select -ExpandProperty CounterSamples | Where CookedValue -gt 0 | Select -First 1 InstanceName,CookedValue | ConvertTo-Json"');
    if (r.ok && r.stdout) {
      try {
        const data = JSON.parse(r.stdout.trim());
        if (data && data.CookedValue) gpu.usage = Math.round(data.CookedValue);
      } catch (e) { /* skip */ }
    }
  } catch (e) { /* skip */ }

  return gpu;
}

async function scanDisk() {
  let disks = [];
  try {
    const r = await runCmd('wmic logicaldisk get DeviceID,Size,FreeSpace,FileSystem,VolumeName /format:csv');
    if (r.ok && r.stdout) {
      disks = parseWmicOutput(r.stdout).map(d => ({
        letter: d.DeviceID || "",
        totalGB: d.Size ? (parseInt(d.Size) / (1024 ** 3)).toFixed(1) : "0",
        freeGB: d.FreeSpace ? (parseInt(d.FreeSpace) / (1024 ** 3)).toFixed(1) : "0",
        usedPercent: d.Size && d.FreeSpace ? Math.round(((parseInt(d.Size) - parseInt(d.FreeSpace)) / parseInt(d.Size)) * 100) : 0,
        fileSystem: d.FileSystem || "",
        label: d.VolumeName || ""
      }));
    }
  } catch (e) { /* skip */ }

  let diskUsage = 0;
  try {
    const r = await runCmd('powershell -command "(Get-Counter \\"\\PhysicalDisk(_Total)\\% Disk Time\\").CounterSamples.CookedValue"');
    if (r.ok && r.stdout) diskUsage = Math.round(parseFloat(r.stdout.trim()) || 0);
  } catch (e) { /* skip */ }

  return { volumes: disks, totalUsage: diskUsage };
}

async function scanProcesses() {
  let processes = [];
  try {
    const r = await runCmd('powershell -command "Get-Process | Sort-Object CPU -Descending | Select-Object -First 30 Name,@{N=\\"CPU\\";E={[math]::Round($_.CPU,1)}},@{N=\\"RAM_MB\\";E={[math]::Round($_.WorkingSet64/1MB,1)}},Id | ConvertTo-Json"');
    if (r.ok && r.stdout) {
      try { processes = JSON.parse(r.stdout.trim()); } catch (e) { /* skip */ }
    }
  } catch (e) { /* skip */ }
  return Array.isArray(processes) ? processes : [];
}

async function scanStartup() {
  let items = [];
  try {
    const r = await runCmd('powershell -command "Get-CimInstance Win32_StartupCommand | Select-Object Name,Command,Location | ConvertTo-Json"');
    if (r.ok && r.stdout) {
      try { items = JSON.parse(r.stdout.trim()); } catch (e) { /* skip */ }
    }
  } catch (e) { /* skip */ }
  return Array.isArray(items) ? items : [];
}

async function scanServices() {
  let services = [];
  try {
    const r = await runCmd('powershell -command "Get-Service | Where-Object {$_.StartType -eq \\"Automatic\\" -and $_.Status -eq \\"Running\\"} | Select-Object -First 20 Name,DisplayName,Status | ConvertTo-Json"');
    if (r.ok && r.stdout) {
      try { services = JSON.parse(r.stdout.trim()); } catch (e) { /* skip */ }
    }
  } catch (e) { /* skip */ }
  return Array.isArray(services) ? services : [];
}

async function scanNetwork() {
  let latency = null;
  let packetLoss = null;
  try {
    const r = await runCmd('ping -n 4 8.8.8.8');
    if (r.ok && r.stdout) {
      const avgMatch = r.stdout.match(/Promedio[=:]\s*(\d+)ms/i) || r.stdout.match(/Average[=:]\s*(\d+)ms/i);
      if (avgMatch) latency = parseInt(avgMatch[1]);
      const lossMatch = r.stdout.match(/(\d+)%\s*(?:de\s*)?p[eé]rdida/i) || r.stdout.match(/(\d+)%\s*loss/i);
      if (lossMatch) packetLoss = parseInt(lossMatch[1]);
    }
  } catch (e) { /* skip */ }

  let adapter = "N/A";
  try {
    const r = await runCmd('powershell -command "Get-NetAdapter | Where Status -eq \\"Up\\" | Select -First 1 Name,LinkSpeed | ConvertTo-Json"');
    if (r.ok && r.stdout) {
      try {
        const data = JSON.parse(r.stdout.trim());
        adapter = `${data.Name || "N/A"} (${data.LinkSpeed || "N/A"})`;
      } catch (e) { /* skip */ }
    }
  } catch (e) { /* skip */ }

  return { latency, packetLoss, adapter };
}

async function fullScan(onProgress) {
  const scan = {};
  const steps = [
    { name: "CPU", fn: scanCPU },
    { name: "RAM", fn: scanMemory },
    { name: "GPU", fn: scanGPU },
    { name: "Disco", fn: scanDisk },
    { name: "Procesos", fn: scanProcesses },
    { name: "Inicio", fn: scanStartup },
    { name: "Servicios", fn: scanServices },
    { name: "Red", fn: scanNetwork }
  ];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (onProgress) onProgress(step.name, Math.round(((i + 1) / steps.length) * 100));
    try {
      scan[step.name.toLowerCase()] = await step.fn();
    } catch (e) {
      scan[step.name.toLowerCase()] = { error: e.message };
    }
  }

  scan.timestamp = new Date().toISOString();
  return scan;
}

module.exports = {
  scanCPU, scanMemory, scanGPU, scanDisk,
  scanProcesses, scanStartup, scanServices, scanNetwork,
  fullScan, runCmd, parseWmicOutput
};
