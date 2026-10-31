# Wrangler secrets

Set production secrets with the Wrangler CLI (never commit real values).

## Export download URLs

Signed export download links require `DOWNLOAD_SECRET`: at least 32 random characters.

```sh
wrangler secret put DOWNLOAD_SECRET
```

Local development: copy `.dev.vars.example` to `.dev.vars` and replace the placeholder (`.dev.vars` is gitignored).

Without `DOWNLOAD_SECRET`, export creation returns `503` with `{ "error": "download signing not configured" }` and token-based downloads are denied.
