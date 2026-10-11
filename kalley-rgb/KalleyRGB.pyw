"""Doble clic para abrir la ventana (en Windows no muestra consola).

Con argumentos funciona como la linea de comandos, por ejemplo:
    KalleyRGB.exe restaurar-memoria
"""

import sys

from kalley_rgb.cli import main

sys.exit(main(sys.argv[1:]))
