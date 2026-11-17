# Apuntes en mi letra

Sube un PDF de apuntes y descárgalo escrito con tu letra, en negro y listo para subrayar.

- Funciona entero en el navegador: el PDF no sale del dispositivo.
- PDFs con texto: se leen directamente. PDFs escaneados o fotos: OCR en español (Tesseract.js).
- La fuente con la letra va cifrada (AES-GCM, clave derivada de la contraseña con PBKDF2): sin la contraseña la web no puede escribir nada y la letra no se puede extraer.

Librerías incluidas en `vendor/`: pdf.js 3.11.174, pdf-lib 1.17.1, @pdf-lib/fontkit 1.1.1, Tesseract.js 5.1.1 (+ datos `spa`).
