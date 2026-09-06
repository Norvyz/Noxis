// Process Manager - Gestión avanzada de procesos
const { exec } = require("child_process");

function runCmd(cmd, timeout = 15000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout, encoding: "utf8" }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || "", stderr: stderr || "" });
    });
  });
}

async function listProcesses(sortBy = "cpu", limit = 30) {
  const sortProp = sortBy === "ram" ? "WorkingSet64" : sortBy === "name" ? "Name" : "CPU";
  const r = await runCmd(
    `powershell -command "Get-Process | Sort-Object ${sortProp} -Descending | Select-Object -First ${limit} Id,Name,@{N='CPU_s';E={[math]::Round($_.CPU,2)}},@{N='RAM_MB';E={[math]::Round($_.WorkingSet64/1MB,1)}},@{N='Threads';E={$_.Threads.Count}},@{N='Handles';E={$_.HandleCount}} | ConvertTo-Json"`,
    20000
  );
  if (!r.ok) return [];
  try {
    const data = JSON.parse(r.stdout.trim());
    return Array.isArray(data) ? data : [data];
  } catch (e) {
    return [];
  }
}

async function getProcessDetails(pid) {
  const r = await runCmd(
    `powershell -command "Get-Process -Id ${pid} | Select-Object Id,Name,@{N='CPU_s';E={[math]::Round($_.CPU,2)}},@{N='RAM_MB';E={[math]::Round($_.WorkingSet64/1MB,1)}},@{N='Threads';E={$_.Threads.Count}},@{N='Handles';E={$_.HandleCount}},StartTime,Path | ConvertTo-Json"`
  );
  if (!r.ok) return null;
  try {
    return JSON.parse(r.stdout.trim());
  } catch (e) {
    return null;
  }
}

async function killProcess(pid, force = false) {
  const flag = force ? "/F" : "";
  const r = await runCmd(`taskkill ${flag} /PID ${pid} /T`);
  return { ok: r.ok, message: r.ok ? `Proceso ${pid} terminado` : r.stderr || r.stdout };
}

async function killProcessByName(name, force = false) {
  const flag = force ? "/F" : "";
  const r = await runCmd(`taskkill ${flag} /IM "${name}" /T`);
  return { ok: r.ok, message: r.ok ? `Proceso ${name} terminado` : r.stderr || r.stdout };
}

async function getProcessCount() {
  const r = await runCmd('powershell -command "(Get-Process).Count"');
  if (!r.ok) return 0;
  return parseInt(r.stdout.trim()) || 0;
}

async function getCPUIntensiveProcesses(threshold = 10) {
  const r = await runCmd(
    `powershell -command "Get-Process | Where-Object {$_.CPU -gt ${threshold}} | Sort-Object CPU -Descending | Select-Object Name,@{N='CPU_s';E={[math]::Round($_.CPU,2)}},@{N='RAM_MB';E={[math]::Round($_.WorkingSet64/1MB,1)}},Id | ConvertTo-Json"`
  );
  if (!r.ok) return [];
  try {
    const data = JSON.parse(r.stdout.trim());
    return Array.isArray(data) ? data : [data];
  } catch (e) {
    return [];
  }
}

async function getMemoryIntensiveProcesses(thresholdMB = 200) {
  const r = await runCmd(
    `powershell -command "Get-Process | Where-Object {$_.WorkingSet64 -gt ${thresholdMB * 1024 * 1024}} | Sort-Object WorkingSet64 -Descending | Select-Object Name,@{N='RAM_MB';E={[math]::Round($_.WorkingSet64/1MB,1)}},@{N='CPU_s';E={[math]::Round($_.CPU,2)}},Id | ConvertTo-Json"`
  );
  if (!r.ok) return [];
  try {
    const data = JSON.parse(r.stdout.trim());
    return Array.isArray(data) ? data : [data];
  } catch (e) {
    return [];
  }
}

async function getStartupPrograms() {
  const r = await runCmd(
    'powershell -command "Get-CimInstance Win32_StartupCommand | Select-Object Name,Command,Location,User | ConvertTo-Json"'
  );
  if (!r.ok) return [];
  try {
    const data = JSON.parse(r.stdout.trim());
    return Array.isArray(data) ? data : [data];
  } catch (e) {
    return [];
  }
}

async function getServices(statusFilter = "Running") {
  const r = await runCmd(
    `powershell -command "Get-Service | Where-Object {$_.Status -eq '${statusFilter}'} | Select-Object Name,DisplayName,Status,StartType | ConvertTo-Json"`
  );
  if (!r.ok) return [];
  try {
    const data = JSON.parse(r.stdout.trim());
    return Array.isArray(data) ? data : [data];
  } catch (e) {
    return [];
  }
}

module.exports = {
  listProcesses, getProcessDetails, killProcess, killProcessByName,
  getProcessCount, getCPUIntensiveProcesses, getMemoryIntensiveProcesses,
  getStartupPrograms, getServices
};
