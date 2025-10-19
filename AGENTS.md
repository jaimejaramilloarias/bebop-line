# AGENTS.md — Voicing Lines for Jazz improvisation — Jaime Jaramillo Arias

## 1) Propósito
Aplicación web minimalista para generar, visualizar y practicar líneas melódicas (“voicing lines”) a partir de:
- **Patrones fijos** de orden (10 permutaciones de 1–4).
- **Acordes capturados por MIDI** (grupos de 4 notas tocadas simultáneamente).
La app asegura **transiciones válidas** entre patrones y ofrece **dos visualizaciones** (matriz de alturas y partitura 4/4 en corcheas), además de **reproducción de audio** con control de tempo.

## 2) Alcance funcional
### 2.1 Patrones disponibles (fijos)
Diez patrones de orden para índices 1–4:  
`1234, 4321, 1432, 4123, 2341, 3214, 4231, 1324, 1423, 4132`.

### 2.2 Regla de transición entre patrones
Al generar dos o más grupos:  
**El último dígito del patrón anterior ≠ el primer dígito del patrón siguiente.**

### 2.3 Generación aleatoria
- Un solo grupo: seleccionar un patrón al azar.
- Dos o más grupos: construir secuencia cumpliendo la regla de transición.
- Opción de semilla: el usuario puede elegir un patrón inicial (del catálogo) y la app completa el resto con la regla.

### 2.4 Captura MIDI (MIDI Learn)
- **MIDI Learn continuo** (modo “armado”):
  - La app permanece escuchando mientras esté activado.
  - Cada vez que el usuario toca 4 notas casi simultáneamente, se captura un acorde (grave→agudo).
  - Se pueden capturar tantos grupos como el usuario quiera, hasta desarmar el modo.
- Evita dobles capturas del mismo ataque y requiere soltar antes de la siguiente.

### 2.5 Generación de línea desde acordes MIDI
- Cada acorde se combina con un patrón válido para producir 4 corcheas.
- La línea final es la concatenación de todas las corcheas.

## 3) Visualización
### 3.1 Matriz de alturas (principal)
- Cuatro alturas fijas (1 abajo, 4 arriba).
- Cada grupo se muestra como 4 columnas con un círculo en la altura.
- Separador vertical grueso entre grupos.
- Disposición: 4 grupos por renglón.
- Catálogo de 10 patrones en miniatura (2 filas de 5), clicables como semilla.

### 3.2 Partitura (SVG) en 4/4
- Pentagrama de 5 líneas con compases y corcheas.
- 8 corcheas por compás (4/4).
- Notas ubicadas por altura relativa (C4=60).

## 4) Audio
- Reproducción con WebAudio.
- Control de tempo (BPM).
- Ataque/release breves.

## 5) Interfaz y UX
- Título centrado con nombre del autor.
- Alternar tema claro/oscuro.
- Controles: cantidad de grupos, generar, limpiar.
- Panel MIDI: conectar, armar/desarmar, generar línea, reproducir, tempo, borrar acordes.
- Texto explicativo al pie.
- Minimalista, profesional, tooltips en vez de textos largos.
- Sin scroll horizontal.
- Tema claro: fondo gris claro, círculos violeta. Oscuro: contraste adecuado.

## 6) Accesibilidad
- ARIA labels y aria-live para mensajes.
- Navegación por teclado.

## 7) Datos y estado
- Patrones fijos.
- Grupos generados.
- Acordes capturados.
- Línea generada.
- Tema persistido.

## 8) Casos límite
- Sin dispositivo MIDI: app funciona con patrones fijos.
- Menos de 4 notas: no captura.
- Más de 4 notas: toma 4 más recientes.
- Sin acordes: no genera línea.
- Exceso de grupos: organiza filas de 4.

## 9) Compatibilidad
- Navegadores con Web MIDI API.
- WebAudio estándar.

## 10) Criterios de aceptación
1. Generar N grupos cumpliendo regla de transición.
2. Catálogo de 10 patrones mini 2×5 clicables.
3. MIDI Learn continuo: múltiples acordes de 4 notas.
4. Línea generada con matriz y partitura 4/4.
5. Reproducción con BPM ajustable.
6. Tema claro/oscuro persistente.
7. Accesibilidad básica.
