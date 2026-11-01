# Modelo del jugador

`personaje_original.blend` es la base modelada a mano. Los scripts la visten, la pintan y la exportan al juego
(Blender 5.2, sin abrir la interfaz):

```bash
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
# Fotos (alta calidad): viste el modelo y saca frente, lado, espalda, cara, tenis…
"$B" -b modelos/personaje_original.blend --python modelos/scripts/build.py -- "$PWD/modelos/personaje.blend"
"$B" -b modelos/personaje.blend --python modelos/scripts/shots.py -- "$PWD/modelos/fotos/personaje" EEVEE
# Juego: versión liviana con los cuatro peinados, y exportación a src/assets/jugador.bin
"$B" -b modelos/personaje_original.blend --python modelos/scripts/build.py -- "$PWD/modelos/juego.blend" "$PWD/modelos/variantes/juego.json"
"$B" -b modelos/juego.blend --python modelos/scripts/export_game.py -- "$PWD/src/assets/jugador.bin"
```

Un `.json` en `variantes/` cambia piel, peinado, colores, número, altura y complexión (ver `CFG` en `build.py`).
En el juego los colores del equipo se pintan por vértice (`src/render/model.ts`).
