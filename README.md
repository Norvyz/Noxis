<div align="center">

<img src="assets/logo/LogoCircular.png" alt="Noxis icon" width="200" />

# Noxis

### Tu mascota de escritorio con voz, lista para ayudarte

<br/>

[![Latest release](https://img.shields.io/github/v/release/Norvyz/Noxis?style=for-the-badge&labelColor=0d1117)](https://github.com/Norvyz/Noxis/releases)
[![License](https://img.shields.io/github/license/Norvyz/Noxis?style=for-the-badge&labelColor=0d1117)](https://github.com/Norvyz/Noxis/blob/main/LICENSE)
[![Downloads](https://img.shields.io/github/downloads/Norvyz/Noxis/total?style=for-the-badge&labelColor=0d1117)](https://github.com/Norvyz/Noxis/releases)

<br/>

[![Buy Me a Coffee](https://img.shields.io/badge/Buy_Me_a_Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black&labelColor=0d1117)](https://www.buymeacoffee.com/Norvyz)

<br/>

[**Features**](#features) · [**Voice Commands**](#voice-commands) · [**Screenshots**](#screenshots) · [**Support**](#support-the-project)

</div>

---

<div align="center">

<h1><a id="features"></a>Features</h1>

<table>
  <tr>
    <td width="50%" valign="top">

#### Conversación
- Háblale de forma natural, responde al instante
- Reconocimiento de voz **100 % offline** con Vosk (sin nube, con privacidad total)
- Reconocimiento tolerante a errores del micrófono (fuzzy match + variantes del nombre)
- Despiértala con su nombre y desactívala cuando no la necesites
- Conversación también por texto en un chat integrado

</td>
    <td width="50%" valign="top">

#### Control de tu PC
- Abre tus apps con solo decirlo: *"Noxis abre Discord"*
- Crea grupos ("packs") para lanzar varias apps a la vez con pausa configurable
- Acepta comandos hablados o escritos
- Lanza ejecutables de forma nativa

</td>
  </tr>
  <tr>
    <td width="50%" valign="top">

#### Personalización
- Cambia la apariencia de tu mascota (skins)
- Nombre personalizable (wake word a tu gusto)
- Tema claro y oscuro
- Modelo de voz Estándar (40 MB) con descarga integrada

</td>
    <td width="50%" valign="top">

#### Siempre a tu lado
- Mascota flotante arrastrable, sin bordes y transparente
- Inicia con tu sistema operativo
- Vive en la bandeja del sistema sin estorbar
- Multiplataforma (Windows, macOS y Linux)
- Interacciones naturales: clic, doble clic, clic derecho

</td>
  </tr>
</table>

</div>

---

<div align="center">

<h1><a id="voice-commands"></a>Voice Commands</h1>

<h3>Habla de forma natural. Algunos ejemplos de lo que puedes decir:</h3>

<table>
  <tr>
    <td width="50%" valign="top">

#### Básicos
- **"Noxis"** — la despiertas
- **"Noxis abre Discord"** — abre una app
- **"Noxis abre trabajo"** — lanza un grupo de apps
- **"Noxis desactívate"** — la duermes 💤
- **"Hola"**, **"¿Cómo estás?"** — conversación
- **"Gracias"**, **"Adiós"** — responde
- **"¿Quién eres?"**, **"Ayuda"** — para saber qué hace

</td>
    <td width="50%" valign="top">

#### Control de PC
- **"Noxis muévete a la esquina superior izquierda"** — mueve la ventana
- **"Noxis vuelve al centro"** — centra la ventana
- **"Noxis cierra Discord"** — cierra una app
- **"Noxis crea una carpeta llamada Proyectos"** — crea carpeta en el escritorio
- **"Noxis crea una carpeta llamada Fotos en Documentos"** — carpeta en una ubicación específica
- **"Noxis crea un bloc de notas"** — crea y abre una nota
- **"Noxis crea una nota llamada Ideas"** — crea una nota con nombre

</td>
  </tr>
  <tr>
    <td width="50%" valign="top">

#### Volumen
- **"Noxis sube el volumen"** — sube el volumen
- **"Noxis baja el volumen"** — baja el volumen
- **"Noxis pon el volumen al 50 por ciento"** — ajusta a un porcentaje
- **"Noxis silencia"** / **"Noxis quita el silencio"** — mute
- **"Noxis ¿cuánto volumen tengo?"** — consulta el nivel actual

</td>
    <td width="50%" valign="top">

#### Sistema
- **"Noxis bloquea la pantalla"** — bloquea el PC 🔒
- **"Noxis apaga el PC"** — apaga con confirmación previa
- **"Noxis reinicia el PC"** — reinicia con confirmación previa
- Para apagar/reiniciar, confirma con **"confirmar"** o cancela con **"cancela"** (10 s)

</td>
  </tr>
</table>

<h4>La privacidad primero: cuando duerme, no muestra en pantalla lo que capta el micrófono; solo reacciona al escuchar su nombre para despertar.</h4>

</div>

---

<div align="center">

<h1><a id="companion"></a>Companion Mode</h1>

<h3>Noxis no solo responde: también te observa, te cuida y te habla de vez en cuando.</h3>

<table>
  <tr>
    <td width="50%" valign="top">

#### Detección de apps
- Noxis detecta qué aplicación estás usando
- Reacciona con frases al cambiar de app (Chrome, Discord, VS Code, etc.)
- Cooldown configurable para no ser invasiva
- Probabilidad aleatoria: aunque se cumpla el cooldown, a veces se queda callada

</td>
    <td width="50%" valign="top">

#### Horario y recordatorios
- Saluda distinto según la hora: mañana, tarde, noche o madrugada
- Recordatorio periódico de hidratación (cada 90 min, configurable)
- Información fija sobre consumo diario de agua (2-2.5 L/día)
- "Pensamientos random" de la mascota cada 45-120 min

</td>
  </tr>
</table>

<h4>Sin IA: todo se resuelve con frases predefinidas, temporizadores y Math.random().</h4>

#### Personalizar frases

Todas las frases están en `src/services/phrases.json`. Puedes editarlas directamente sin tocar código:

```json
{
  "timeOfDay": {
    "morning": ["Buenos días ☀️ Arrancamos con todo?"],
    "afternoon": ["Buenas tardes! Cómo viene el día?"],
    "evening": ["Buenas noches! Cerramos algo pendiente?"],
    "night": ["Son las 3am... no deberías estar durmiendo?"]
  },
  "appReactions": {
    "chrome.exe": ["Navegando? No te pierdas en YouTube 🦎"],
    "discord.exe": ["Discord! Hablando con amigos?"],
    "default": ["Usando {appName}? Interesante."]
  },
  "hydration": ["Recordatorio: tomate un vaso de agua 💧"],
  "randomThoughts": ["A veces me pregunto si los geckos digitales sueñan con ovejas eléctricas 🦎"]
}
```

#### Constantes configurables (en `companionService.js`)

| Constante | Default | Descripción |
|---|---|---|
| `COOLDOWN_MS` | 15 min | Tiempo mínimo entre mensajes espontáneos |
| `SPEAK_PROBABILITY` | 0.3 (30%) | Probabilidad de hablar cuando se cumple el cooldown |
| `HYDRATION_INTERVAL_MS` | 90 min | Intervalo del recordatorio de hidratación |
| `RANDOM_THOUGHT_MIN_MS` | 45 min | Mínimo entre pensamientos random |
| `RANDOM_THOUGHT_MAX_MS` | 120 min | Máximo entre pensamientos random |
| `APP_DWELL_MS` | 5 min | Tiempo mínimo en una app antes de reaccionar |

</div>

---

<div align="center">

<h1><a id="screenshots"></a>Screenshots</h1>

<br/>
<br/>

> Las capturas se añadirán con las próximas actualizaciones. Mientras tanto, ¡pruébala tú mismo!

<br/>
<br/>

</div>

---

<div align="center">

<h1><a id="support-the-project"></a>Support the Project</h1>

<h3>Noxis es libre y open-source. Si te saca una sonrisa o te facilita el día, considera apoyar su desarrollo 💛</h3>

[![Buy Me a Coffee](https://img.shields.io/badge/Buy_Me_a_Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black&labelColor=0d1117)](https://www.buymeacoffee.com/Norvyz)

</div>

---

<div align="center">

<h1>Special Thanks</h1>

<h3>Noxis se apoya en un gran trabajo open-source.</h3>

<table>
  <thead>
    <tr>
      <th align="center">Project</th>
      <th align="center">Contribution</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><a href="https://electronjs.org"><strong>Electron</strong></a></td>
      <td>Multiplataforma para Windows, macOS y Linux</td>
    </tr>
    <tr>
      <td align="center"><a href="https://alphacephei.com/vosk"><strong>Vosk</strong></a></td>
      <td>Reconocimiento de voz offline</td>
    </tr>
  </tbody>
</table>

<h3>Gracias también a toda la comunidad open-source, por cada librería, herramienta y API que hace posible este proyecto.</h3>

</div>

---

<div align="center">

<h1>Contributors</h1>

<h3>Este proyecto existe gracias a quienes creen en él.</h3>

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/Norvyz">
        <img src="https://images.weserv.nl/?url=github.com/Norvyz.png&w=100&h=100&fit=cover&mask=circle" width="100" alt="Norvyz"/>
        <br/>
        <sub><b>Norvyz</b></sub>
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/Bryanmgomez">
        <img src="https://images.weserv.nl/?url=github.com/Bryanmgomez.png&w=100&h=100&fit=cover&mask=circle" width="100" alt="Bryanmgomez"/>
        <br/>
        <sub><b>Bryanmgomez</b></sub>
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/1Rizuz">
        <img src="https://images.weserv.nl/?url=github.com/1Rizuz.png&w=100&h=100&fit=cover&mask=circle" width="100" alt="1Rizuz"/>
        <br/>
        <sub><b>1Rizuz</b></sub>
      </a>
    </td>
  </tr>
</table>

</div>

---

<div align="center">

<h1>Disclaimer</h1>

Este proyecto es **software libre** bajo la licencia **GPL-3.0**. Toda marca, servicio o propiedad intelectual referenciada pertenece a sus respectivos dueños.

</div>

---

<div align="center">

<sub>Hecho con 💚 por <a href="https://github.com/Norvyz">Norvyz</a></sub>
<sub>Hecho con 💚 por <a href="https://github.com/1Rizuz">Rizuz</a></sub>
<sub>Hecho con 💚 por <a href="https://github.com/bryanmg83">BryanMG</a></sub>



</div>
