# durazno-feed

Espejo automático de las noticias públicas de [durazno.uy](https://durazno.uy/noticias) para Nika TV.

El portal está detrás de Cloudflare y responde **403** a la IP del servidor de Render, así que un
workflow de GitHub Actions (con otra salida a internet) lee la API pública cada 20 minutos y deja
el resultado en:

- `durazno.json`: últimas noticias en el mismo formato de la API (`items`).
- `media/`: copia de las imágenes usadas, servida por `raw.githubusercontent.com`.

La aplicación usa `durazno.json` como respaldo cuando la API directa falla.
Las imágenes se descargan una sola vez y se eliminan cuando dejan de usarse, para que el
repositorio no crezca.

## Ejecutar a mano

`Actions → durazno-feed → Run workflow`

También se puede replicar en local:

```bash
node sync.mjs
```

Variables opcionales: `DURAZNO_API`, `DURAZNO_RAW_BASE`, `DURAZNO_MAX_ITEMS`.