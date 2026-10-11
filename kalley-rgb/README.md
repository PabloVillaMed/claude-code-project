# Kalley RGB

Controla las luces del ratón **Kalley K-GMOUSE6** (y de otros ratones genéricos
con el mismo tipo de chip) sin el software del fabricante, que Kalley no publica.

- Ventana sencilla: eliges efecto, color, velocidad y brillo, y pulsas **Aplicar**.
- Línea de comandos para automatizar (por ejemplo, al iniciar Windows).
- Botón **Diagnóstico** que lee el ratón sin modificarlo y genera un informe.

> **Estado.** El K-GMOUSE6 se identifica como `1bcf:08a0`: un chip **Sunplus
> SPCP19X**, el mismo de ratones Zi You Lang / Red Wolf cuyo protocolo descifró
> [spmctrl](https://github.com/jdev082/spmctrl). La app ya lo reconoce, pero su
> escritura todavía no se ha confirmado con un K-GMOUSE6 real. Si algo falla,
> mira [Si no funciona](#si-no-funciona).

## Instalación

### Windows (sin instalar Python)

1. En GitHub, abre **Releases** en la página del repositorio y entra en
   **Kalley RGB (prueba)**.
2. Descarga `KalleyRGB.exe` y ábrelo. Se regenera en cada cambio de la app.

Windows puede avisar de que el programa no está firmado: *Más información →
Ejecutar de todas formas*. No necesita drivers: el ratón ya usa el driver HID
de Windows.

### Con Python (Windows, Linux o macOS)

Hace falta Python 3.9 o superior (en Windows, marca *tcl/tk* al instalarlo, que
viene activado por defecto).

```bash
cd kalley-rgb
pip install -r requirements.txt
python -m kalley_rgb          # abre la ventana
```

En Windows también puedes hacer doble clic en `KalleyRGB.pyw`.

**Linux:** para usarlo sin `sudo`, instala la regla de permisos:

```bash
sudo cp linux/70-kalley-rgb.rules /etc/udev/rules.d/
sudo udevadm control --reload && sudo udevadm trigger
```

## Uso

### Ventana

1. Conecta el ratón y abre la app. Aparece en **Ratón** con el chip detectado
   y el nivel de confianza.
2. Elige un **Efecto**. Solo se activan los ajustes que ese efecto admite.
3. Pulsa **Aplicar**. **Apagar luces** las apaga.

La app recuerda los últimos ajustes aplicados.

### Línea de comandos

```bash
python -m kalley_rgb listar                      # ratones detectados
python -m kalley_rgb efectos                     # efectos de cada chip
python -m kalley_rgb aplicar neon -v 5 -b 4      # arcoíris, velocidad 5, brillo 4
python -m kalley_rgb aplicar estatico -c 00ffff  # color fijo cian
python -m kalley_rgb aplicar estatico -c morado
python -m kalley_rgb apagar
python -m kalley_rgb restaurar                   # reaplica lo último guardado
python -m kalley_rgb restaurar-memoria           # Kalley: vuelve a la memoria original
python -m kalley_rgb diagnostico -o informe.txt
```

Opciones comunes: `-p sunplus|instant|instant-a704|holtek-a070` fuerza un chip,
`-d N` elige el ratón número N de `listar` y `--simular` muestra los bytes sin
enviarlos (con el chip Sunplus lee la memoria y muestra qué bytes cambiarían).

Para aplicar tu configuración al encender el PC, crea un acceso directo a
`pythonw -m kalley_rgb restaurar` (con *Iniciar en* apuntando a la carpeta
`kalley-rgb`) en la carpeta que abre `Win+R → shell:startup`.

## Chips compatibles

| Chip | Detección | Efectos |
|---|---|---|
| Sunplus SPCP19X (`1bcf:08a0`, **Kalley K-GMOUSE6**) | confirmado; otros `1bcf` con el reporte 4, probable | Arcoíris, multicolor, flujo, vals, cuatro estaciones, color fijo, color según DPI, apagado. Velocidad 1–8, brillo 50/100 % |
| Instant Microelectronics (VID `30fa`, `18f8`) | `30fa:1440` confirmado; resto del fabricante, probable | Neón, color fijo, flujo de un color, respiración, flujo, cometa, ambiente, destellos, estrellas, ondas, vaivén, reactivo al clic, según DPI, apagado. Color de 4 bits por canal en 8 zonas, velocidad 1–7, brillo 0–4 |
| Instant A704 / A704F (`30fa:1701`, `18f8:1286`) | confirmado | Respiración multicolor (6 velocidades), estático, apagado |
| Holtek A070 (`04d9:a070`) | confirmado | Color fijo y respiración con color RGB completo |
| Otro ratón con el reporte de configuración de 8 bytes (ID 7) | posible | El del chip que más se parece |

Todos se configuran con *feature reports* HID de 8 bytes (ID 4 en Sunplus, ID 7
en el resto) enviados a la interfaz de configuración del ratón, no a la del
puntero. La app encuentra esa interfaz leyendo el descriptor HID de cada una.

### Cómo se escribe en el chip Sunplus

Este chip no tiene comandos de luces sueltos: guarda la configuración (luces,
DPI, botones) en una memoria de 256 B o 2 KB, según la versión de firmware, que se
lee y se reescribe entera, igual que hacen sus programas oficiales. Al pulsar
**Aplicar**, que tarda unos segundos, la app:

1. Lee la memoria dos veces y comprueba que ambas lecturas coinciden.
2. Comprueba que tiene el formato conocido: checksums en `0x2F` y `0x76`,
   complementos de DPI y luces, y rangos válidos. Si algo no cuadra, no escribe nada.
3. La primera vez guarda una copia en `~/.kalley_rgb/` (en Windows,
   `C:\Users\<usuario>\.kalley_rgb\`).
4. Cambia solo el efecto, la velocidad, el brillo (`1` = 50 %, `2` = 100 %), el color
   de los niveles DPI (para **Color fijo**) y el checksum `0x2F`.
5. Escribe la memoria (el ratón confirma cada bloque) y la vuelve a leer para
   comprobarla. Si una escritura se corta, la reintenta y, si no lo consigue,
   vuelve a escribir la configuración anterior. Nunca cierra una escritura a medias.

Mientras escribe, no muevas el ratón, no pulses sus botones, no lo desconectes y
no cierres la ventana (la app no deja cerrarla hasta que termina).

**Restaurar original** (botón de la ventana, o `KalleyRGB.exe restaurar-memoria`)
vuelve a escribir la copia guardada antes del primer cambio.

## Si no funciona

1. En **Chip**, prueba los otros protocolos y vuelve a pulsar **Aplicar**. Cada
   uno envía solo los comandos de luces de su chip.
2. Pulsa **Diagnóstico** y **Copiar**. El informe incluye el VID:PID, las
   interfaces, los descriptores HID, la respuesta de lectura del ratón y, en el
   chip Sunplus, el contenido de su memoria. Con eso se puede añadir o ajustar el
   protocolo. El diagnóstico **solo lee**.
3. Si consigues el software de otro ratón con el mismo chip (mismo VID:PID),
   puedes capturar lo que envía con [USBPcap](https://desowin.org/usbpcap/) y
   Wireshark mientras cambias efectos. Con esa captura se descifra el protocolo.

El ratón `30fa:1030` (y quizá otros) usa una variante que reescribe la
configuración en su memoria; la app lo marca como *experimental*.

## Desarrollo

```bash
cd kalley-rgb
python -m unittest discover -s tests -t .
```

Las pruebas no necesitan el ratón: comprueban los bytes de cada protocolo contra
las referencias publicadas, usan los descriptores HID reales de un ratón Instant y
del K-GMOUSE6, y un chip Sunplus simulado que sigue el protocolo de spmctrl. El workflow `.github/workflows/kalley-rgb.yml` ejecuta las pruebas y
publica `KalleyRGB.exe` en la release **Kalley RGB (prueba)** en cada cambio.

| Módulo | Qué hace |
|---|---|
| `protocols.py` | Convierte ajustes en paquetes para cada chip |
| `sunplus.py` | Lectura y escritura segura de la memoria del chip Sunplus |
| `detect.py` | Identifica el chip y la interfaz de configuración |
| `descriptor.py` | Lee descriptores de reporte HID |
| `hidio.py` | Acceso al ratón vía hidapi |
| `diagnostics.py` | Informe de solo lectura |
| `gui.py` / `cli.py` | Ventana y línea de comandos |

## Fuentes del protocolo

- Sunplus SPCP19X (`1bcf:08a0`): [jdev082/spmctrl](https://github.com/jdev082/spmctrl), que replica la app "M8 Mouse"; mapa de memoria del SDK oficial de [Havit](https://havitsmart.com/pages/driver-download) y capturas USB de los issues [3513](https://gitlab.com/CalcProgrammer1/OpenRGB/-/issues/3513) y [4078](https://gitlab.com/CalcProgrammer1/OpenRGB/-/issues/4078) de OpenRGB
- Instant (modos, colores por zona, fijado): [NitronStudios/detox-open-mouse-drivers](https://github.com/NitronStudios/detox-open-mouse-drivers)
- Instant A704/A704F: [AmberIsFrozen/Instant-A704F-Mouse-Utilities](https://github.com/AmberIsFrozen/Instant-A704F-Mouse-Utilities) y [su artículo](https://blog.lx862.com/blog/2024-05-13-reverse-engineering-a-mouse/)
- Holtek A070: [OpenRGB](https://gitlab.com/CalcProgrammer1/OpenRGB), `Controllers/HoltekController`
- Capturas USB de un ratón Instant `30fa:1030`: [OpenRGB issue 2496](https://gitlab.com/CalcProgrammer1/OpenRGB/-/issues/2496)
