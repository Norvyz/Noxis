// Performance Analyzer - Análisis de rendimiento y diagnóstico
const systemScanner = require("./systemScanner");

const THRESHOLDS = {
  cpuHigh: 80,
  cpuMedium: 60,
  ramHigh: 85,
  ramMedium: 70,
  diskHigh: 90,
  diskMedium: 80,
  latencyHigh: 100,
  latencyMedium: 50,
  tempHigh: 80,
  tempMedium: 70
};

const CRITICAL_PROCESSES = [
  "system", "svchost", "csrss", "wininit", "winlogon", "lsass",
  "services", "smss", "dwm", "fontdrvhost", "sihost", "taskhostw",
  "explorer", "shellhost", "searchhost", "startmenuexperiencehost"
];

function categorize(value, high, medium) {
  if (value >= high) return "critical";
  if (value >= medium) return "warning";
  return "good";
}

function getScoreLabel(score) {
  if (score >= 90) return "Excelente";
  if (score >= 75) return "Bueno";
  if (score >= 60) return "Regular";
  if (score >= 40) return "Deficiente";
  return "Crítico";
}

function analyzeCPU(scan) {
  const cpu = scan.cpu || {};
  const issues = [];
  const suggestions = [];

  const status = categorize(cpu.usage || 0, THRESHOLDS.cpuHigh, THRESHOLDS.cpuMedium);
  if (status === "critical") {
    issues.push({ severity: "critical", message: `CPU al ${cpu.usage}% — carga muy alta`, impact: "Rendimiento severamente degradado" });
    suggestions.push("Cerrar procesos que consuman mucha CPU", "Verificar procesos en segundo plano innecesarios");
  } else if (status === "warning") {
    issues.push({ severity: "warning", message: `CPU al ${cpu.usage}% — carga moderada`, impact: "Posible ralentización en tareas pesadas" });
  }

  if (cpu.temperature && cpu.temperature > THRESHOLDS.tempHigh) {
    issues.push({ severity: "critical", message: `Temperatura CPU: ${cpu.temperature}°C — sobrecalentamiento`, impact: "Throttling térmico, reducción de rendimiento" });
    suggestions.push("Mejorar ventilación del equipo", "Limpiar polvo de ventiladores");
  } else if (cpu.temperature && cpu.temperature > THRESHOLDS.tempMedium) {
    issues.push({ severity: "warning", message: `Temperatura CPU: ${cpu.temperature}°C — temperatura elevada`, impact: "Posible throttling bajo carga" });
  }

  return { status, issues, suggestions, score: status === "good" ? 100 : status === "warning" ? 70 : 40 };
}

function analyzeMemory(scan) {
  const mem = scan.memoria || {};
  const issues = [];
  const suggestions = [];
  const pct = parseInt(mem.percent) || 0;
  const status = categorize(pct, THRESHOLDS.ramHigh, THRESHOLDS.ramMedium);

  if (status === "critical") {
    issues.push({ severity: "critical", message: `RAM al ${pct}% — memoria casi agotada`, impact: "Sistema puede bloquearse o usar swap excesivo" });
    suggestions.push("Cerrar aplicaciones innecesarias", "Reducir pestañas del navegador");
  } else if (status === "warning") {
    issues.push({ severity: "warning", message: `RAM al ${pct}% — uso elevado`, impact: "Posibles ralentizaciones" });
  }

  if (mem.topProcesses && mem.topProcesses.length > 0) {
    const heavy = mem.topProcesses.filter(p => parseFloat(p.MB) > 500);
    if (heavy.length > 0) {
      suggestions.push(`Procesos pesados: ${heavy.map(p => `${p.Name} (${p.MB}MB)`).join(", ")}`);
    }
  }

  return { status, issues, suggestions, score: status === "good" ? 100 : status === "warning" ? 70 : 40 };
}

function analyzeGPU(scan) {
  const gpu = scan.gpu || {};
  const issues = [];
  const suggestions = [];

  if (!gpu.name || gpu.name === "No detectada") {
    return { status: "unknown", issues: [{ severity: "info", message: "GPU no detectada", impact: "N/A" }], suggestions: [], score: 50 };
  }

  if (gpu.usage > 90) {
    issues.push({ severity: "warning", message: `GPU al ${gpu.usage}% — uso elevado`, impact: "Posible cuello de botella en gaming" });
  }

  return { status: gpu.usage > 90 ? "warning" : "good", issues, suggestions, score: gpu.usage > 90 ? 70 : 100 };
}

function analyzeDisk(scan) {
  const disk = scan.disco || {};
  const issues = [];
  const suggestions = [];

  if (disk.volumes) {
    for (const vol of disk.volumes) {
      if (vol.usedPercent > THRESHOLDS.diskHigh) {
        issues.push({ severity: "critical", message: `Disco ${vol.letter} al ${vol.usedPercent}% — casi lleno`, impact: "Rendimiento de disco severamente afectado" });
        suggestions.push(`Liberar espacio en ${vol.letter}`, "Ejecutar limpieza de archivos temporales");
      } else if (vol.usedPercent > THRESHOLDS.diskMedium) {
        issues.push({ severity: "warning", message: `Disco ${vol.letter} al ${vol.usedPercent}% — uso elevado`, impact: "Posible degradación del rendimiento" });
      }
    }
  }

  if (disk.totalUsage > 90) {
    issues.push({ severity: "warning", message: `Actividad de disco al ${disk.totalUsage}%`, impact: "Disco saturado, tiempos de carga lentos" });
  }

  return { status: issues.some(i => i.severity === "critical") ? "critical" : issues.length > 0 ? "warning" : "good", issues, suggestions, score: issues.length === 0 ? 100 : issues.some(i => i.severity === "critical") ? 40 : 70 };
}

function analyzeNetwork(scan) {
  const net = scan.red || {};
  const issues = [];
  const suggestions = [];

  if (net.latency !== null) {
    if (net.latency > THRESHOLDS.latencyHigh) {
      issues.push({ severity: "critical", message: `Latencia: ${net.latency}ms — muy alta`, impact: "Conexión inestable, gaming afectado" });
      suggestions.push("Verificar conexión de red", "Reiniciar router si es necesario");
    } else if (net.latency > THRESHOLDS.latencyMedium) {
      issues.push({ severity: "warning", message: `Latencia: ${net.latency}ms — moderada`, impact: "Posible inestabilidad en tiempo real" });
    }
  }

  if (net.packetLoss !== null && net.packetLoss > 0) {
    issues.push({ severity: "critical", message: `Pérdida de paquetes: ${net.packetLoss}%`, impact: "Conexión inestable" });
  }

  return { status: issues.some(i => i.severity === "critical") ? "critical" : issues.length > 0 ? "warning" : "good", issues, suggestions, score: issues.length === 0 ? 100 : issues.some(i => i.severity === "critical") ? 40 : 70 };
}

function analyzeStartup(scan) {
  const startup = scan.inicio || [];
  const issues = [];
  const suggestions = [];

  if (startup.length > 15) {
    issues.push({ severity: "warning", message: `${startup.length} programas en el inicio`, impact: "Tiempo de arranque lento" });
    suggestions.push("Revisar y desactivar programas innecesarios del inicio");
  } else if (startup.length > 8) {
    issues.push({ severity: "info", message: `${startup.length} programas en el inicio`, impact: "Algo de impacto en arranque" });
  }

  return { status: issues.length > 0 ? "warning" : "good", issues, suggestions, score: startup.length <= 5 ? 100 : startup.length <= 10 ? 80 : 60 };
}

function calculateOverallScore(scan) {
  const cpuScore = analyzeCPU(scan).score;
  const memScore = analyzeMemory(scan).score;
  const gpuScore = analyzeGPU(scan).score;
  const diskScore = analyzeDisk(scan).score;
  const netScore = analyzeNetwork(scan).score;
  const startupScore = analyzeStartup(scan).score;

  const weights = { cpu: 20, ram: 20, gpu: 15, disk: 20, net: 10, startup: 15 };
  const total = Math.round(
    (cpuScore * weights.cpu + memScore * weights.ram + gpuScore * weights.gpu +
     diskScore * weights.disk + netScore * weights.net + startupScore * weights.startup) / 100
  );

  return {
    overall: Math.min(100, Math.max(0, total)),
    label: getScoreLabel(total),
    breakdown: {
      cpu: { score: cpuScore, label: getScoreLabel(cpuScore) },
      ram: { score: memScore, label: getScoreLabel(memScore) },
      gpu: { score: gpuScore, label: getScoreLabel(gpuScore) },
      disk: { score: diskScore, label: getScoreLabel(diskScore) },
      network: { score: netScore, label: getScoreLabel(netScore) },
      startup: { score: startupScore, label: getScoreLabel(startupScore) }
    }
  };
}

function analyzeAll(scan) {
  const cpuAnalysis = analyzeCPU(scan);
  const memAnalysis = analyzeMemory(scan);
  const gpuAnalysis = analyzeGPU(scan);
  const diskAnalysis = analyzeDisk(scan);
  const netAnalysis = analyzeNetwork(scan);
  const startupAnalysis = analyzeStartup(scan);
  const scores = calculateOverallScore(scan);

  const allIssues = [
    ...cpuAnalysis.issues, ...memAnalysis.issues, ...gpuAnalysis.issues,
    ...diskAnalysis.issues, ...netAnalysis.issues, ...startupAnalysis.issues
  ];
  const allSuggestions = [
    ...cpuAnalysis.suggestions, ...memAnalysis.suggestions, ...gpuAnalysis.suggestions,
    ...diskAnalysis.suggestions, ...netAnalysis.suggestions, ...startupAnalysis.suggestions
  ];

  return {
    scores,
    issues: allIssues,
    suggestions: allSuggestions,
    criticalCount: allIssues.filter(i => i.severity === "critical").length,
    warningCount: allIssues.filter(i => i.severity === "warning").length
  };
}

module.exports = { analyzeAll, calculateOverallScore, analyzeCPU, analyzeMemory, analyzeGPU, analyzeDisk, analyzeNetwork, analyzeStartup, THRESHOLDS, CRITICAL_PROCESSES };
